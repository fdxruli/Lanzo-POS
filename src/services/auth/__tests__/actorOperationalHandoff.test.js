import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => {
  const activeState = { activeOrders: new Map(), currentOrderId: null };
  const orderState = {};
  const state = { sales: [] };
  return {
    state,
    useActiveOrders: {
      getState: () => activeState,
      setState: (patch) => Object.assign(activeState, patch)
    },
    useOrderStore: {
      getState: () => orderState,
      setState: (patch) => Object.assign(orderState, patch)
    },
    db: {
      table: (name) => {
        if (name === 'sales') {
          return {
            filter: (predicate) => ({
              toArray: async () => state.sales.filter(predicate)
            }),
            update: async (id, patch) => {
              const sale = state.sales.find((item) => item.id === id);
              if (sale) Object.assign(sale, patch);
              return sale ? 1 : 0;
            }
          };
        }
        return {
          where: () => ({
            equals: () => ({
              filter: () => ({ toArray: async () => [] })
            })
          })
        };
      }
    }
  };
});

vi.mock('../../../store/useOrderStore.jsx', () => ({ useOrderStore: fixtures.useOrderStore }));
vi.mock('../../../hooks/pos/useActiveOrders.js', () => ({ useActiveOrders: fixtures.useActiveOrders }));
vi.mock('../../db/dexie.js', () => ({
  db: fixtures.db,
  STORES: { SALES: 'sales', PRODUCT_BATCHES: 'product_batches' }
}));
vi.mock('../../db/utils.js', () => ({ getAvailableStock: (batch) => Number(batch?.stock || 0) }));
vi.mock('../../sales/inventoryFlow.js', () => ({ getSortedBatchesForProduct: (batches) => batches }));
vi.mock('../../products/commercialVariants.js', () => ({ isCommercialVariantProduct: () => false }));

import {
  ACTOR_HANDOFF_CHECKOUT_OWNED,
  ACTOR_HANDOFF_PENDING_OPERATIONS,
  assertActorOperationalHandoffClear,
  configureActorOperationalPersistence,
  getActorCheckoutOwnerships,
  getPendingActorOperations,
  installActorOperationalHandoffGuards,
  rebindActorOperationalOwnership,
  refreshPersistedActorCheckoutOwnership,
  runCheckoutActorOperation,
  runTrackedActorOperationWithHandle
} from '../actorOperationalHandoff';

const TENANT = Object.freeze({
  opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  generation: 10
});

const createHandle = ({
  actorKey = 'admin:admin-a',
  generation = 5
} = {}) => {
  let stale = false;
  const [actorType, actorId] = actorKey.split(':');
  return {
    actorKey,
    actorType,
    actorId,
    generation,
    tenant: TENANT,
    makeStale() { stale = true; },
    assertCurrent() {
      if (stale) {
        const error = new Error('ACTOR_CONTEXT_STALE');
        error.code = 'ACTOR_CONTEXT_STALE';
        throw error;
      }
      return { actorKey, generation, tenant: TENANT };
    }
  };
};

describe('actor operational handoff barrier', () => {
  beforeEach(async () => {
    fixtures.state.sales = [];
    configureActorOperationalPersistence({ db: fixtures.db, salesStore: 'sales' });
    await installActorOperationalHandoffGuards();
    await refreshPersistedActorCheckoutOwnership({ tenant: TENANT });
  });

  it('blocks a new actor while an actor-sensitive async operation is pending', async () => {
    const handle = createHandle();
    let release;
    const wait = new Promise((resolve) => { release = resolve; });

    const pending = runTrackedActorOperationWithHandle(
      handle,
      'activeOrders.pauseOrder',
      async () => {
        await wait;
        return 'done';
      }
    );

    expect(getPendingActorOperations()).toEqual([
      expect.objectContaining({
        label: 'activeOrders.pauseOrder',
        actorKey: 'admin:admin-a',
        actorGeneration: 5,
        tenantOpaqueId: TENANT.opaqueId
      })
    ]);
    expect(() => assertActorOperationalHandoffClear({ tenant: TENANT })).toThrowError(
      expect.objectContaining({ code: ACTOR_HANDOFF_PENDING_OPERATIONS })
    );

    release();
    await expect(pending).resolves.toBe('done');
    expect(getPendingActorOperations()).toHaveLength(0);
    expect(assertActorOperationalHandoffClear({ tenant: TENANT })).toBe(true);
  });

  it('never runs a guarded write after the captured actor becomes stale', async () => {
    const handle = createHandle();
    let release;
    const wait = new Promise((resolve) => { release = resolve; });
    const write = vi.fn();

    const pending = runTrackedActorOperationWithHandle(
      handle,
      'orderStore.addSmartItem.batchResolution',
      async ({ guardedWrite }) => {
        await wait;
        return guardedWrite(write);
      }
    );

    handle.makeStale();
    release();

    await expect(pending).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_STALE' });
    expect(write).not.toHaveBeenCalled();
    expect(getPendingActorOperations()).toHaveLength(0);
  });

  it('restores persisted Admin checkout ownership and blocks Staff handoff after restart', async () => {
    fixtures.state.sales = [{
      id: 'sale-admin',
      isLockedForCheckout: true,
      checkoutActorKey: 'admin:admin-a',
      checkoutActorGeneration: 5,
      checkoutLockedAt: '2026-08-18T20:00:00.000Z'
    }];

    await refreshPersistedActorCheckoutOwnership({ tenant: TENANT });

    expect(getActorCheckoutOwnerships()).toEqual([
      expect.objectContaining({
        orderId: 'sale-admin',
        actorKey: 'admin:admin-a',
        actorGeneration: 5,
        persisted: true
      })
    ]);
    expect(() => assertActorOperationalHandoffClear({
      tenant: TENANT,
      actorKey: 'staff:staff-b'
    })).toThrowError(expect.objectContaining({ code: ACTOR_HANDOFF_CHECKOUT_OWNED }));
    expect(assertActorOperationalHandoffClear({
      tenant: TENANT,
      actorKey: 'admin:admin-a'
    })).toBe(true);
  });

  it('fails closed for a legacy locked checkout with no actor proof', async () => {
    fixtures.state.sales = [{
      id: 'legacy-lock',
      isLockedForCheckout: true,
      checkoutActorKey: null
    }];

    await refreshPersistedActorCheckoutOwnership({ tenant: TENANT });

    expect(() => assertActorOperationalHandoffClear({
      tenant: TENANT,
      actorKey: 'admin:admin-a'
    })).toThrowError(expect.objectContaining({ code: ACTOR_HANDOFF_CHECKOUT_OWNED }));
    expect(() => assertActorOperationalHandoffClear({
      tenant: TENANT,
      actorKey: 'staff:staff-b'
    })).toThrowError(expect.objectContaining({ code: ACTOR_HANDOFF_CHECKOUT_OWNED }));
  });

  it('rebinds a persisted checkout only to the same reauthenticated actor generation', async () => {
    fixtures.state.sales = [{
      id: 'sale-admin-restart',
      isLockedForCheckout: true,
      checkoutActorKey: 'admin:admin-a',
      checkoutActorGeneration: 5
    }];
    await refreshPersistedActorCheckoutOwnership({ tenant: TENANT });

    const newHandle = createHandle({ actorKey: 'admin:admin-a', generation: 7 });
    expect(rebindActorOperationalOwnership({
      actorKey: 'admin:admin-a',
      tenant: TENANT,
      handle: newHandle
    })).toBe(1);

    const write = vi.fn(() => 'written');
    await expect(runCheckoutActorOperation({
      orderId: 'sale-admin-restart',
      label: 'sales.processSale',
      operation: async ({ guardedWrite }) => guardedWrite(write)
    })).resolves.toBe('written');
    expect(write).toHaveBeenCalledTimes(1);
  });
});
