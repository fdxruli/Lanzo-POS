import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSale: vi.fn(),
  pullSalesSnapshot: vi.fn(),
  saveCloudCommittedSaleSnapshot: vi.fn(),
  applyCloudSalesPayload: vi.fn(),
  createCloudCashierSale: vi.fn(),
  createCloudCashierInventorySale: vi.fn(),
  createCloudCreditSale: vi.fn(),
  createCloudSplitTableSale: vi.fn(),
  executeFinancialOperation: vi.fn(),
  markProjectionApplied: vi.fn(),
  markProjectionFailed: vi.fn(),
  pullCatalogChanges: vi.fn(),
  recoveryTrace: [],
  cloudCashierEnabled: true,
  actorHandle: { assertCurrent: vi.fn() },
  lookupRestaurant: vi.fn()
}));
vi.mock('../../restaurant/restaurantOrdersRepository', () => ({ restaurantOrdersRepository: {
  getRestaurantOrderByLocalOrder: (...args) => mocks.lookupRestaurant(...args)
} }));
import { buildRestaurantOrderPayloadFromOpenSale } from '../../restaurant/restaurantOrderMapper';

vi.mock('../../supabase', () => ({
  getStableDeviceId: vi.fn(async () => 'device-a')
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({ licenseDetails: { license_key: 'LIC-1' } })
  }
}));

vi.mock('../../sync/syncConstants', () => ({
  getLicenseKeyFromDetails: vi.fn((details) => details?.license_key || null),
  isCloudSalesCashierEnabled: vi.fn(() => mocks.cloudCashierEnabled),
  isCloudSalesCreditEnabled: vi.fn(() => true),
  isCloudSalesInventoryEnabled: vi.fn(() => true),
  SYNC_ENTITY_TYPES: {
    CUSTOMER: 'customer',
    CUSTOMER_LEDGER: 'customer_ledger',
    CUSTOMER_CREDIT: 'customer_credit',
    CUSTOMER_PAYMENT: 'customer_payment',
    CATEGORY: 'category',
    PRODUCT: 'product',
    PRODUCT_BATCH: 'product_batch',
    INVENTORY_ENTRY: 'inventory_entry',
    PREPARATION_STATION: 'preparation_station',
    RESTAURANT_ORDER: 'restaurant_order',
    RESTAURANT_ORDER_ITEM: 'restaurant_order_item',
    INVENTORY_MOVEMENT: 'inventory_movement',
    CASH: 'cash',
    CASH_SESSION: 'cash_session',
    CASH_MOVEMENT: 'cash_movement',
    SALE: 'sale',
    SALE_ITEM: 'sale_item',
    SALE_PAYMENT: 'sale_payment',
    SALE_CANCELLATION: 'sale_cancellation',
    REPORT: 'report',
    GENERIC: 'generic'
  },
  SYNC_OPERATIONS: {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    RESTORE: 'restore',
    UPSERT: 'upsert',
    UPSERT_SHADOW: 'upsert_shadow',
    CLOUD_COMMIT: 'cloud_commit',
    CANCEL: 'cancel',
    PULL_SNAPSHOT: 'pull_snapshot',
    PULL_CHANGES: 'pull_changes',
    TOGGLE_STATUS: 'toggle_status',
    STATUS_UPDATE: 'status_update',
    OPEN: 'open',
    CLOSE: 'close',
    MOVEMENT: 'movement',
    ADJUST: 'adjust',
    INVENTORY_ENTRY: 'inventory_entry',
    UNKNOWN: 'unknown'
  },
  SYNC_STATUS: {
    DISABLED: 'disabled',
    ONLINE: 'online',
    OFFLINE: 'offline',
    DEGRADED: 'degraded',
    ERROR: 'error'
  },
  SYNC_LIMITS: {
    DEFAULT_PULL_LIMIT: 500,
    MAX_PULL_LIMIT: 500,
    DEFAULT_OUTBOX_LIMIT: 50,
    STUCK_PROCESSING_MS: 120000
  },
  POS_SYNC_FOCUS_PULL_COOLDOWN_MS: 60000,
  POS_SYNC_REALTIME_PULL_DEBOUNCE_MS: 1000,
  shouldDeferPosBootstrapStartHook: vi.fn(() => false),
  isCloudPosSyncEnabled: vi.fn(() => true),
  isCloudLayawaysEnabled: vi.fn(() => false)
}));

vi.mock('../../products/productSyncHandler', () => ({ pullCatalogChanges: mocks.pullCatalogChanges }));
vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: {
    getState: () => ({ status: 'granted' }),
    capture: () => mocks.actorHandle,
    subscribe: () => () => {}
  }
}));
vi.mock('../../cash/cashRepository', () => ({
  cashRepository: {
    getCurrentCashSession: vi.fn(async () => ({
      success: true,
      cashSession: { id: 'cash-session-1', estado: 'abierta' }
    }))
  }
}));
vi.mock('../../financial/financialIntentLedger', () => ({
  markFinancialIntentProjectionApplied: (...args) => mocks.markProjectionApplied(...args),
  markFinancialIntentProjectionFailed: (...args) => mocks.markProjectionFailed(...args)
}));
vi.mock('../salesCloudRepository', () => ({
  salesCloudRepository: {
    getSale: (...args) => mocks.getSale(...args),
    negotiateSnapshotProtocol: async () => ({ supported: true }),
    pullSalesSnapshot: (...args) => mocks.pullSalesSnapshot(...args),
    createCloudCashierSale: (...args) => mocks.createCloudCashierSale(...args),
    createCloudCashierInventorySale: (...args) => mocks.createCloudCashierInventorySale(...args),
    createCloudCreditSale: (...args) => mocks.createCloudCreditSale(...args),
    createCloudSplitTableSale: (...args) => mocks.createCloudSplitTableSale(...args)
  }
}));
vi.mock('../salesCloudLocalRepository', () => ({
  salesCloudLocalRepository: {
    saveCloudCommittedSaleSnapshot: (...args) => mocks.saveCloudCommittedSaleSnapshot(...args),
    applyCloudSalesPayload: (...args) => mocks.applyCloudSalesPayload(...args)
  }
}));

import {
  salesCloudCashierService,
  salesCloudCashierServiceInternals
} from '../salesCloudCashierService';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actorHandle.assertCurrent.mockReset();
  mocks.getSale.mockReset();
  mocks.pullSalesSnapshot.mockReset();
  mocks.saveCloudCommittedSaleSnapshot.mockReset();
  vi.stubEnv('VITE_ENABLE_CLOUD_CASHIER_SALES', 'true');
  mocks.recoveryTrace.splice(0);
  mocks.cloudCashierEnabled = true;
  mocks.saveCloudCommittedSaleSnapshot.mockResolvedValue({ id: 'sale-1', status: 'closed' });
  mocks.applyCloudSalesPayload.mockResolvedValue({ success: true });
  mocks.markProjectionApplied.mockResolvedValue(undefined);
  mocks.markProjectionFailed.mockResolvedValue(undefined);
  mocks.pullCatalogChanges.mockResolvedValue(undefined);
  mocks.createCloudSplitTableSale.mockResolvedValue({
    success: true,
    projection: { outcome: 'projection_applied', result: { localSales: [{ id: 'child-a' }, { id: 'child-b' }] } }
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true }
  });
});

const makeSale = () => ({
  id: 'sale-1',
  timestamp: '2026-08-29T12:34:56.000Z',
  status: 'closed',
  items: [{ id: 'product-1', name: 'Producto', quantity: 1, price: 10, cost: 4 }],
  total: '10.00',
  subtotal: '10.00',
  paymentMethod: 'cash',
  abono: '10.00',
  saldoPendiente: '0.00',
  metadata: { origin: 'pos' }
});

const makeResponse = () => ({
  success: true,
  financialIntentId: 'intent-1',
  sale: {
    id: 'cloud-sale-1',
    local_sale_id: 'sale-1',
    effects_status: 'payment_recorded',
    inventory_effect_status: 'applied'
  },
  items: [],
  payments: []
});

const projectResponse = async (options, response, operationType = 'sale.cashier_inventory') => {
  const result = await options.project({
    intent: {
      operationType,
      requestPayload: {
        sale: options.sale,
        items: options.items,
        payments: options.payments
      },
      responsePayload: response
    },
    actorHandle: options.actorHandle
  });
  return { ...response, projection: { outcome: 'projection_applied', result } };
};

const recoveryArgs = { localSaleId: 'ecom-order-1', idempotencyKey: 'ecommerce:order-1', startedAt: '2026-07-11T20:00:00.000Z' };
const confirmedSale = {
  id: 'cloud-sale-1', local_sale_id: recoveryArgs.localSaleId,
  idempotency_key: recoveryArgs.idempotencyKey, status: 'closed', source_mode: 'cloud_committed',
  effects_status: 'payment_recorded', inventory_effect_status: 'applied',
  server_version: 1, sold_at: recoveryArgs.startedAt, total: 10, amount_paid: 10, balance_due: 0,
  payment_method: 'cash', payment_status: 'paid'
};
const confirmedItems = [{ sale_id: confirmedSale.id, id: 'item-1', product_name: 'Producto', quantity: 1, unit_price: 10, line_total: 10, batch_id: 'batch-1' }];
const confirmedPayments = [{ sale_id: confirmedSale.id, id: 'payment-1', method: 'cash', amount: 10 }];
const page = (extra = {}) => ({
  success: true, snapshot_contract: 'keyset_reference_v1', snapshot_contract_version: 1,
  snapshot_reference_change_seq: 9, safe_change_seq: 9, sync_deferred: false, limit: 500,
  scope: { date_from: '2026-07-10T20:00:00.000Z', date_to: null, visibility: 'authorized' },
  sales: [], items: [], payments: [], has_more: false, snapshot_complete: true, next_page_cursor: null, ...extra
});
const firstPage = (n = 0) => page({
  sales: Array.from({ length: 500 }, (_, i) => ({ id: 'other-'+n+'-'+i })),
  has_more: true, snapshot_complete: false, next_page_cursor: { position_rank: 1, position_id: 'other-'+n+'-499' }
});
const foundPage = page({ sales: [confirmedSale], items: confirmedItems, payments: confirmedPayments });
const assertNoEffects = () => {
  expect(mocks.createCloudCashierSale).not.toHaveBeenCalled();
  expect(mocks.createCloudCashierInventorySale).not.toHaveBeenCalled();
  expect(mocks.createCloudCreditSale).not.toHaveBeenCalled();
  expect(mocks.pullCatalogChanges).not.toHaveBeenCalled();
  expect(mocks.applyCloudSalesPayload).not.toHaveBeenCalled();
};

describe('salesCloudCashierService ecommerce idempotency', () => {
  const restaurantAttempt = () => {
    const parent = { ...makeSale(), status: 'open', orderType: 'table', restaurantCloudExpectedVersion: '2026-09-27T10:00:00Z' };
    const payload = buildRestaurantOrderPayloadFromOpenSale({ sale: parent });
    const order = { ...payload.order, id: 'cloud-parent', status: 'delivered', fulfillmentStatus: 'delivered',
      paymentStatus: 'unpaid', updatedAt: '2026-09-28T16:05:05.123456Z',
      items: payload.items.map((item) => ({ ...item, status: 'delivered' })) };
    mocks.lookupRestaurant.mockResolvedValue({ success: true, found: true, order });
    return { order, options: { sale: makeSale(), processedItems: makeSale().items,
      paymentData: { paymentMethod: 'cash', amountPaid: 10, cashSessionId: 'newly-opened-session' },
      total: '10.00', restaurantOrder: parent } };
  };
  it.each(['product', 'quantity', 'discount', 'paid', 'cancelled', 'offline'])('blocks %s with a stale local token before any financial attempt', async (kind) => {
    const { order, options } = restaurantAttempt();
    if (kind === 'product') order.items[0].productId = 'another-product';
    if (kind === 'quantity') order.items[0].quantity = 2;
    if (kind === 'discount') order.metadata.restaurantSplitCommercialSnapshot.saleDiscounts.saleDiscount = { state: 'null' };
    if (kind === 'paid') order.paymentStatus = 'paid';
    if (kind === 'cancelled') order.status = 'cancelled';
    if (kind === 'offline') mocks.lookupRestaurant.mockResolvedValue({ success: false, code: 'OFFLINE' });
    await expect(salesCloudCashierService.processCloudCashierSale(options)).rejects.toThrow();
    expect(mocks.createCloudCashierInventorySale).not.toHaveBeenCalled();
    expect(mocks.saveCloudCommittedSaleSnapshot).not.toHaveBeenCalled();
  });
  it('does not replay a financial RPC when kitchen changes after the preflight', async () => {
    const { options } = restaurantAttempt();
    mocks.createCloudCashierInventorySale.mockResolvedValue({ success: false, code: 'RESTAURANT_ORDER_VERSION_CONFLICT' });
    await expect(salesCloudCashierService.processCloudCashierSale(options)).rejects.toThrow('La mesa recibió cambios');
    expect(mocks.lookupRestaurant).toHaveBeenCalledWith({ licenseKey: 'LIC-1', localOrderId: 'sale-1', force: true });
    expect(mocks.createCloudCashierInventorySale).toHaveBeenCalledOnce();
    expect(mocks.saveCloudCommittedSaleSnapshot).not.toHaveBeenCalled();
  });
  it('aborts when the actor changes during Cloud revalidation after cash opening', async () => {
    const { options } = restaurantAttempt();
    mocks.lookupRestaurant.mockImplementation(async () => {
      mocks.actorHandle.assertCurrent.mockImplementation(() => { throw new Error('ACTOR_CONTEXT_STALE'); });
      return { success: false };
    });
    await expect(salesCloudCashierService.processCloudCashierSale(options)).rejects.toThrow();
    expect(mocks.createCloudCashierInventorySale).not.toHaveBeenCalled();
  });
  it('requires a preflight version and forwards the exact timestamp to the split RPC', async () => {
    const childDefinitions = ['T1', 'T2'].map((label, index) => ({
      label,
      sale: { id: `child-${index}`, timestamp: '2026-09-28T16:00:00Z', status: 'closed', total: '30', items: [] },
      processedItems: [],
      paymentData: { paymentMethod: 'cash', amountPaid: '30' }
    }));
    const exactVersion = '2026-09-28T16:05:05.123456789Z';

    await expect(salesCloudCashierService.processCloudSplitTableSale({
      parentOrderId: 'parent-1', splitGroupId: 'split-1', childDefinitions, total: '60'
    })).rejects.toThrow('No se pudo verificar la versión cloud actual de la mesa. Actualiza la mesa antes de cobrar.');
    expect(mocks.createCloudSplitTableSale).not.toHaveBeenCalled();

    const result = await salesCloudCashierService.processCloudSplitTableSale({
      parentOrderId: 'parent-1',
      parentExpectedVersion: exactVersion,
      splitGroupId: 'split-1',
      childDefinitions,
      total: '60'
    });

    expect(result).toMatchObject({ success: true, childSaleIds: ['child-a', 'child-b'] });
    const request = mocks.createCloudSplitTableSale.mock.calls[0][0];
    expect(request.split.parent_order_version).toBe(exactVersion);
    expect(request.idempotencyKey).toBe('sales.cloud_split:split-1');
    expect(mocks.createCloudSplitTableSale).toHaveBeenCalledOnce();
  });

  it('surfaces a server version race safely without dispatching a second split', async () => {
    const childDefinitions = ['T1', 'T2'].map((label, index) => ({
      label,
      sale: { id: `child-${index}`, timestamp: '2026-09-28T16:00:00Z', status: 'closed', total: '30', items: [] },
      processedItems: [],
      paymentData: { paymentMethod: 'cash', amountPaid: '30' }
    }));
    mocks.createCloudSplitTableSale.mockResolvedValueOnce({
      success: false,
      code: 'RESTAURANT_ORDER_VERSION_CONFLICT'
    });

    await expect(salesCloudCashierService.processCloudSplitTableSale({
      parentOrderId: 'parent-1',
      parentExpectedVersion: '2026-09-28T16:05:05.123456Z',
      splitGroupId: 'split-1',
      childDefinitions,
      total: '60'
    })).rejects.toThrow('La mesa recibió cambios desde que la abriste. Actualízala y vuelve a intentar el cobro.');

    expect(mocks.createCloudSplitTableSale).toHaveBeenCalledOnce();
  });

  it('routes Local/Free feature-disabled licenses to the local checkout path', async () => {
    mocks.cloudCashierEnabled = false;

    await expect(salesCloudCashierService.shouldUseCloudCashierSale({
      paymentData: { paymentMethod: 'cash' },
      cart: [{ id: 'product-1', quantity: 1 }]
    })).resolves.toEqual({
      useCloud: false,
      reason: 'feature_disabled'
    });
  });

  it.each([
    ['tarjeta', 'card'],
    ['transferencia', 'transfer']
  ])('routes fully paid %s through the existing Cloud cashier inventory operation', async (paymentMethod, canonicalMethod) => {
    const sale = {
      id: `direct-${paymentMethod}`,
      timestamp: '2026-11-18T09:30:00.000Z',
      status: 'closed',
      items: [{ id: 'product-1', name: 'Producto', quantity: 1, price: 150 }],
      subtotal: '150',
      total: '150',
      paymentMethod,
      abono: '150',
      saldoPendiente: '0',
      dueDate: null,
      metadata: { origin: 'pos' }
    };
    const paymentData = {
      paymentMethod,
      amountPaid: '150',
      receivedAmount: null,
      changeAmount: '0',
      saldoPendiente: '0',
      dueDate: null,
      cashSessionId: 'cash-session-1',
      sendReceipt: false
    };
    mocks.createCloudCashierInventorySale.mockResolvedValue({
      success: true,
      financialIntentId: 'intent-direct-noncash',
      sale: {
        id: `cloud-${sale.id}`,
        effects_status: 'payment_recorded',
        inventory_effect_status: 'applied',
        credit_effect_status: 'not_applied'
      }
    });

    const decision = await salesCloudCashierService.shouldUseCloudCashierSale({
      paymentData,
      cart: sale.items
    });
    expect(decision).toMatchObject({ useCloud: true, mode: 'cloud_cashier_inventory' });

    const result = await salesCloudCashierService.processCloudCashierSale({
      sale,
      processedItems: sale.items,
      paymentData,
      total: '150',
      productCatalog: []
    });

    expect(result).toMatchObject({ success: true, creditSale: false, inventoryEnabled: true });
    expect(mocks.createCloudCashierInventorySale).toHaveBeenCalledOnce();
    expect(mocks.createCloudCashierSale).not.toHaveBeenCalled();
    expect(mocks.createCloudCreditSale).not.toHaveBeenCalled();
    expect(mocks.createCloudCashierInventorySale.mock.calls[0][0]).toMatchObject({
      cashSessionId: 'cash-session-1',
      sale: { payment_method: canonicalMethod, payment_status: 'paid', amount_paid: 150, change_amount: 0, balance_due: 0 },
      payments: [{ method: canonicalMethod, amount: 150, received_amount: 150, change_amount: 0 }]
    });
  });

  it('uses the ecommerce business key without a device suffix', () => {
    const result = salesCloudCashierServiceInternals.buildCloudSaleIdempotencyKey({
      sale: {
        id: 'ecom-order-1',
        metadata: {
          origin: 'ecommerce',
          ecommerceOrderId: 'order-1',
          ecommerceConversionKey: 'ecommerce:order-1'
        }
      },
      payload: { idempotencyKey: 'sales.cloud_commit:ecom-order-1' },
      deviceId: 'device-a'
    });

    expect(result).toBe('ecommerce:order-1');
  });

  it('preserves the historical device suffix for normal POS sales', () => {
    const result = salesCloudCashierServiceInternals.buildCloudSaleIdempotencyKey({
      sale: { id: 'normal-sale-1', metadata: { origin: 'pos' } },
      payload: { idempotencyKey: 'sales.cloud_commit:normal-sale-1' },
      deviceId: 'device-a'
    });

    expect(result).toBe('sales.cloud_commit:normal-sale-1:device-a');
  });

  it.each(['payment_recorded', 'cash_applied', 'cash_inventory_applied'])('recovers a direct confirmed %s sale with all children, without another financial dispatch', async effects_status => {
    mocks.getSale.mockResolvedValueOnce({ success: true, sale: { ...confirmedSale, effects_status }, items: confirmedItems, payments: confirmedPayments });
    await expect(salesCloudCashierService.verifyCommittedSale(recoveryArgs)).resolves.toMatchObject({ success: true, exists: true, cloudSaleId: confirmedSale.id });
    expect(mocks.pullSalesSnapshot).not.toHaveBeenCalled();
    expect(mocks.saveCloudCommittedSaleSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      recoveryRead: true, actorHandle: mocks.actorHandle,
      response: expect.objectContaining({ items: confirmedItems, payments: confirmedPayments })
    }));
    assertNoEffects();
  });

  it('recovers a committed cloud sale after a lost response and 500 other sales using a stable keyset', async () => {
    mocks.getSale.mockResolvedValueOnce({ success: false, code: 'SALE_NOT_FOUND' });
    mocks.pullSalesSnapshot.mockResolvedValueOnce(firstPage()).mockResolvedValueOnce(foundPage);
    const result = await salesCloudCashierService.verifyCommittedSale(recoveryArgs);
    expect(result).toMatchObject({ success: true, exists: true, cloudSaleId: confirmedSale.id });
    expect(mocks.pullSalesSnapshot.mock.calls.map(([p]) => [p.snapshotReferenceChangeSeq, p.pageCursor])).toEqual([[null,null],[9,firstPage().next_page_cursor]]);
    expect(mocks.saveCloudCommittedSaleSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      localSale: expect.objectContaining({ id: recoveryArgs.localSaleId, sourceMode: 'cloud_committed', metadata: expect.objectContaining({ ecommerceConversionKey: recoveryArgs.idempotencyKey }) }),
      response: expect.objectContaining({ sale: expect.objectContaining({ id: confirmedSale.id, local_sale_id: recoveryArgs.localSaleId }), items: confirmedItems, payments: confirmedPayments })
    }));
    assertNoEffects();
  });

  it('recovers by the original idempotency key when the Cloud ID differs and no local ID is present', async () => {
    mocks.getSale.mockResolvedValueOnce({ success: false, code: 'SALE_NOT_FOUND' });
    const byKey = { ...confirmedSale };
    delete byKey.local_sale_id;
    mocks.pullSalesSnapshot.mockResolvedValueOnce(page({ ...foundPage, sales: [byKey] }));
    await expect(salesCloudCashierService.verifyCommittedSale(recoveryArgs)).resolves.toMatchObject({ success: true, exists: true });
    assertNoEffects();
  });

  it('recovers a confirmed wholly credit sale with no payment rows but authoritative charge lineage', async () => {
    const sale = { ...confirmedSale, effects_status: 'credit_applied', payment_method: 'credit',
      payment_status: 'credit_pending', amount_paid: 0, balance_due: 10,
      customer_id: 'customer-1', credit_ledger_charge_id: 'charge-1', credit_effect_status: 'applied' };
    mocks.getSale.mockResolvedValueOnce({ success: true, sale, items: confirmedItems, payments: [] });
    await expect(salesCloudCashierService.verifyCommittedSale(recoveryArgs)).resolves.toMatchObject({ success: true, exists: true });
    assertNoEffects();
  });

  it('keeps the reservation pending even after exhausting a valid scoped snapshot', async () => {
    mocks.getSale.mockResolvedValueOnce({ success: false, code: 'SALE_NOT_FOUND' });
    mocks.pullSalesSnapshot.mockResolvedValueOnce(page());
    await expect(salesCloudCashierService.verifyCommittedSale(recoveryArgs)).resolves.toMatchObject({ success: false, code: 'ECOMMERCE_SALE_VERIFICATION_PENDING' });
    expect(mocks.saveCloudCommittedSaleSnapshot).not.toHaveBeenCalled();
    assertNoEffects();
  });

  it.each([
    { sync_deferred: true }, { snapshot_complete: false }, { payments: undefined },
    { payments: [] }, { items: [] }, { safe_change_seq: 10 },
    { sales: [{ ...confirmedSale, idempotency_key: 'wrong-key' }] },
    { sales: [{ ...confirmedSale, source_mode: 'shadow' }] }
  ])('rejects incomplete or inconsistent sale projection %# without releasing the reservation', async extra => {
    mocks.getSale.mockResolvedValueOnce({ success: false, code: 'SALE_NOT_FOUND' });
    mocks.pullSalesSnapshot.mockResolvedValueOnce({ ...foundPage, ...extra });
    await expect(salesCloudCashierService.verifyCommittedSale(recoveryArgs)).resolves.toMatchObject({ success: false, code: 'ECOMMERCE_SALE_VERIFICATION_PENDING' });
    expect(mocks.saveCloudCommittedSaleSnapshot).not.toHaveBeenCalled();
    assertNoEffects();
  });

  it('stops safely at 20 pages without reporting absence', async () => {
    mocks.getSale.mockResolvedValueOnce({ success: false, code: 'SALE_NOT_FOUND' });
    for (let i = 0; i < 20; i++) mocks.pullSalesSnapshot.mockResolvedValueOnce(firstPage(i));
    await expect(salesCloudCashierService.verifyCommittedSale(recoveryArgs)).resolves.toMatchObject({ success: false, code: 'ECOMMERCE_SALE_VERIFICATION_PENDING' });
    expect(mocks.pullSalesSnapshot).toHaveBeenCalledTimes(20);
    expect(mocks.saveCloudCommittedSaleSnapshot).not.toHaveBeenCalled();
    assertNoEffects();
  });

  it('rejects a changed actor during a fallback read', async () => {
    mocks.getSale.mockResolvedValueOnce({ success: false, code: 'SALE_NOT_FOUND' });
    mocks.pullSalesSnapshot.mockImplementationOnce(async () => {
      mocks.actorHandle.assertCurrent.mockImplementation(() => { throw new Error('ACTOR_CONTEXT_STALE'); });
      return foundPage;
    });
    await expect(salesCloudCashierService.verifyCommittedSale(recoveryArgs)).resolves.toMatchObject({ success: false, code: 'ECOMMERCE_SALE_VERIFICATION_PENDING' });
    expect(mocks.saveCloudCommittedSaleSnapshot).not.toHaveBeenCalled();
    assertNoEffects();
  });

  it('keeps verification pending when cloud lookup fails', async () => {
    mocks.getSale.mockRejectedValueOnce(new Error('DIRECT_LOOKUP_FAILED'));
    mocks.pullSalesSnapshot.mockRejectedValueOnce(new Error('SNAPSHOT_FAILED'));

    const result = await salesCloudCashierService.verifyCommittedSale({
      localSaleId: 'ecom-order-1',
      idempotencyKey: 'ecommerce:order-1'
    });

    expect(result).toMatchObject({
      success: false,
      code: 'ECOMMERCE_SALE_VERIFICATION_PENDING'
    });
  });

  it('has one synchronous projection owner after BLOCKED + NOT_FOUND + SUCCESS recovery', async () => {
    const response = makeResponse();
    mocks.createCloudCashierInventorySale.mockImplementation(async (options) => {
      mocks.recoveryTrace.push('BLOCKED', 'NOT_FOUND');
      mocks.executeFinancialOperation(options);
      mocks.recoveryTrace.push('SUCCESS');
      return projectResponse(options, response);
    });

    const result = await salesCloudCashierService.processCloudCashierSale({
      sale: makeSale(),
      processedItems: makeSale().items,
      paymentData: { paymentMethod: 'cash', amountPaid: 10, cashSessionId: 'session-1' },
      total: '10.00'
    });

    expect(result).toMatchObject({ success: true, response });
    expect(mocks.recoveryTrace).toEqual(['BLOCKED', 'NOT_FOUND', 'SUCCESS']);
    expect(mocks.executeFinancialOperation).toHaveBeenCalledTimes(1);
    expect(mocks.saveCloudCommittedSaleSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.applyCloudSalesPayload).toHaveBeenCalledTimes(1);
    expect(mocks.markProjectionApplied).not.toHaveBeenCalled();
    expect(mocks.markProjectionFailed).not.toHaveBeenCalled();
  });

  it('projects a completed receipt exactly once without a second financial execute', async () => {
    const response = makeResponse();
    mocks.recoveryTrace.push('COMPLETED_RECEIPT');
    mocks.createCloudCashierInventorySale.mockImplementation((options) => projectResponse(options, response));

    const result = await salesCloudCashierService.processCloudCashierSale({
      sale: makeSale(),
      processedItems: makeSale().items,
      paymentData: { paymentMethod: 'cash', amountPaid: 10, cashSessionId: 'session-1' },
      total: '10.00'
    });

    expect(result).toMatchObject({ success: true, response });
    expect(mocks.recoveryTrace).toEqual(['COMPLETED_RECEIPT']);
    expect(mocks.executeFinancialOperation).toHaveBeenCalledTimes(0);
    expect(mocks.saveCloudCommittedSaleSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.applyCloudSalesPayload).toHaveBeenCalledTimes(1);
    expect(mocks.markProjectionApplied).not.toHaveBeenCalled();
  });

  it('binds the origin or remote restaurant version to a normal cloud checkout', async () => {
    const version = '2026-09-28T16:05:05.123456Z';
    const parent = { ...makeSale(), status: 'open', orderType: 'table', restaurantCloudHydrated: true,
      restaurantCloudExpectedVersion: '2026-09-27T10:00:00Z', cloudRestaurantOrderUpdatedAt: '2026-09-27T10:00:00Z' };
    const mapped = buildRestaurantOrderPayloadFromOpenSale({ sale: parent });
    mocks.lookupRestaurant.mockResolvedValue({ success: true, found: true, order: {
      ...mapped.order, id: 'cloud-parent', updatedAt: version, status: 'delivered', fulfillmentStatus: 'delivered',
      paymentStatus: 'unpaid', items: mapped.items.map((item) => ({ ...item, status: 'delivered' }))
    } });
    const response = {
      ...makeResponse(),
      restaurant_settlement: {
        success: true,
        parent_order_id: 'sale-1',
        payment_status: 'paid',
        paid_sale_id: 'cloud-sale-1',
        paid_sale_folio: 'F-1',
        total: 10
      }
    };
    mocks.createCloudCashierInventorySale.mockImplementation((options) => projectResponse(options, response));

    const result = await salesCloudCashierService.processCloudCashierSale({
      sale: makeSale(),
      processedItems: makeSale().items,
      paymentData: { paymentMethod: 'cash', amountPaid: 10, cashSessionId: 'session-1' },
      total: '10.00',
      restaurantOrder: parent
    });

    expect(mocks.createCloudCashierInventorySale).toHaveBeenCalledWith(expect.objectContaining({
      restaurantSettlement: {
        parent_order_id: 'sale-1',
        parent_order_version: version,
        contract_version: 1
      }
    }));
    expect(result).toMatchObject({
      atomicRestaurantSettlement: true,
      restaurantSettlement: response.restaurant_settlement
    });
  });
});


it('preserves the receipt-required metadata when the financial transport is ambiguous', async () => {
  mocks.createCloudCashierInventorySale.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), {
    isFinancialOperationAmbiguous: true, financialIntentId: 'intent-1', financialIdempotencyKey: 'existing-key'
  }));
  await expect(salesCloudCashierService.processCloudCashierSale({ sale: makeSale(), processedItems: makeSale().items,
    paymentData: { paymentMethod: 'cash', amountPaid: 10, cashSessionId: 'session-1' }, total: '10' }))
    .rejects.toMatchObject({ isFinancialOperationAmbiguous: true, financialIntentId: 'intent-1', financialIdempotencyKey: 'existing-key' });
});

it('recognizes confirmed money while the existing local projection needs repair', async () => {
  mocks.createCloudCashierInventorySale.mockResolvedValueOnce({ ...makeResponse(), projection: { outcome: 'projection_failed' } });
  await expect(salesCloudCashierService.processCloudCashierSale({ sale: makeSale(), processedItems: makeSale().items,
    paymentData: { paymentMethod: 'cash', amountPaid: 10, cashSessionId: 'session-1' }, total: '10' }))
    .resolves.toMatchObject({ success: true, projectionDeferred: true, financialIntentId: 'intent-1' });
  expect(mocks.pullCatalogChanges).not.toHaveBeenCalled();
});

it('blocks a cloud credit sale before financial dispatch when Staff credit sales are revoked', async () => {
  mocks.actorHandle.assertCurrent.mockImplementation((permission) => {
    if (permission === 'pos_credit_sales') {
      throw Object.assign(new Error('ACTOR_PERMISSION_DENIED'), { code: 'ACTOR_PERMISSION_DENIED' });
    }
    return true;
  });

  await expect(salesCloudCashierService.processCloudCashierSale({
    sale: { ...makeSale(), paymentMethod: 'credit', saldoPendiente: '10.00' },
    processedItems: makeSale().items,
    paymentData: { paymentMethod: 'credit', amountPaid: 0, saldoPendiente: '10.00', customerId: 'customer-1' },
    total: '10.00'
  })).rejects.toMatchObject({
    code: 'POS_PERMISSION_DENIED:pos_credit_sales',
    message: expect.stringContaining('no tiene autorización')
  });

  expect(mocks.actorHandle.assertCurrent).toHaveBeenCalledWith('pos_credit_sales');
  expect(mocks.createCloudCreditSale).not.toHaveBeenCalled();
});

it('keeps an authorized debt creating sale on the Cloud credit path', async () => {
  const response = makeResponse();
  mocks.createCloudCreditSale.mockImplementation((options) => projectResponse(options, response, 'sale.credit'));

  const result = await salesCloudCashierService.processCloudCashierSale({
    sale: { ...makeSale(), paymentMethod: 'credit', saldoPendiente: '10.00' },
    processedItems: makeSale().items,
    paymentData: { paymentMethod: 'credit', amountPaid: 0, saldoPendiente: '10.00', customerId: 'customer-1' },
    total: '10.00'
  });

  expect(result).toMatchObject({ success: true, creditSale: true });
  expect(mocks.actorHandle.assertCurrent).toHaveBeenCalledWith('pos_credit_sales');
  expect(mocks.createCloudCreditSale).toHaveBeenCalledOnce();
});

it('rechecks a cloud credit grant immediately before dispatch', async () => {
  let creditChecks = 0;
  mocks.actorHandle.assertCurrent.mockImplementation((permission) => {
    if (permission === 'pos_credit_sales' && ++creditChecks > 1) {
      throw Object.assign(new Error('ACTOR_PERMISSION_DENIED'), { code: 'ACTOR_PERMISSION_DENIED' });
    }
    return true;
  });

  await expect(salesCloudCashierService.processCloudCashierSale({
    sale: { ...makeSale(), paymentMethod: 'credit', saldoPendiente: '10.00' },
    processedItems: makeSale().items,
    paymentData: { paymentMethod: 'credit', amountPaid: 0, saldoPendiente: '10.00', customerId: 'customer-1' },
    total: '10.00'
  })).rejects.toMatchObject({ code: 'POS_PERMISSION_DENIED:pos_credit_sales' });

  expect(creditChecks).toBe(2);
  expect(mocks.createCloudCreditSale).not.toHaveBeenCalled();
});

it('blocks a split-table credit child before dispatch when Staff credit sales are revoked', async () => {
  mocks.actorHandle.assertCurrent.mockImplementation((permission) => {
    if (permission === 'pos_credit_sales') {
      throw Object.assign(new Error('ACTOR_PERMISSION_DENIED'), { code: 'ACTOR_PERMISSION_DENIED' });
    }
    return true;
  });

  await expect(salesCloudCashierService.processCloudSplitTableSale({
    parentOrderId: 'table-1',
    parentExpectedVersion: '2026-10-01T00:00:00Z',
    splitGroupId: 'split-1',
    total: '20.00',
    childDefinitions: [
      { sale: { ...makeSale(), id: 'child-a', total: '10.00', saldoPendiente: '10.00' },
        paymentData: { paymentMethod: 'credit', amountPaid: 0, saldoPendiente: '10.00', customerId: 'customer-1' } },
      { sale: { ...makeSale(), id: 'child-b', total: '10.00' },
        paymentData: { paymentMethod: 'cash', amountPaid: 10, saldoPendiente: 0 } }
    ]
  })).rejects.toMatchObject({ code: 'POS_PERMISSION_DENIED:pos_credit_sales' });

  expect(mocks.createCloudSplitTableSale).not.toHaveBeenCalled();
});
