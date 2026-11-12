import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  sales: new Map(),
  products: new Map(),
  batches: [],
  batchLoadPromise: null,
  releasePosDraft: vi.fn()
}));

vi.mock('../../../services/ecommerce/ecommerceOrderService', () => ({
  releaseEcommerceOrderPosDraft: dbState.releasePosDraft
}));

const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  key: vi.fn(() => null),
  get length() {
    return 0;
  }
};

vi.stubGlobal('window', { localStorage: localStorageMock });
vi.stubGlobal('localStorage', localStorageMock);

vi.mock('../../../services/utils', () => ({
  generateID: vi.fn(() => 'sal-generated'),
  safeLocalStorageSet: vi.fn(),
  showMessageModal: vi.fn(),
  showConfirmModal: vi.fn(async () => false),
  roundCurrency: vi.fn((value) => Math.round(Number(value) * 100) / 100)
}));

vi.mock('../../../services/db/dexie', () => ({
  STORES: {
    SALES: 'sales',
    MENU: 'menu',
    PRODUCT_BATCHES: 'product_batches'
  },
  db: {
    table: vi.fn((storeName) => {
      if (storeName === 'sales') {
        return {
          get: vi.fn(async (id) => dbState.sales.get(id) || null),
          update: vi.fn(async (id, changes) => {
            const current = dbState.sales.get(id);
            if (!current) return 0;
            dbState.sales.set(id, { ...current, ...changes });
            return 1;
          }),
          where: vi.fn((field) => ({
            equals: vi.fn((value) => ({
              toArray: vi.fn(async () => Array.from(dbState.sales.values())
                .filter((sale) => sale?.[field] === value))
            }))
          }))
        };
      }

      if (storeName === 'menu') {
        return {
          get: vi.fn(async (id) => dbState.products.get(id) || null),
          toArray: vi.fn(async () => Array.from(dbState.products.values())),
          bulkPut: vi.fn(async (products) => {
            products.forEach((product) => dbState.products.set(product.id, product));
            return products.map((product) => product.id);
          })
        };
      }

      return {
        toArray: vi.fn(async () => dbState.batches),
        bulkGet: vi.fn(async (ids) => {
          const batches = dbState.batchLoadPromise ? await dbState.batchLoadPromise : dbState.batches;
          return ids.map((id) => batches.find((batch) => batch.id === id));
        }),
        where: vi.fn(() => ({
          equals: vi.fn(() => {
            const toArray = vi.fn(async () => (
              dbState.batchLoadPromise
                ? await dbState.batchLoadPromise
                : dbState.batches
            ));
            // Support both the previous filtered query and Dexie's direct toArray().
            return { toArray, filter: vi.fn(() => ({ toArray })) };
          })
        }))
      };
    })
  }
}));

vi.mock('../../../services/sales/inventoryFlow', () => ({
  commitStock: vi.fn(async (items) => items),
  releaseCommittedStock: vi.fn(async () => ({ success: true })),
  getSortedBatchesForProduct: vi.fn((batches) => batches)
}));

import {
  selectCurrentOrder,
  selectCurrentOrderCustomer,
  selectCurrentOrderItems,
  selectCurrentOrderTableData,
  useActiveOrders
} from '../useActiveOrders';
import { showConfirmModal, showMessageModal } from '../../../services/utils';
import { actorRuntimeController, createActorRuntimeController } from '../../../services/auth/actorRuntimeController';
import { commitStock, releaseCommittedStock } from '../../../services/sales/inventoryFlow';

const makeOrder = (id, items = []) => ({
  id,
  items,
  customer: null,
  tableData: null,
  createdAt: '2026-06-09T00:00:00.000Z',
  total: 0,
  isSaved: false
});

describe('useActiveOrders unified store', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.spyOn(actorRuntimeController, 'capture').mockReturnValue({ actorKey: 'staff:one', assertCurrent: vi.fn() });
    dbState.sales.clear();
    dbState.products.clear();
    dbState.batches = [];
    dbState.batchLoadPromise = null;
    dbState.releasePosDraft.mockResolvedValue({ success: true, changed: true });
    vi.clearAllMocks();
    useActiveOrders.setState({
      activeOrders: new Map(),
      currentOrderId: null,
      isLoading: false,
      isCurrentOrderLocked: false,
      pendingInventoryResolutions: new Map(),
      inventoryConflictNotice: null
    });
  });

  const remoteSale = () => ({
    ...makeOrder('remote-table', [{ id: 'pizza', productId: 'pizza', lineId: 'original-line', price: '80', unitPrice: '80', lineTotal: '70', quantity: 1, selectedModifiers: [] }]),
    status: 'open', isSaved: true, tableData: 'Mesa remota',
    total: '70', subtotal: '80', discountTotal: '10', currency: 'MXN',
    saleDiscount: { type: 'fixed', value: '10' },
    restaurantCloudHydrated: true, reservationAuthority: 'cloud',
    cloudRestaurantOrderServerVersion: 7, updatedAt: '2026-10-05T10:00:00.123456Z'
  });

  it.each([false, true])('removes the sole remote review and creates an empty cart (multiple orders: %s)', async (multiple) => {
    const { useAppStore } = await import('../../../store/useAppStore');
    useAppStore.setState({ enableMultipleOrders: multiple });
    const sale = remoteSale();
    dbState.sales.set(sale.id, sale);
    dbState.products.set('pizza', { id: 'pizza', stock: 10, committedStock: 4 });
    dbState.batches = [{ id: 'batch-1', stock: 8, committedStock: 3 }];
    await useActiveOrders.getState().loadOpenOrder(sale.id);
    const before = JSON.stringify({ sales: [...dbState.sales], products: [...dbState.products], batches: dbState.batches });
    const tableCalls = (await import('../../../services/db/dexie')).db.table.mock.calls.length;
    await useActiveOrders.getState().removeOrder(sale.id);
    const state = useActiveOrders.getState();
    expect(state.activeOrders.has(sale.id)).toBe(false);
    expect(state.currentOrderId).toBe('sal-generated');
    expect(state.activeOrders.get(state.currentOrderId).items).toEqual([]);
    expect(JSON.stringify({ sales: [...dbState.sales], products: [...dbState.products], batches: dbState.batches })).toBe(before);
    expect((await import('../../../services/db/dexie')).db.table.mock.calls).toHaveLength(tableCalls);
    expect(releaseCommittedStock).not.toHaveBeenCalled();
    await useActiveOrders.getState().removeOrder(sale.id);
    expect(useActiveOrders.getState().activeOrders.size).toBe(1);
  });

  it('preserves another local cart and reloads a single remote copy with Cloud authority', async () => {
    const { useAppStore } = await import('../../../store/useAppStore');
    useAppStore.setState({ enableMultipleOrders: true });
    const local = makeOrder('local-order', [{ id: 'coffee', price: 20, quantity: 1 }]);
    const sale = remoteSale();
    dbState.sales.set(sale.id, sale);
    useActiveOrders.setState({ activeOrders: new Map([[local.id, local], [sale.id, sale]]), currentOrderId: sale.id });
    await useActiveOrders.getState().removeOrder(sale.id);
    expect(useActiveOrders.getState().currentOrderId).toBe(local.id);
    expect(useActiveOrders.getState().activeOrders.get(local.id)).toEqual(local);
    await useActiveOrders.getState().loadOpenOrder(sale.id);
    await useActiveOrders.getState().loadOpenOrder(sale.id);
    expect(useActiveOrders.getState().activeOrders.size).toBe(2);
    expect(useActiveOrders.getState().activeOrders.get(sale.id).reservationAuthority).toBe('cloud');
    expect(dbState.sales.get(sale.id)).toEqual(sale);
    expect(releaseCommittedStock).not.toHaveBeenCalled();
  });

  it('loads the remote identity and complete commercial snapshot without reserving inventory', async () => {
    const sale = remoteSale();
    dbState.sales.set(sale.id, sale);
    await expect(useActiveOrders.getState().loadOpenOrder(sale.id)).resolves.toEqual({ success: true });
    const state = useActiveOrders.getState();
    expect(state.currentOrderId).toBe(sale.id);
    expect(state.activeOrders.size).toBe(1);
    expect(state.getTotalPrice()).toBe(70);
    expect(state.activeOrders.get(sale.id)).toMatchObject({ ...sale, items: sale.items });
    expect(commitStock).not.toHaveBeenCalled();
    expect(releaseCommittedStock).not.toHaveBeenCalled();
  });

  it('blocks remote editing, saving, normal closing and every cancel entrypoint', async () => {
    const sale = remoteSale();
    dbState.sales.set(sale.id, sale);
    await useActiveOrders.getState().loadOpenOrder(sale.id);
    const state = useActiveOrders.getState();
    expect(() => state.setTableData('Changed')).toThrow('otro dispositivo');
    expect(() => state.updateItemQuantity('original-line', 2)).toThrow('otro dispositivo');
    expect(() => state.clearOrder()).toThrow('otro dispositivo');
    await expect(state.addSmartItem({ id: 'pizza', batchManagement: { enabled: true } })).rejects.toThrow('otro dispositivo');
    await expect(state.saveOrderAsOpen()).resolves.toMatchObject({ success: false, code: 'CLOUD_TABLE_READ_ONLY' });
    await expect(state.cancelCurrentOrder()).rejects.toThrow('otro dispositivo');
    await expect(state.cancelOrder(sale.id)).rejects.toThrow('otro dispositivo');
    await expect(state.cancelOpenSaleByIdFromPos(sale.id)).resolves.toMatchObject({ success: false });
    await expect(state.closeOrder(sale.id, {})).rejects.toMatchObject({ code: 'CLOUD_TABLE_NORMAL_CHECKOUT_BLOCKED' });
    expect(dbState.sales.get(sale.id)).toEqual(sale);
    expect(useActiveOrders.getState().activeOrders.get(sale.id)?.items).toEqual(sale.items);
    expect(commitStock).not.toHaveBeenCalled();
    expect(releaseCommittedStock).not.toHaveBeenCalled();
  });

  it('detaches a remote tab without saving, cancelling or releasing its snapshot', async () => {
    const sale = remoteSale();
    dbState.sales.set(sale.id, sale);
    await useActiveOrders.getState().loadOpenOrder(sale.id);
    await expect(useActiveOrders.getState().pauseOrder(sale.id)).resolves.toMatchObject({ success: true, detached: true });
    expect(useActiveOrders.getState().activeOrders.has(sale.id)).toBe(false);
    expect(dbState.sales.get(sale.id)).toEqual(sale);
    expect(commitStock).not.toHaveBeenCalled();
    expect(releaseCommittedStock).not.toHaveBeenCalled();
  });

  it('keeps the remote Cloud version and read-only marker when session orders reload', async () => {
    const sale = { ...remoteSale(), fulfillmentStatus: 'pending' };
    dbState.sales.set(sale.id, sale);
    useActiveOrders.setState({
      currentOrderId: sale.id,
      activeOrders: new Map([[sale.id, { ...sale, total: '1', updatedAt: '2099-01-01T00:00:00Z', revision: 99 }]])
    });
    await useActiveOrders.getState().loadOrdersFromDB();
    expect(useActiveOrders.getState().activeOrders.get(sale.id)).toMatchObject(sale);
    expect(() => useActiveOrders.getState().clearOrder()).toThrow('otro dispositivo');
  });

  it('upserts an ecommerce draft atomically without PII and reuses the deterministic tab', () => {
    const draft = {
      id: 'ecom-11111111-1111-4111-8111-111111111111',
      items: [{ id: 'product-1', lineId: 'ecom-line-1', name: 'Producto', price: 20, quantity: 2 }],
      ecommerceOrderId: '11111111-1111-4111-8111-111111111111',
      ecommerceOrderCode: 'EC-00000011',
      ecommerceLicenseIdentity: 'ecomctx-safe',
      ecommerceDraftStatus: 'claimed',
      ecommerceClaimToken: 'opaque-token',
      fulfillmentMethod: 'pickup',
      expectedSubtotal: 40,
      expectedTotal: 40,
      currency: 'MXN'
    };

    const first = useActiveOrders.getState().upsertEcommerceDraft(draft);
    const second = useActiveOrders.getState().upsertEcommerceDraft({ ...draft, items: [] });
    const stored = useActiveOrders.getState().activeOrders.get(draft.id);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(stored.items).toHaveLength(1);
    expect(stored.total).toBe(40);
    expect(stored.customer).toBeNull();
    expect(JSON.stringify(stored)).not.toContain('phone');
    expect(JSON.stringify(stored)).not.toContain('address');
    expect(JSON.stringify(stored)).not.toContain('notes');
    expect(useActiveOrders.getState().currentOrderId).toBe(draft.id);
  });

  it('establishes an active-order creation timestamp once for checkout retries', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-30T10:00:00.000Z'));
      useActiveOrders.setState({
        activeOrders: new Map([['order-without-created-at', makeOrder('order-without-created-at', [])]])
      });
      useActiveOrders.getState().updateOrder('order-without-created-at', { createdAt: null });

      const first = useActiveOrders.getState().ensureOrderCreationTimestamp('order-without-created-at');
      vi.setSystemTime(new Date('2026-08-30T10:10:00.000Z'));
      const second = useActiveOrders.getState().ensureOrderCreationTimestamp('order-without-created-at');

      expect(first).toBe('2026-08-30T10:00:00.000Z');
      expect(second).toBe(first);
      expect(useActiveOrders.getState().activeOrders.get('order-without-created-at').createdAt).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the local creation timestamp when an open SALES row has none', async () => {
    const orderId = 'order-without-sales-timestamp';
    const stableCreatedAt = '2026-08-29T12:34:56.000Z';
    useActiveOrders.setState({
      activeOrders: new Map([[orderId, { ...makeOrder(orderId, [{ id: 'product-1', price: 10, quantity: 1 }]), createdAt: stableCreatedAt }]]),
      currentOrderId: orderId
    });
    dbState.sales.set(orderId, {
      id: orderId,
      status: 'open',
      items: [{ id: 'product-1', price: 10, quantity: 1 }],
      total: 10,
      revision: 0,
      updatedAt: null
    });

    await useActiveOrders.getState().loadOrdersFromDB();

    expect(useActiveOrders.getState().activeOrders.get(orderId)?.createdAt).toBe(stableCreatedAt);
  });

  it.each([
    {
      name: 'the newer persisted draft wins mutable fields',
      durableRevision: 1,
      draftRevision: 2,
      expectedItem: 'draft-item'
    },
    {
      name: 'the durable SALES row wins mutable fields',
      durableRevision: 2,
      draftRevision: 1,
      expectedItem: 'durable-item'
    }
  ])('keeps the durable creation timestamp when $name', async ({ durableRevision, draftRevision, expectedItem }) => {
    const orderId = 'order-divergent-timestamp';
    const durableTimestamp = '2026-08-30T10:00:00.000Z';
    const draftTimestamp = '2026-08-30T10:10:00.000Z';
    dbState.sales.set(orderId, {
      id: orderId,
      status: 'open',
      timestamp: durableTimestamp,
      updatedAt: durableRevision > draftRevision ? '2026-08-30T10:20:00.000Z' : durableTimestamp,
      revision: durableRevision,
      items: [{ id: 'durable-item', price: 10, quantity: 1 }],
      total: 10
    });
    useActiveOrders.setState({
      activeOrders: new Map([[
        orderId,
        {
          ...makeOrder(orderId, [{ id: 'draft-item', price: 20, quantity: 1 }]),
          createdAt: draftTimestamp,
          updatedAt: draftRevision > durableRevision ? '2026-08-30T10:20:00.000Z' : draftTimestamp,
          revision: draftRevision,
          total: 20
        }
      ]]),
      currentOrderId: orderId
    });

    await useActiveOrders.getState().loadOrdersFromDB();

    const merged = useActiveOrders.getState().activeOrders.get(orderId);
    expect(merged.createdAt).toBe(durableTimestamp);
    expect(merged.items[0].id).toBe(expectedItem);
  });

  it('keeps the local ecommerce draft when remote release fails and removes it after success', async () => {
    const id = 'ecom-11111111-1111-4111-8111-111111111111';
    useActiveOrders.getState().upsertEcommerceDraft({
      id,
      items: [{ id: 'product-1', lineId: 'line-1', price: 10, quantity: 1 }],
      ecommerceOrderId: '11111111-1111-4111-8111-111111111111',
      ecommerceOrderCode: 'EC-00000011',
      ecommerceLicenseIdentity: 'ecomctx-safe',
      ecommerceDraftStatus: 'prepared',
      ecommerceClaimToken: 'opaque-token'
    });

    dbState.releasePosDraft.mockResolvedValueOnce({ success: false, code: 'NETWORK' });
    const failed = await useActiveOrders.getState().releaseEcommerceDraft(id);
    expect(failed.success).toBe(false);
    expect(useActiveOrders.getState().activeOrders.has(id)).toBe(true);

    dbState.releasePosDraft.mockResolvedValueOnce({ success: true });
    const released = await useActiveOrders.getState().releaseEcommerceDraft(id);
    expect(released.success).toBe(true);
    expect(useActiveOrders.getState().activeOrders.has(id)).toBe(false);
    expect(dbState.releasePosDraft).toHaveBeenLastCalledWith(expect.objectContaining({
      orderId: '11111111-1111-4111-8111-111111111111',
      claimToken: 'opaque-token'
    }));
  });

  it('prunes ecommerce drafts fail-closed while preserving normal orders', () => {
    useActiveOrders.setState({
      activeOrders: new Map([
        ['normal', makeOrder('normal')],
        ['ecom-a', { ...makeOrder('ecom-a'), origin: 'ecommerce', ecommerceLicenseIdentity: 'license-a' }],
        ['ecom-b', { ...makeOrder('ecom-b'), origin: 'ecommerce', ecommerceLicenseIdentity: 'license-b' }]
      ]),
      currentOrderId: 'ecom-a'
    });

    useActiveOrders.getState().pruneEcommerceDraftsForContext({ licenseIdentity: 'license-b', canPrepare: true });
    expect(Array.from(useActiveOrders.getState().activeOrders.keys())).toEqual(['normal', 'ecom-b']);
    expect(useActiveOrders.getState().currentOrderId).toBe('normal');

    useActiveOrders.getState().pruneEcommerceDraftsForContext({ licenseIdentity: null, canPrepare: false });
    expect(Array.from(useActiveOrders.getState().activeOrders.keys())).toEqual(['normal']);
  });

  it('derives the current order after every state update', () => {
    useActiveOrders.setState({
      activeOrders: new Map([
        ['one', makeOrder('one')],
        ['two', makeOrder('two')]
      ]),
      currentOrderId: 'one'
    });

    expect(selectCurrentOrder(useActiveOrders.getState())?.id).toBe('one');

    useActiveOrders.getState().switchOrder('two');

    expect(selectCurrentOrder(useActiveOrders.getState())?.id).toBe('two');
    expect(useActiveOrders.getState()).not.toHaveProperty('order');
    expect(useActiveOrders.getState()).not.toHaveProperty('activeOrderId');
  });

  it('keeps focused selector references stable when only checkout lock metadata changes', () => {
    const items = [{ id: 'product-1', quantity: 1, price: 25 }];
    const customer = { id: 'customer-1' };
    const order = {
      ...makeOrder('one', items),
      customer,
      tableData: 'Mesa 1'
    };

    useActiveOrders.setState({
      activeOrders: new Map([['one', order]]),
      currentOrderId: 'one'
    });

    const before = useActiveOrders.getState();
    const selectedItems = selectCurrentOrderItems(before);
    const selectedCustomer = selectCurrentOrderCustomer(before);
    const selectedTableData = selectCurrentOrderTableData(before);

    useActiveOrders.setState({
      activeOrders: new Map([[
        'one',
        { ...order, isLockedForCheckout: true, lockedAt: '2026-06-14T12:00:00.000Z' }
      ]])
    });

    const after = useActiveOrders.getState();
    expect(selectCurrentOrderItems(after)).toBe(selectedItems);
    expect(selectCurrentOrderCustomer(after)).toBe(selectedCustomer);
    expect(selectCurrentOrderTableData(after)).toBe(selectedTableData);
  });

  it('rotates an unsaved order identity when payment is cancelled', () => {
    const oldOrder = makeOrder('sale-old', [
      { id: 'product-1', lineId: 'line-1', name: 'Producto', quantity: 1, price: 25 }
    ]);

    useActiveOrders.setState({
      activeOrders: new Map([['sale-old', oldOrder]]),
      currentOrderId: 'sale-old'
    });

    const result = useActiveOrders.getState().rotateCurrentOrderForNewSaleAttempt('sale-old');
    const state = useActiveOrders.getState();
    const rotated = state.activeOrders.get('sal-generated');

    expect(result).toMatchObject({
      success: true,
      rotated: true,
      oldOrderId: 'sale-old',
      orderId: 'sal-generated'
    });
    expect(state.currentOrderId).toBe('sal-generated');
    expect(state.activeOrders.has('sale-old')).toBe(false);
    expect(rotated).toMatchObject({
      id: 'sal-generated',
      items: oldOrder.items,
      total: 0,
      folio: null,
      isSaved: false,
      isLockedForCheckout: false,
      checkoutAttemptId: null
    });
  });

  it('keeps saved and ecommerce order identities stable when payment is cancelled', () => {
    const savedOrder = { ...makeOrder('saved-order'), isSaved: true };
    useActiveOrders.setState({
      activeOrders: new Map([['saved-order', savedOrder]]),
      currentOrderId: 'saved-order'
    });

    const result = useActiveOrders.getState().rotateCurrentOrderForNewSaleAttempt('saved-order');

    expect(result).toMatchObject({ success: true, rotated: false, reason: 'persistent_order' });
    expect(useActiveOrders.getState().currentOrderId).toBe('saved-order');
    expect(useActiveOrders.getState().activeOrders.has('saved-order')).toBe(true);
  });

  it('applies the same cart rules to a non-current order', async () => {
    useActiveOrders.setState({
      activeOrders: new Map([
        ['one', makeOrder('one')],
        ['two', makeOrder('two')]
      ]),
      currentOrderId: 'one'
    });

    const product = {
      id: 'product-1',
      name: 'Product',
      price: 25,
      saleType: 'unit',
      trackStock: false
    };

    await useActiveOrders.getState().addItemToOrder('two', product);
    await useActiveOrders.getState().addItemToOrder('two', product);

    const state = useActiveOrders.getState();
    expect(state.currentOrderId).toBe('one');
    expect(state.activeOrders.get('one')?.items).toEqual([]);
    expect(state.activeOrders.get('two')?.items).toMatchObject([
      { id: 'product-1', quantity: 2, price: 25 }
    ]);
    expect(state.activeOrders.get('two')?.revision).toBe(2);
    expect(state.activeOrders.get('two')?.updatedAt).toEqual(expect.any(String));
    expect(state.activeOrders.get('two')?.deviceId).toEqual(expect.any(String));
  });

  it('blocks claiming the final unit twice in two active orders', async () => {
    useActiveOrders.setState({
      activeOrders: new Map([['one', makeOrder('one')], ['two', makeOrder('two')]]),
      currentOrderId: 'one'
    });
    const product = {
      id: 'product-1', name: 'Product', price: 25,
      saleType: 'unit', trackStock: true, stock: 1, committedStock: 0
    };
    await useActiveOrders.getState().addItemToOrder('one', product);
    const blocked = await useActiveOrders.getState().addItemToOrder('two', product);
    const state = useActiveOrders.getState();
    expect(state.activeOrders.get('one').items[0].quantity).toBe(1);
    expect(state.activeOrders.get('two').items).toEqual([]);
    expect(blocked).toMatchObject({ success: false });
  });

  it('blocks the old stock-2 lot conflict before B acquires a misleading line', async () => {
    const product = {
      id: 'X', productId: 'X', name: 'X', price: 10, stock: 2,
      committedStock: 0, saleType: 'unit', trackStock: true,
      batchManagement: { enabled: true }
    };
    dbState.products.set('X', product);
    dbState.batches = [{
      id: 'lot-1', productId: 'X', stock: 2, committedStock: 0,
      isActive: true, price: 10, cost: 5
    }];
    const a = { ...makeOrder('A', [{
      ...product, lineId: 'a-X', quantity: 2, batchId: 'lot-1',
      provisionalAddedAt: '2026-11-06T00:00:00.000Z'
    }]), actorKey: 'staff:one' };
    const b = { ...makeOrder('B'), actorKey: 'staff:one' };
    useActiveOrders.setState({
      activeOrders: new Map([['A', a], ['B', b]]),
      currentOrderId: 'B'
    });
    const blocked = await useActiveOrders.getState().addSmartItem(product, 'B');
    expect(blocked).toMatchObject({
      success: false, code: 'LOCAL_INVENTORY_NOT_TRANSFERABLE'
    });
    expect(showMessageModal).not.toHaveBeenCalled();
    expect(useActiveOrders.getState().inventoryConflictNotice).toMatchObject({
      orderId: 'B', productName: 'X', availableBeforeCarts: 2,
      provisionalInOtherCarts: 2, freeInThisCart: 0, sourceCount: 1,
      sourceOrderId: null
    });
    expect(showConfirmModal).not.toHaveBeenCalled();
    expect(useActiveOrders.getState().activeOrders.get('A').items[0].quantity).toBe(2);
    expect(useActiveOrders.getState().activeOrders.get('B').items).toEqual([]);

    // A releases one unit explicitly, then B can use that same batch.
    expect(useActiveOrders.getState().updateItemQuantity('a-X', 1, 'A')).toMatchObject({ success: true });
    const allowed = await useActiveOrders.getState().addSmartItem(product, 'B');
    expect(allowed).toMatchObject({ success: true });
    const orders = useActiveOrders.getState().activeOrders;
    expect(orders.get('A').items[0].quantity).toBe(1);
    expect(orders.get('B').items[0]).toMatchObject({
      quantity: 1, batchId: 'lot-1', exceedsStock: false
    });
    expect(useActiveOrders.getState().inventoryConflictNotice).toBeNull();

    const third = await useActiveOrders.getState().addSmartItem(product, 'B');
    expect(third).toMatchObject({ success: false, code: 'LOCAL_INVENTORY_NOT_TRANSFERABLE' });
    expect(useActiveOrders.getState().inventoryConflictNotice).toMatchObject({
      availableBeforeCarts: 2, provisionalInOtherCarts: 1, freeInThisCart: 0
    });
    expect(orders.get('A').items[0].quantity).toBe(1);
    expect(orders.get('B').items[0].quantity).toBe(1);
    expect(dbState.products.get('X')).toEqual(product);
    expect(dbState.batches[0]).toMatchObject({ stock: 2, committedStock: 0 });
    expect(commitStock).not.toHaveBeenCalled();
    expect(releaseCommittedStock).not.toHaveBeenCalled();
  });

  it('reports verified net batch stock once: physical 5, committed 2, A 3, B denied', async () => {
    const product = {
      id: 'X', name: 'Lote con reservas', price: 10, stock: 5, committedStock: 2,
      trackStock: true, saleType: 'unit', batchManagement: { enabled: true }
    };
    const batch = {
      id: 'lot-net', productId: 'X', stock: 5, committedStock: 2,
      price: 10, cost: 4, isActive: true
    };
    dbState.products.set('X', product);
    dbState.batches = [batch];
    const a = { ...makeOrder('A', [{
      ...product, batchId: batch.id, stock: 3, quantity: 3, lineId: 'A-X'
    }]) };
    const b = makeOrder('B');
    useActiveOrders.setState({
      activeOrders: new Map([['A', a], ['B', b]]), currentOrderId: 'B'
    });

    const result = await useActiveOrders.getState().addSmartItem(product, 'B');
    expect(result).toMatchObject({ success: false, code: 'LOCAL_INVENTORY_NOT_TRANSFERABLE' });
    expect(useActiveOrders.getState().inventoryConflictNotice).toMatchObject({
      productName: 'Lote con reservas',
      availableBeforeCarts: 3, provisionalInOtherCarts: 3,
      freeInThisCart: 0, sourceCount: 1
    });
    expect(useActiveOrders.getState().activeOrders.get('A')).toBe(a);
    expect(useActiveOrders.getState().activeOrders.get('B')).toBe(b);
    expect(dbState.products.get('X')).toEqual(product);
    expect(dbState.batches).toEqual([batch]);
    expect(commitStock).not.toHaveBeenCalled();
    expect(releaseCommittedStock).not.toHaveBeenCalled();
    expect(showConfirmModal).not.toHaveBeenCalled();
  });

  it('omits unverified batch stock instead of displaying NaN or double-discounted availability', async () => {
    const product = {
      id: 'X', name: 'Lote incompleto', price: 10, stock: 5, committedStock: 0,
      trackStock: true, saleType: 'unit', batchManagement: { enabled: true }
    };
    dbState.batches = [{
      id: 'lot-unknown', productId: 'X', stock: 5, committedStock: Number.NaN,
      price: 10, cost: 4, isActive: true
    }];
    const a = makeOrder('A', [{ ...product, batchId: 'lot-unknown', quantity: 5 }]);
    const b = makeOrder('B');
    useActiveOrders.setState({
      activeOrders: new Map([['A', a], ['B', b]]), currentOrderId: 'B'
    });

    const result = await useActiveOrders.getState().addSmartItem(product, 'B');
    expect(result).toMatchObject({ success: false, code: 'LOCAL_INVENTORY_NOT_TRANSFERABLE' });
    const notice = useActiveOrders.getState().inventoryConflictNotice;
    expect(notice).toMatchObject({
      availableBeforeCarts: null, provisionalInOtherCarts: 5,
      freeInThisCart: null, sourceCount: 1
    });
    expect(Number.isNaN(notice.availableBeforeCarts)).toBe(false);
    expect(useActiveOrders.getState().activeOrders.get('A')).toBe(a);
    expect(useActiveOrders.getState().activeOrders.get('B')).toBe(b);
    expect(commitStock).not.toHaveBeenCalled();
    expect(releaseCommittedStock).not.toHaveBeenCalled();
  });

  it('identifies a single named source and opens it only on explicit, authorized action', async () => {
    const actor = vi.spyOn(actorRuntimeController, 'getState')
      .mockReturnValue({ status: 'granted', actorKey: 'staff:one' });
    const capture = vi.spyOn(actorRuntimeController, 'capture')
      .mockReturnValue({ actorKey: 'staff:one', assertCurrent: vi.fn() });
    try {
      const item = {
        id: 'X', name: 'Producto X', price: 10, saleType: 'unit',
        batchId: 'lot-1', trackStock: true, stock: 2, committedStock: 0
      };
      const a = { ...makeOrder('A', [{ ...item, lineId: 'A-X', quantity: 2 }]),
        tableData: 'Venta A', actorKey: 'staff:one' };
      const b = { ...makeOrder('B'), actorKey: 'staff:one' };
      useActiveOrders.setState({ activeOrders: new Map([['A', a], ['B', b]]), currentOrderId: 'B' });
      dbState.batches = [{ id: 'lot-1', productId: 'X', stock: 2, committedStock: 0, isActive: true }];
      const blocked = await useActiveOrders.getState().addItem(item, 'B');
      expect(blocked.code).toBe('LOCAL_INVENTORY_NOT_TRANSFERABLE');
      const notice = useActiveOrders.getState().inventoryConflictNotice;
      expect(notice).toMatchObject({
        productName: 'Producto X', sourceCount: 1, singleSourceLabel: 'Venta A',
        sourceOrderId: 'A', provisionalInOtherCarts: 2,
        availableBeforeCarts: 2, freeInThisCart: 0
      });
      expect(useActiveOrders.getState().currentOrderId).toBe('B');
      expect(capture).toHaveBeenCalledOnce(); // Inventory read checks authority; navigation still awaits the tap.
      expect(useActiveOrders.getState().openInventoryConflictSource()).toBe(true);
      expect(capture).toHaveBeenCalledWith('pos');
      expect(useActiveOrders.getState().currentOrderId).toBe('A');
      expect(useActiveOrders.getState().inventoryConflictNotice).toBeNull();
      expect(useActiveOrders.getState().activeOrders.get('A').items[0].quantity).toBe(2);
      expect(useActiveOrders.getState().activeOrders.get('B').items).toEqual([]);
    } finally {
      capture.mockRestore();
      actor.mockRestore();
    }
  });

  it('does not invent a source when multiple carts use the same batch', async () => {
    const item = {
      id: 'X', name: 'Producto X', price: 10, saleType: 'unit',
      batchId: 'lot-1', trackStock: true, stock: 2, committedStock: 0
    };
    const a = { ...makeOrder('A', [{ ...item, quantity: 1 }]), tableData: 'Venta A' };
    const c = { ...makeOrder('C', [{ ...item, quantity: 1 }]), tableData: 'Venta C' };
    const b = makeOrder('B');
    useActiveOrders.setState({
      activeOrders: new Map([['A', a], ['C', c], ['B', b]]), currentOrderId: 'B'
    });
    dbState.batches = [{ id: 'lot-1', productId: 'X', stock: 2, committedStock: 0, isActive: true }];
    const blocked = await useActiveOrders.getState().addItem(item, 'B');
    expect(blocked.code).toBe('LOCAL_INVENTORY_NOT_TRANSFERABLE');
    expect(useActiveOrders.getState().inventoryConflictNotice).toMatchObject({
      sourceCount: 2, sourceOrderId: null, singleSourceLabel: null,
      availableBeforeCarts: 2, provisionalInOtherCarts: 2, freeInThisCart: 0
    });
    expect(useActiveOrders.getState().openInventoryConflictSource()).toBe(false);
    expect(useActiveOrders.getState().activeOrders.get('A')).toBe(a);
    expect(useActiveOrders.getState().activeOrders.get('C')).toBe(c);
    expect(useActiveOrders.getState().activeOrders.get('B')).toBe(b);
  });

  it('distinguishes formally unavailable stock from provisional claims, omitting unknown figures', () => {
    const b = makeOrder('B');
    useActiveOrders.setState({
      activeOrders: new Map([['B', b]]), currentOrderId: 'B'
    });
    const item = {
      id: 'X', name: 'Producto X', price: 10, saleType: 'unit',
      batchManagement: { enabled: true }, trackStock: true, stock: 2, committedStock: 2
    };
    expect(useActiveOrders.getState().addItem(item, 'B').code).toBe('LOCAL_INVENTORY_NOT_TRANSFERABLE');
    expect(useActiveOrders.getState().inventoryConflictNotice).toMatchObject({
      availableBeforeCarts: null, provisionalInOtherCarts: 0,
      freeInThisCart: null, sourceCount: 0, sourceOrderId: null
    });
    useActiveOrders.getState().dismissInventoryConflictNotice();
    expect(useActiveOrders.getState().inventoryConflictNotice).toBeNull();
    expect(useActiveOrders.getState().addItem({ ...item, stock: undefined }, 'B').code)
      .toBe('LOCAL_INVENTORY_NOT_TRANSFERABLE');
    expect(useActiveOrders.getState().inventoryConflictNotice).toMatchObject({
      availableBeforeCarts: null, freeInThisCart: null, sourceCount: 0
    });
    expect(useActiveOrders.getState().activeOrders.get('B')).toBe(b);
  });

  it.each([false, true])('two-unit conflict %s: a single operator confirmation keeps both carts coherent', async (confirm) => {
    const a = { ...makeOrder('A', [{
      id: 'X', productId: 'X', lineId: 'A-line', name: 'X', quantity: 2,
      saleType: 'unit', trackStock: true, price: 10, stock: 2,
      committedStock: 0, provisionalAddedAt: '2026-11-06T00:00:00.000Z'
    }]), actorKey: 'staff:one' };
    const b = { ...makeOrder('B'), actorKey: 'staff:one' };
    dbState.products.set('X', {
      id: 'X', name: 'X', price: 10, stock: 2, committedStock: 0,
      trackStock: true, saleType: 'unit'
    });
    useActiveOrders.setState({
      activeOrders: new Map([['A', a], ['B', b]]), currentOrderId: 'B'
    });
    showConfirmModal.mockResolvedValueOnce(confirm);
    const capture = vi.spyOn(actorRuntimeController, 'capture')
      .mockReturnValue({ actorKey: 'staff:one', assertCurrent: vi.fn() });
    try {
      const attempt = useActiveOrders.getState().addItem({
        id: 'X', name: 'X', price: 10, trackStock: true, saleType: 'unit',
        stock: 2, committedStock: 0
      }, 'B');
      expect(attempt).toMatchObject({ success: false, code: 'LOCAL_PRIORITY_CONFLICT' });
      expect(useActiveOrders.getState().activeOrders.get('A').items[0].quantity).toBe(2);
      expect(useActiveOrders.getState().activeOrders.get('B').items).toEqual([]);
      if (confirm) {
        await vi.waitFor(() => {
          const state = useActiveOrders.getState();
          expect(state.activeOrders.get('A').items[0].quantity).toBe(1);
          expect(state.activeOrders.get('B').items[0]).toMatchObject({
            quantity: 1, exceedsStock: false
          });
          expect(state.activeOrders.get('A').total).toBe(10);
          expect(state.activeOrders.get('B').total).toBe(10);
        });
      } else {
        await vi.waitFor(() => expect(showConfirmModal).toHaveBeenCalledOnce());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(useActiveOrders.getState().activeOrders.get('A')).toBe(a);
        expect(useActiveOrders.getState().activeOrders.get('B')).toBe(b);
      }
      expect(showConfirmModal).toHaveBeenCalledOnce();
    } finally {
      capture.mockRestore();
    }
  });

  it.each([
    { permissions: ['pos'], authorized: true },
    { permissions: ['reports'], authorized: false }
  ])('Staff permissions $permissions: confirm reassignment authorized=$authorized', async ({ permissions, authorized }) => {
    const scopedActor = createActorRuntimeController({
      getTenantAuthority: () => ({
        opaqueId: 'tenant-test', databaseName: 'LanzoDB_t_tenant-test', generation: 1
      })
    });
    scopedActor.beginAuthentication({ actorType: 'staff' });
    scopedActor.grant({
      actorType: 'staff', actorId: 'one', sessionId: 'session-one',
      tenantOpaqueId: 'tenant-test', permissions
    });
    const capture = vi.spyOn(actorRuntimeController, 'capture')
      .mockImplementation((permission) => scopedActor.capture(permission));

    const item = {
      id: 'X', productId: 'X', lineId: 'A-X', name: 'X', price: 10,
      quantity: 2, trackStock: true, saleType: 'unit',
      stock: 2, committedStock: 0,
      provisionalAddedAt: '2026-11-06T00:00:00.000Z'
    };
    const a = { ...makeOrder('A', [item]), actorKey: 'staff:one' };
    const b = { ...makeOrder('B'), actorKey: 'staff:one' };
    dbState.products.set('X', {
      id: 'X', name: 'X', price: 10,
      stock: 2, committedStock: 0, trackStock: true
    });
    useActiveOrders.setState({
      activeOrders: new Map([['A', a], ['B', b]]),
      currentOrderId: 'B'
    });
    showConfirmModal.mockResolvedValueOnce(true);
    try {
      const result = useActiveOrders.getState().addItem({
        id: 'X', name: 'X', price: 10, saleType: 'unit',
        trackStock: true, stock: 2, committedStock: 0
      }, 'B');
      expect(result).toMatchObject({ success: false, code: 'LOCAL_PRIORITY_CONFLICT' });
      expect(capture).toHaveBeenCalledWith('pos');
      if (authorized) {
        await vi.waitFor(() => {
          const updated = useActiveOrders.getState().activeOrders;
          expect(updated.get('A').items[0].quantity).toBe(1);
          expect(updated.get('B').items[0].quantity).toBe(1);
        });
        expect(showConfirmModal).toHaveBeenCalledOnce();
      } else {
        expect(showConfirmModal).not.toHaveBeenCalled();
        expect(useActiveOrders.getState().activeOrders.get('A')).toBe(a);
        expect(useActiveOrders.getState().activeOrders.get('B')).toBe(b);
      }
    } finally {
      capture.mockRestore();
    }
  });

  it('resolves batch data before mutating the order', async () => {
    let resolveBatches;
    dbState.batchLoadPromise = new Promise((resolve) => {
      resolveBatches = resolve;
    });

    useActiveOrders.setState({
      activeOrders: new Map([['one', makeOrder('one')]]),
      currentOrderId: 'one'
    });

    const addPromise = useActiveOrders.getState().addSmartItem({
      id: 'product-batch',
      name: 'Batch product',
      price: 20,
      cost: 8,
      saleType: 'unit',
      trackStock: true,
      batchManagement: { enabled: true }
    });

    expect(useActiveOrders.getState().activeOrders.get('one')?.items).toEqual([]);
    expect(useActiveOrders.getState().pendingInventoryResolutions.get('one')).toBe(1);

    resolveBatches([{
      id: 'batch-1',
      productId: 'product-batch',
      price: 25,
      cost: 10,
      stock: 4,
      committedStock: 1,
      isActive: true,
      sku: 'BATCH-1'
    }]);
    await addPromise;

    const items = useActiveOrders.getState().activeOrders.get('one')?.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'product-batch',
      productId: 'product-batch',
      lineId: expect.any(String),
      batchId: 'batch-1',
      price: 20,
      cost: 10,
      stock: 3,
      quantity: 1,
      isVariant: false,
      skuDetected: 'BATCH-1'
    });
    expect(items[0].lineId).not.toBe(items[0].id);
    expect(useActiveOrders.getState().pendingInventoryResolutions.has('one')).toBe(false);
  });

  it('updates and removes cart lines by lineId without touching duplicate product ids', () => {
    useActiveOrders.setState({
      activeOrders: new Map([[
        'one',
        makeOrder('one', [
          { id: 'product-1', lineId: 'line-a', name: 'Product', quantity: 1, price: 10, saleType: 'unit' },
          { id: 'product-1', lineId: 'line-b', name: 'Product', quantity: 2, price: 10, saleType: 'unit' }
        ])
      ]]),
      currentOrderId: 'one'
    });

    useActiveOrders.getState().updateItemQuantity('line-b', 4);

    expect(useActiveOrders.getState().activeOrders.get('one')?.items).toMatchObject([
      { id: 'product-1', lineId: 'line-a', quantity: 1 },
      { id: 'product-1', lineId: 'line-b', quantity: 4 }
    ]);

    useActiveOrders.getState().removeItem('line-a');

    expect(useActiveOrders.getState().activeOrders.get('one')?.items).toMatchObject([
      { id: 'product-1', lineId: 'line-b', quantity: 4 }
    ]);
  });

  it('stores explicit productId for catalog, variant, modifier, and scanner lines', async () => {
    useActiveOrders.setState({
      activeOrders: new Map([['one', makeOrder('one')]]),
      currentOrderId: 'one'
    });

    useActiveOrders.getState().addItem({
      id: 'product-1',
      lineId: 'line-1',
      name: 'Producto',
      price: 20,
      quantity: 1,
      saleType: 'unit',
      trackStock: false
    });
    dbState.batches = [{ id: 'batch-2', productId: 'product-2', stock: 2, committedStock: 0, isActive: true }];
    await useActiveOrders.getState().addItem({
      id: 'product-2',
      parentId: 'product-2',
      lineId: 'line-2',
      name: 'Variante',
      price: 25,
      quantity: 1,
      saleType: 'unit',
      isVariant: true,
      batchId: 'batch-2',
      trackStock: false
    });
    useActiveOrders.getState().addItem({
      id: 'product-3',
      lineId: 'line-3',
      name: 'Producto con modificadores',
      price: 30,
      quantity: 1,
      saleType: 'unit',
      selectedModifiers: [{ id: 'extra', name: 'Extra', price: 5 }],
      trackStock: false
    });
    useActiveOrders.getState().addScannedProduct({
      id: 'product-4',
      lineId: 'scan-line-4',
      name: 'Producto escaneado',
      price: 40,
      saleType: 'unit',
      trackStock: false
    });

    const items = useActiveOrders.getState().activeOrders.get('one')?.items;
    expect(items).toHaveLength(4);
    expect(items).toMatchObject([
      { id: 'product-1', lineId: 'line-1', productId: 'product-1' },
      { id: 'product-2', lineId: 'line-2', productId: 'product-2', parentId: 'product-2' },
      { id: 'product-3', lineId: 'line-3', productId: 'product-3', selectedModifiers: [{ id: 'extra' }] },
      { id: 'product-4', lineId: 'scan-line-4', productId: 'product-4' }
    ]);
  });

  it('normalizes multiple scanner lines while preserving line identity', () => {
    useActiveOrders.setState({
      activeOrders: new Map([['one', makeOrder('one')]]),
      currentOrderId: 'one'
    });

    const result = useActiveOrders.getState().addMultipleScannedProducts([
      {
        id: 'scan-product-1',
        lineId: 'scan-line-1',
        name: 'Escaneado',
        price: 12.5,
        quantity: 2,
        saleType: 'unit',
        trackStock: false
      },
      {
        id: 'scan-product-2',
        lineId: 'scan-line-2',
        name: 'Escaneado por peso',
        price: 9.5,
        quantity: 2,
        saleType: 'bulk',
        trackStock: false
      }
    ]);

    expect(result).toMatchObject({ success: true, addedCount: 4 });
    const items = useActiveOrders.getState().activeOrders.get('one')?.items;
    expect(items).toHaveLength(3);
    expect(items).toMatchObject([
      { id: 'scan-product-1', lineId: 'scan-line-1', productId: 'scan-product-1', quantity: 2 },
      { id: 'scan-product-2', productId: 'scan-product-2', quantity: 1 },
      { id: 'scan-product-2', productId: 'scan-product-2', quantity: 1 }
    ]);
    expect(items[1].lineId).not.toBe(items[2].lineId);
    expect(items[1].lineId).toBe('scan-line-2');
  });

  it('authorizes below-cost wholesale on the target lineId only', () => {
    useActiveOrders.setState({
      activeOrders: new Map([[
        'one',
        makeOrder('one', [
          { id: 'product-1', lineId: 'line-existing', name: 'Product', quantity: 1, price: 10, saleType: 'unit' }
        ])
      ]]),
      currentOrderId: 'one'
    });

    useActiveOrders.getState().addItem({
      id: 'product-1',
      lineId: 'line-new',
      name: 'Product',
      quantity: 1,
      price: 10,
      cost: 8,
      saleType: 'unit',
      trackStock: false,
      selectedModifiers: [{ name: 'Extra', price: 0 }],
      wholesaleTiers: [{ min: 1, price: 5 }]
    });

    expect(showMessageModal).toHaveBeenCalledOnce();
    showMessageModal.mock.calls[0][1]();

    const items = useActiveOrders.getState().activeOrders.get('one')?.items;
    expect(items).toMatchObject([
      { id: 'product-1', lineId: 'line-existing', quantity: 1, price: 10 },
      { id: 'product-1', lineId: 'line-new', quantity: 1, price: 5, forceWholesale: true }
    ]);
    expect(items[0].forceWholesale).toBeUndefined();
  });

  it('loads an open sale into the unified session', async () => {
    dbState.sales.set('sale-open', {
      id: 'sale-open',
      status: 'open',
      items: [{ id: 'product-1', quantity: 2, price: 10 }],
      tableData: 'Mesa 3',
      timestamp: '2026-06-09T01:00:00.000Z',
      total: 20
    });

    const result = await useActiveOrders.getState().loadOpenOrder('sale-open');
    const state = useActiveOrders.getState();

    expect(result).toEqual({ success: true });
    expect(state.currentOrderId).toBe('sale-open');
    expect(selectCurrentOrder(state)).toMatchObject({
      id: 'sale-open',
      tableData: 'Mesa 3',
      isSaved: true
    });
  });

  it('restores legacy review orders as visible open orders without releasing reservations', async () => {
    dbState.sales.set('sale-review', {
      id: 'sale-review',
      status: 'requires_review',
      fulfillmentStatus: 'completed',
      timestamp: '2026-06-01T01:00:00.000Z',
      items: [{
        id: 'product-1',
        quantity: 1,
        inventoryReservation: {
          source: 'table',
          committedQuantity: 1,
          committedBatches: []
        }
      }]
    });

    const result = await useActiveOrders.getState().reconcileOrphanedOrders();

    expect(result).toMatchObject({ success: true, recovered: 1 });
    expect(dbState.sales.get('sale-review')).toMatchObject({
      status: 'open',
      requiresReview: true
    });
  });

  it('keeps stale orders financially open while flagging them for review', async () => {
    dbState.sales.set('sale-stale', {
      id: 'sale-stale',
      status: 'open',
      fulfillmentStatus: 'completed',
      timestamp: '2020-01-01T00:00:00.000Z',
      items: []
    });

    const result = await useActiveOrders.getState().reconcileOrphanedOrders();

    expect(result).toMatchObject({ success: true, count: 1 });
    expect(dbState.sales.get('sale-stale')).toMatchObject({
      status: 'open',
      requiresReview: true
    });
  });

  it('repairs committed stock on batch-managed parent products', async () => {
    dbState.products.set('avocado', {
      id: 'avocado',
      stock: 2.5,
      committedStock: 1,
      batchManagement: { enabled: true }
    });
    dbState.batches = [{
      id: 'batch-avocado',
      productId: 'avocado',
      stock: 2.5,
      committedStock: 0
    }];

    const result = await useActiveOrders.getState().reconcileOrphanedOrders();

    expect(result).toMatchObject({ success: true, repairedBatchParents: 1 });
    expect(dbState.products.get('avocado')).toMatchObject({
      stock: 2.5,
      committedStock: 0
    });
  });
});
