import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../db/dexie', async () => {
  const { default: Dexie } = await import('dexie');
  const STORES = { SALES: 'sales', MENU: 'menu', PRODUCT_BATCHES: 'product_batches',
    TRANSACTION_LOG: 'transaction_log', INVENTORY_EVENTS: 'inventory_events', SEQUENCES: 'sequences', COMPANY: 'company' };
  const db = new Dexie('local-commit-boundary');
  db.version(1).stores({ sales: 'id,status', menu: 'id', product_batches: 'id,productId',
    transaction_log: 'id', inventory_events: 'id,[saleId+productId]', sequences: 'id', company: 'id' });
  return { db, STORES };
});
vi.mock('../../../store/useSalesStore', () => ({ useSalesStore: { getState: () => ({ loadRecentSales: async () => {} }) } }));
vi.mock('../../salesCloud/salesCloudCashierService', () => ({ salesCloudCashierService: {
  shouldUseCloudCashierSale: async () => ({ useCloud: false }) } }));
vi.mock('../../salesCloud/salesCloudShadowService', () => ({ salesCloudShadowService: { syncSaleShadowAfterLocalCommit: async () => {} } }));

import { db, STORES } from '../../db/dexie';
import { executeSaleTransactionSafe } from '../../db/index';
import { processSaleCore } from '../processSaleCore';
import { actorRuntimeController, createActorRuntimeController } from '../../auth/actorRuntimeController';
import { runCheckoutActorOperation } from '../../auth/actorOperationalHandoff';
import { calculatePricingDetails } from '../../pricingLogic';

let authority, handle, revoked;
const product = { id: 'p', name: 'Producto', price: 10, cost: 4, trackStock: true, stock: 10 };
const params = () => ({ activeOrderId: 'order-a', createdAt: '2026-08-30T00:00:00.000Z', order: [{ ...product, quantity: 1 }], total: 10,
  paymentData: { paymentMethod: 'tarjeta', amountPaid: 10 }, features: {}, actorContext: handle,
  allProducts: [product], companyName: 'Test' });
const deps = execute => ({ STORES,
  loadData: (table, id) => db.table(table).get(id),
  loadMultipleData: (table, ids) => db.table(table).bulkGet(ids),
  queryBatchesByProductIdAndActive: async () => [], queryByIndex: async () => [],
  saveData: (table, value) => db.table(table).put(value),
  executeSaleTransactionSafe: execute,
  useStatsStore: { getState: () => ({ updateStatsForNewSale: async () => {} }) },
  roundCurrency: value => Math.round(value * 100) / 100, calculatePricingDetails,
  Logger: { time() {}, timeEnd() {}, warn() {}, error() {}, info() {} }
});
const execute = executeSaleTransactionSafe;
const run = executeSale => runCheckoutActorOperation({ orderId: 'order-a', recognizeLocalCommit: true,
  operation: () => processSaleCore(params(), deps(executeSale)) });
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()));
  await db.table('menu').put(product);
  authority = createActorRuntimeController({ getTenantAuthority: () => ({ opaqueId: 't', databaseName: db.name, generation: 1 }) });
  authority.beginAuthentication({ actorType: 'staff' });
  authority.grant({ actorType: 'staff', actorId: 'a', sessionId: 's', permissions: ['pos'], deviceRef: 'd' });
  const captured = authority.capture();
  revoked = false;
  handle = { ...captured, assertCurrent(permission) {
    const current = captured.assertCurrent(permission);
    if (permission === 'pos' && revoked) throw Object.assign(new Error('POS revoked'), { code: 'ACTOR_PERMISSION_DENIED' });
    return current;
  } };
  vi.spyOn(actorRuntimeController, 'capture').mockImplementation(() => handle);
  vi.spyOn(actorRuntimeController, 'getState').mockImplementation(() => authority.getState());
  await db.table('sales').put({ id: 'order-a', status: 'open', isLockedForCheckout: true,
    checkoutAttemptId: 'attempt-a', checkoutActorKey: handle.actorKey, items: params().order });
});
afterAll(async () => { await db.delete(); });

it('rolls back sale, inventory and lock when POS is revoked inside the transaction', async () => {
  const hook = function () { revoked = true; };
  db.table('sales').hook('updating', hook);
  try {
    expect((await run(execute)).success).toBe(false);
    expect((await db.table('sales').get('order-a')).status).toBe('open');
    expect((await db.table('sales').get('order-a')).isLockedForCheckout).toBe(true);
    expect((await db.table('menu').get('p')).stock).toBe(10);
    expect(await db.table('transaction_log').count()).toBe(0);
  } finally { db.table('sales').hook('updating').unsubscribe(hook); }
});

it.each(['confirmed', 'confirmed-binding-change', 'lost-response'])('recognizes exactly one committed sale after revocation: %s', async mode => {
  const result = await run(async (...args) => {
    const committed = await execute(...args);
    revoked = true;
    if (mode === 'confirmed-binding-change') authority.lock('session_changed_after_commit');
    if (mode === 'lost-response') throw new Error('Response lost after commit');
    return committed;
  });
  expect(result).toMatchObject({ success: true, saleId: 'order-a' });
  expect((await db.table('menu').get('p')).stock).toBe(9);
  expect(await db.table('transaction_log').count()).toBe(1);
  expect((await db.table('sales').get('order-a')).status).toBe('closed');
  expect((await db.table('sales').get('order-a')).isLockedForCheckout).toBe(false);
  const retry = await processSaleCore(params(), deps(execute));
  expect(retry).toMatchObject({ success: true, saleId: 'order-a' });
  expect((await db.table('menu').get('p')).stock).toBe(9);
  expect(await db.table('transaction_log').count()).toBe(1);
});


it('rejects a new operation without POS before invoking the transaction', async () => {
  revoked = true;
  const commit = vi.fn(execute);
  await expect(run(commit)).rejects.toMatchObject({ code: 'ACTOR_PERMISSION_DENIED' });
  expect(commit).not.toHaveBeenCalled();
  expect((await db.table('sales').get('order-a')).status).toBe('open');
});

it('does not accept another actor as owner of a confirmed receipt', async () => {
  expect((await run(execute)).success).toBe(true);
  authority.lock();
  authority.beginAuthentication({ actorType: 'staff' });
  authority.grant({ actorType: 'staff', actorId: 'b', sessionId: 'other', permissions: ['pos'], deviceRef: 'd' });
  handle = authority.capture();
  expect((await run(execute)).success).toBe(false);
  expect((await db.table('menu').get('p')).stock).toBe(9);
  expect(await db.table('transaction_log').count()).toBe(1);
});

it('keeps an unreadable outcome uncertain and reconciles it without another commit', async () => {
  const inputs = deps(async (...args) => { await execute(...args); throw new Error('lost-response'); });
  const read = inputs.loadData;
  let reads = 0;
  inputs.loadData = (table, id) => {
    if (table === 'sales' && ++reads > 1) throw new Error('receipt unavailable');
    return read(table, id);
  };
  const commit = vi.spyOn(inputs, 'executeSaleTransactionSafe');
  expect(await processSaleCore(params(), inputs)).toMatchObject({ code: 'LOCAL_COMMIT_UNCERTAIN', retryable: false });
  expect(commit).toHaveBeenCalledTimes(1);
  expect(await processSaleCore(params(), deps(execute))).toMatchObject({ success: true, saleId: 'order-a' });
  expect(await db.table('transaction_log').count()).toBe(1);
  expect((await db.table('menu').get('p')).stock).toBe(9);
});


it.each([false, true])('keeps the final authority guard for nonlocal or unopted operations (%s)', async enabled => {
  await expect(runCheckoutActorOperation({ orderId: 'order-a', recognizeLocalCommit: enabled,
    operation: async () => {
      authority.lock('session_changed');
      return { success: true, saleId: 'order-a', financialResult: {
        status: 'success', sourceMode: enabled ? 'cloud_committed' : 'local_committed'
      } };
    }
  })).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_STALE' });
});


it('rejects another owner of an open checkout before any financial write', async () => {
  await db.table('sales').update('order-a', { checkoutActorKey: 'staff:other' });
  expect((await run(execute)).success).toBe(false);
  expect((await db.table('sales').get('order-a')).isLockedForCheckout).toBe(true);
  expect((await db.table('menu').get('p')).stock).toBe(10);
  expect(await db.table('transaction_log').count()).toBe(0);
});
