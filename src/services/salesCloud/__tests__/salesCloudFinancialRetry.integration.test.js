import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  database: null,
  failNextExecute: false,
  executeCalls: 0,
  receiptCalls: 0,
  snapshotCalls: 0,
  payloadCalls: 0,
  receiptResult: { status: 'NOT_FOUND' },
  projectionFailure: false,
  actorHandle: {
    actorKey: 'admin:actor-a',
    actorType: 'admin',
    actorId: 'actor-a',
    sessionId: 'session-a',
    generation: 1,
    deviceRef: 'device-a',
    tenant: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 },
    assertCurrent: vi.fn()
  }
}));

vi.mock('../../db/dexie', () => ({
  STORES: {
    SALES: 'sales',
    MENU: 'menu',
    PRODUCT_BATCHES: 'product_batches',
    FINANCIAL_INTENTS: 'financial_intents'
  },
  db: {
    table: (name) => runtime.database.table(name),
    transaction: (...args) => runtime.database.transaction(...args)
  }
}));

vi.mock('../../supabase', () => ({
  getStableDeviceId: vi.fn(async () => 'device-a'),
  supabaseClient: {
    rpc: vi.fn(async (name) => {
      if (name === 'pos_get_cash_station_state') {
        return {
          data: {
            cash_station: { id: 'station-a' },
            station_open_cash_session: { id: 'session-a' }
          },
          error: null
        };
      }
      if (name === 'pos_get_financial_operation_receipt') {
        runtime.receiptCalls += 1;
        return { data: runtime.receiptResult, error: null };
      }
      if (name === 'pos_execute_financial_operation_v1') {
        runtime.executeCalls += 1;
        if (runtime.failNextExecute) {
          runtime.failNextExecute = false;
          return {
            data: null,
            error: Object.assign(new Error('BATCH_ALLOCATION_INVALID'), {
              code: 'BATCH_ALLOCATION_INVALID',
              isDeterministicServerResponse: true
            })
          };
        }
        return {
          data: {
            success: true,
            sale: {
              id: 'cloud-sale-1',
              local_sale_id: 'order-X',
              effects_status: 'payment_recorded',
              inventory_effect_status: 'not_applied'
            },
            items: [],
            payments: []
          },
          error: null
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    })
  }
}));

vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: vi.fn(async () => ({
    licenseKey: 'fixture-license',
    deviceFingerprint: 'device-a',
    securityToken: 'fixture-security-token',
    staffSessionToken: 'fixture-staff-session'
  }))
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ licenseDetails: { license_key: 'fixture-license' }, enableMultipleOrders: true }) }
}));

vi.mock('../../sync/syncConstants', () => ({
  getLicenseKeyFromDetails: vi.fn((details) => details?.license_key || null),
  isCloudSalesCashierEnabled: vi.fn(() => true),
  isCloudSalesCreditEnabled: vi.fn(() => true),
  isCloudSalesInventoryEnabled: vi.fn(() => false)
}));

vi.mock('../../products/productSyncHandler', () => ({ pullCatalogChanges: vi.fn() }));
vi.mock('../../ecommerce/ecommerceOrderService', () => ({ releaseEcommerceOrderPosDraft: vi.fn() }));
vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: {
    capture: () => runtime.actorHandle,
    getState: () => runtime.actorHandle,
    subscribe: () => () => {}
  }
}));
vi.mock('../salesCloudLocalRepository', () => ({
  salesCloudLocalRepository: {
    saveCloudCommittedSaleSnapshot: vi.fn(async ({ localSale }) => {
      runtime.snapshotCalls += 1;
      if (runtime.projectionFailure) throw Object.assign(new Error('LOCAL_PROJECTION_FAILED'), { code: 'LOCAL_PROJECTION_FAILED' });
      return { ...localSale, status: 'closed' };
    }),
    applyCloudSalesPayload: vi.fn(async () => {
      runtime.payloadCalls += 1;
      if (runtime.projectionFailure) throw Object.assign(new Error('LOCAL_PROJECTION_FAILED'), { code: 'LOCAL_PROJECTION_FAILED' });
      return { success: true };
    })
  }
}));

import { useActiveOrders } from '../../../hooks/pos/useActiveOrders';
import { getFinancialIntent } from '../../financial/financialIntentLedger';
import { salesCloudCashierService } from '../salesCloudCashierService';

const orderId = 'order-X';
const stableCreatedAt = '2026-08-30T10:00:00.000Z';

const makeActiveOrder = (changes = {}) => ({
  id: orderId,
  items: [{ id: 'product-1', name: 'Producto', price: 10, cost: 4, quantity: 1, trackStock: false }],
  customer: null,
  tableData: null,
  createdAt: stableCreatedAt,
  updatedAt: stableCreatedAt,
  revision: 0,
  total: 10,
  isSaved: false,
  ...changes
});

const checkoutTransport = () => {
  const activeOrderId = useActiveOrders.getState().currentOrderId;
  const stableSaleTimestamp = useActiveOrders.getState().ensureOrderCreationTimestamp(activeOrderId);
  const activeOrder = useActiveOrders.getState().activeOrders.get(activeOrderId);
  return {
    sale: { ...activeOrder, timestamp: stableSaleTimestamp, status: 'closed' },
    processedItems: activeOrder.items,
    paymentData: { paymentMethod: 'cash', amountPaid: 10, cashSessionId: 'session-a' },
    total: '10.00',
    stableSaleTimestamp
  };
};

beforeEach(async () => {
  const name = `lanzo-sales-retry-${crypto.randomUUID()}`;
  const database = new Dexie(name);
  database.version(1).stores({
    sales: 'id, timestamp, status',
    financial_intents: 'id, &idempotencyKey'
  });
  await database.open();
  runtime.database = database;
  runtime.failNextExecute = true;
  runtime.executeCalls = 0;
  runtime.receiptCalls = 0;
  runtime.snapshotCalls = 0;
  runtime.payloadCalls = 0;
  runtime.receiptResult = { status: 'NOT_FOUND' };
  runtime.projectionFailure = false;
  runtime.actorHandle.assertCurrent.mockClear();
  useActiveOrders.setState({
    activeOrders: new Map([[orderId, makeActiveOrder()]]),
    currentOrderId: orderId,
    isCurrentOrderLocked: false,
    isLoading: false
  });
  vi.stubEnv('VITE_ENABLE_CLOUD_CASHIER_SALES', 'true');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true }
  });
});

afterEach(async () => {
  const database = runtime.database;
  runtime.database = null;
  if (database?.isOpen()) database.close();
  if (database) await Dexie.delete(database.name);
  vi.unstubAllEnvs();
});

describe('active-order cloud retry transport', () => {
  it('projects a normal first financial success once under its execution lease', async () => {
    runtime.failNextExecute = false;
    await useActiveOrders.getState().loadOrdersFromDB();

    await expect(salesCloudCashierService.processCloudCashierSale(checkoutTransport()))
      .resolves.toMatchObject({ success: true });

    const intent = (await runtime.database.table('financial_intents').toArray())[0];
    expect(runtime.executeCalls).toBe(1);
    expect(runtime.receiptCalls).toBe(0);
    expect(runtime.snapshotCalls).toBe(1);
    expect(runtime.payloadCalls).toBe(1);
    expect(intent).toMatchObject({
      status: 'COMPLETED',
      projectionStatus: 'APPLIED',
      recoveryLeaseId: null
    });
  });

  it('keeps SALE_ID, timestamp, K and H stable across a blocked retry after clock advance', async () => {
    await useActiveOrders.getState().loadOrdersFromDB();
    const firstCheckout = checkoutTransport();
    expect(firstCheckout.stableSaleTimestamp).toBe(stableCreatedAt);

    await expect(salesCloudCashierService.processCloudCashierSale(firstCheckout))
      .rejects.toMatchObject({ code: 'BATCH_ALLOCATION_INVALID' });
    expect(runtime.executeCalls).toBe(1);
    expect(runtime.snapshotCalls).toBe(0);
    expect(runtime.payloadCalls).toBe(0);

    const firstIntent = (await runtime.database.table('financial_intents').toArray())[0];
    expect(firstIntent).toMatchObject({
      idempotencyKey: expect.any(String),
      requestPayload: { sale: { id: orderId, timestamp: stableCreatedAt } },
      status: 'BLOCKED'
    });

    const firstSaleId = firstIntent.requestPayload.sale.id;
    const firstTimestamp = firstIntent.requestPayload.sale.timestamp;
    const firstK = firstIntent.idempotencyKey;
    const firstH = firstIntent.requestHash;

    const laterOrder = {
      ...useActiveOrders.getState().activeOrders.get(orderId),
      updatedAt: '2026-08-30T10:10:00.000Z',
      revision: 1
    };
    useActiveOrders.setState({ activeOrders: new Map([[orderId, laterOrder]]) });
    await useActiveOrders.getState().loadOrdersFromDB();
    const secondCheckout = checkoutTransport();

    expect(secondCheckout.stableSaleTimestamp).toBe(stableCreatedAt);
    await expect(salesCloudCashierService.processCloudCashierSale(secondCheckout))
      .resolves.toMatchObject({ success: true });

    const secondIntent = await getFinancialIntent(firstIntent.id);
    expect(secondIntent).toMatchObject({
      id: firstIntent.id,
      idempotencyKey: firstK,
      requestHash: firstH,
      status: 'COMPLETED',
      projectionStatus: 'APPLIED',
      requestPayload: { sale: { id: firstSaleId, timestamp: firstTimestamp } }
    });
    expect(secondIntent.idempotencyKey).toBe(firstK);
    expect(secondIntent.requestHash).toBe(firstH);
    expect(secondIntent.requestPayload.sale.id).toBe(firstSaleId);
    expect(secondIntent.requestPayload.sale.timestamp).toBe(firstTimestamp);
    expect(runtime.executeCalls).toBe(2);
    expect(runtime.receiptCalls).toBe(1);
    expect(runtime.snapshotCalls).toBe(1);
    expect(runtime.payloadCalls).toBe(1);
  });

  it('projects a BLOCKED intent from a COMPLETED receipt without redispatch', async () => {
    await useActiveOrders.getState().loadOrdersFromDB();
    const checkout = checkoutTransport();
    await expect(salesCloudCashierService.processCloudCashierSale(checkout))
      .rejects.toMatchObject({ code: 'BATCH_ALLOCATION_INVALID' });

    const blockedIntent = (await runtime.database.table('financial_intents').toArray())[0];
    const completedResponse = {
      success: true,
      sale: {
        id: 'cloud-sale-receipt',
        local_sale_id: orderId,
        effects_status: 'payment_recorded',
        inventory_effect_status: 'not_applied'
      },
      items: [],
      payments: []
    };
    await runtime.database.table('financial_intents').update(blockedIntent.id, {
      status: 'BLOCKED',
      dispatchAttemptCount: 1,
      projectionStatus: 'PENDING',
      responsePayload: null
    });
    runtime.receiptResult = { status: 'COMPLETED', result: completedResponse };
    runtime.executeCalls = 0;
    runtime.receiptCalls = 0;
    runtime.snapshotCalls = 0;
    runtime.payloadCalls = 0;

    await expect(salesCloudCashierService.processCloudCashierSale(checkoutTransport()))
      .resolves.toMatchObject({ success: true });

    expect(runtime.executeCalls).toBe(0);
    expect(runtime.receiptCalls).toBe(1);
    expect(runtime.snapshotCalls).toBe(1);
    expect(runtime.payloadCalls).toBe(1);
    expect(await getFinancialIntent(blockedIntent.id)).toMatchObject({
      status: 'COMPLETED',
      projectionStatus: 'APPLIED',
      recoveryLeaseId: null
    });
  });

  it('keeps financial completion when projection fails and lets background repair retry it', async () => {
    runtime.failNextExecute = false;
    runtime.projectionFailure = true;
    await useActiveOrders.getState().loadOrdersFromDB();

    await expect(salesCloudCashierService.processCloudCashierSale(checkoutTransport()))
      .rejects.toMatchObject({ code: 'LOCAL_PROJECTION_FAILED' });

    const intent = (await runtime.database.table('financial_intents').toArray())[0];
    expect(runtime.executeCalls).toBe(1);
    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: 'COMPLETED',
      projectionStatus: 'FAILED'
    });

    runtime.projectionFailure = false;
    runtime.snapshotCalls = 0;
    runtime.payloadCalls = 0;
    const { retryFinancialIntentProjection } = await import('../../financial/financialProjectionRepair');
    await expect(retryFinancialIntentProjection({ intentId: intent.id, actorHandle: runtime.actorHandle }))
      .resolves.toMatchObject({ outcome: 'projection_applied' });

    expect(runtime.executeCalls).toBe(1);
    expect(runtime.snapshotCalls).toBe(1);
    expect(runtime.payloadCalls).toBe(1);
    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: 'COMPLETED',
      projectionStatus: 'APPLIED'
    });
  });
});
