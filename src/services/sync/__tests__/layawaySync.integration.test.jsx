// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  rpc: vi.fn(),
  device: null,
  tenantId: 'layaway-sync-tenant',
  cloud: null,
  failLayawayRead: false,
  deferLayawayRead: false,
  revokeOnLayawayRead: false,
  replayEvents: false
}));

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc: fixture.rpc },
  getStableDeviceId: async () => fixture.device,
  getDeviceSecurityToken: async () => `security-${fixture.device}`,
  getActorSessionToken: async () => `session-${fixture.device}`
}));
vi.mock('../../auth/actorRuntimeController', async (importOriginal) => {
  const actual = await importOriginal();
  const { getActiveTenantRuntime } = await import('../../db/tenantRuntimeRouter');
  return { ...actual, actorRuntimeController: actual.createActorRuntimeController({
    getTenantAuthority: getActiveTenantRuntime
  }) };
});
vi.mock('../../sync/syncConstants', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isCloudLayawaysEnabled: vi.fn(() => true) };
});
vi.mock('../../posRealtime', () => ({
  buildPosRealtimeTopic: () => null,
  startPosRealtimeListener: vi.fn(),
  stopPosRealtimeListener: vi.fn(async () => undefined)
}));
vi.mock('../../salesCloud/salesCloudShadowService', () => ({
  salesCloudShadowService: { retryPendingShadowSales: vi.fn().mockResolvedValue(0) }
}));

import { useAppStore } from '../../../store/useAppStore';
import { closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { openTenantRuntime, getActiveTenantDatabase, getActiveTenantRuntime } from '../../db/tenantRuntimeRouter';
import { db, STORES } from '../../db/dexie';
import { actorRuntimeController } from '../../auth/actorRuntimeController';
import { assertLocalTenantAccess, resolveActiveTenantIdentity } from '../../tenant/localTenantGuard';
import { isSyncHandlerHookLifecycleTracked, posSyncOrchestrator } from '../posSyncOrchestrator';
import { createSyncExecutionScope } from '../syncExecutionScope';
import { syncMetaService } from '../syncMetaService';
import { POS_SYNC_STORES, SYNC_META_KEYS, isCloudLayawaysEnabled } from '../syncConstants';
import { layawayRepository } from '../../db/layaways';
import { salesCloudCashierService } from '../../salesCloud/salesCloudCashierService';
import { layawaySyncHandler } from '../../salesCloud/layawaySyncHandler';
import '../../cash/cashSyncHandler';
import '../../products/productSyncHandler';
import '../../salesCloud/salesCloudSyncHandler';

const LICENSE = 'layaway-sync-integration';
const LAYAWAY_CURSOR = SYNC_META_KEYS.LAYAWAY_LAST_CHANGE_SEQ;
const when = '2026-11-26T12:00:00.000Z';
const CASH_STATION_ID = 'cash_station_device_11111111-1111-4111-8111-111111111111';
const details = {
  license_key: LICENSE,
  plan_code: 'pro',
  valid: true,
  features: {
    cloud_pos_sync: true,
    cloud_products_sync: true,
    cloud_sales_sync_base: true,
    cloud_cash_sync: true,
    cloud_sales_cashier: true,
    cloud_layaways: true
  }
};
const migrationContract = {
  contract_version: 2,
  tenant_id: fixture.tenantId,
  server_status: 'SUPPORTED',
  endpoint_families: ['financial_operations'],
  endpoints: ['pos_execute_financial_operation_v2', 'pos_get_financial_operation_receipt_v2'],
  capabilities: ['historical_credit_preservation_v1', 'customer_projection_safe_apply_v1', 'financial_operation_result_v1']
};
const operationEnvelope = (endpoint, args, payload) => ({
  contract_version: 2,
  tenant_id: fixture.tenantId,
  endpoint,
  family: 'financial_operations',
  customer_projection_scope: 'OPERATION_RESULT',
  payload,
  customer_projections: [],
  operation: {
    idempotency_key: args.p_idempotency_key,
    request_hash: args.p_request_hash,
    operation_type: args.p_operation_type
  }
});

const catalogProduct = (version, stock) => ({
  id: 'product-layaway', name: 'Producto apartado QA', price: 10, cost: 4,
  stock, track_stock: true, uses_batches: true, is_active: true,
  server_version: version, created_at: when, updated_at: when
});
const catalogBatch = (version, stock) => ({
  id: 'batch-layaway', product_id: 'product-layaway', sku: 'LOTE-QA',
  price: 10, cost: 4, stock, is_active: true,
  server_version: version, created_at: when, updated_at: when
});

const makeCloud = () => ({
  seq: 0,
  events: [],
  layaways: new Map(),
  payments: [],
  reservations: [],
  cashMovements: [],
  inventoryMovements: [],
  deletedIds: [],
  sales: [],
  productVersion: 1,
  productStock: 20,
  batchStock: 20,
  productChangeSeq: 0,
  cashMovementCount: 0,
  inventoryMovementCount: 0,
  saleWriteCount: 0,
  financialWriteCount: 0
});

const appendEvent = (entityType, entityId, layawayId, metadata = {}) => {
  const cloud = fixture.cloud;
  const event = {
    entity_type: entityType,
    entity_id: entityId,
    change_seq: ++cloud.seq,
    metadata: { ...(layawayId ? { layaway_id: layawayId } : {}), ...metadata }
  };
  cloud.events.push(event);
  if (entityType === 'product' || entityType === 'product_batch') cloud.productChangeSeq = event.change_seq;
  return event;
};

const makeCashMovement = ({ id, layawayId, amount, changeSeq }) => ({
  id,
  layaway_id: layawayId,
  reference_type: 'layaway',
  reference_id: layawayId,
  type: 'ingreso',
  amount,
  concept: 'Abono de apartado QA',
  created_at: when,
  cash_session_id: 'cash-session-a',
  cash_station_id: CASH_STATION_ID,
  actor_key: 'admin:owner-a',
  server_version: 1,
  change_seq: changeSeq
});

const makeItem = (id, quantity) => ({
  id,
  product_id: 'product-layaway',
  product_name: 'Producto apartado QA',
  product_sku: 'LOTE-QA',
  quantity,
  unit_price: 10,
  unit_cost: 4,
  line_total: quantity * 10,
  batch_id: 'batch-layaway'
});

const buildMutationResult = (operationType, request) => {
  const cloud = fixture.cloud;
  if (operationType === 'layaway.create') {
    const input = request.layaway;
    const items = (input.items || []).map((item, index) => ({
      ...item,
      id: item.id || `${input.id}-item-${index + 1}`,
      product_id: item.product_id || item.productId || 'product-layaway',
      batch_id: item.batch_id || item.batchId || 'batch-layaway',
      unit_price: item.unit_price ?? item.price ?? 10,
      line_total: item.line_total ?? item.lineTotal ?? Number(item.quantity || 1) * 10
    }));
    const total = Number(input.totalAmount ?? input.total_amount ?? items.reduce((sum, item) => sum + Number(item.line_total), 0));
    const layaway = {
      id: input.id,
      customer_id: input.customerId || input.customer_id || 'customer-qa',
      customer_name: input.customerName || input.customer_name || 'Cliente QA',
      deadline: input.deadline || '2099-12-31',
      total_amount: total,
      paid_amount: 0,
      balance_due: total,
      currency: 'MXN',
      status: 'active',
      items,
      server_version: 1,
      created_at: when,
      updated_at: when
    };
    cloud.layaways.set(layaway.id, layaway);
    for (const item of items) {
      cloud.reservations.push({
        id: `reservation-${layaway.id}-${item.id}`,
        layaway_id: layaway.id,
        product_id: item.product_id,
        batch_id: item.batch_id,
        item_index: 0,
        quantity: item.quantity,
        status: 'reserved',
        created_at: when
      });
    }
    appendEvent('layaway', layaway.id, layaway.id);
    for (const reservation of cloud.reservations.filter(row => row.layaway_id === layaway.id)) {
      appendEvent('layaway_inventory_reservation', reservation.id, layaway.id);
    }
    cloud.productVersion += 1;
    appendEvent('product_batch', 'batch-layaway', layaway.id, { product_id: 'product-layaway' });
    appendEvent('product', 'product-layaway', layaway.id);
    return { success: true, layaway, payments: [], inventory_reservations: cloud.reservations.filter(row => row.layaway_id === layaway.id) };
  }

  if (operationType === 'layaway.payment') {
    const layaway = cloud.layaways.get(request.layaway_id);
    const payment = request.payment;
    const movementId = `cash-${payment.id}`;
    const movement = makeCashMovement({ id: movementId, layawayId: layaway.id, amount: payment.amount, changeSeq: cloud.seq + 1 });
    const cashEvent = appendEvent('cash_movement', movementId, layaway.id);
    movement.change_seq = cashEvent.change_seq;
    cloud.cashMovements.push(movement);
    cloud.cashMovementCount += 1;
    const confirmedPayment = {
      id: payment.id,
      layaway_id: layaway.id,
      amount: payment.amount,
      payment_type: payment.paymentType || payment.type || 'installment',
      status: 'confirmed',
      created_at: payment.date || when,
      cash_movement_id: movementId
    };
    cloud.payments.push(confirmedPayment);
    const paymentEvent = appendEvent('layaway_payment', payment.id, layaway.id);
    layaway.paid_amount = Number(layaway.paid_amount) + Number(payment.amount);
    layaway.balance_due = Number(layaway.total_amount) - Number(layaway.paid_amount);
    layaway.server_version += 1;
    layaway.updated_at = when;
    appendEvent('layaway', layaway.id, layaway.id);
    return {
      success: true,
      layaway: { ...layaway },
      payment: { ...confirmedPayment },
      payments: cloud.payments.filter(row => row.layaway_id === layaway.id),
      cash_movement: { ...movement },
      cash_movements: cloud.cashMovements.filter(row => row.layaway_id === layaway.id),
      inventory_reservations: cloud.reservations.filter(row => row.layaway_id === layaway.id),
      change_seq: paymentEvent.change_seq
    };
  }

  if (operationType === 'layaway.cancel') {
    const layaway = cloud.layaways.get(request.layaway_id);
    layaway.status = 'cancelled';
    layaway.server_version += 1;
    layaway.updated_at = when;
    for (const reservation of cloud.reservations.filter(row => row.layaway_id === layaway.id)) reservation.status = 'released';
    appendEvent('layaway', layaway.id, layaway.id);
    for (const reservation of cloud.reservations.filter(row => row.layaway_id === layaway.id)) {
      appendEvent('layaway_inventory_reservation', reservation.id, layaway.id);
    }
    cloud.productVersion += 1;
    appendEvent('product_batch', 'batch-layaway', layaway.id, { product_id: 'product-layaway' });
    appendEvent('product', 'product-layaway', layaway.id);
    return {
      success: true,
      layaway: { ...layaway },
      payments: cloud.payments.filter(row => row.layaway_id === layaway.id),
      inventory_reservations: cloud.reservations.filter(row => row.layaway_id === layaway.id)
    };
  }

  if (operationType === 'sale.layaway_complete') {
    const layaway = cloud.layaways.get(request.layaway_id);
    layaway.status = 'completed';
    layaway.server_version += 1;
    layaway.updated_at = when;
    layaway.completed_at = when;
    for (const reservation of cloud.reservations.filter(row => row.layaway_id === layaway.id)) reservation.status = 'consumed';
    cloud.productStock -= 2;
    cloud.batchStock -= 2;
    cloud.productVersion += 1;
    const sale = {
      id: `cloud-${request.sale.id}`,
      local_sale_id: request.sale.id,
      customer_id: layaway.customer_id,
      customer_name: layaway.customer_name,
      status: 'closed',
      total: layaway.total_amount,
      subtotal: layaway.total_amount,
      payment_method: 'layaway_completed',
      payment_status: 'paid',
      amount_paid: layaway.total_amount,
      balance_due: 0,
      source_mode: 'cloud_committed',
      effects_status: 'cash_inventory_applied',
      inventory_effect_status: 'applied',
      server_version: 1,
      sold_at: when
    };
    const item = { ...makeItem(`sale-item-${layaway.id}`, 2), sale_id: sale.id };
    const payment = { id: `sale-payment-${layaway.id}`, sale_id: sale.id, method: 'layaway_completed', amount: layaway.total_amount };
    cloud.sales.push({ sale, item, payment });
    cloud.saleWriteCount += 1;
    const movement = {
      id: `inventory-${layaway.id}`,
      layaway_id: layaway.id,
      product_id: 'product-layaway',
      batch_id: 'batch-layaway',
      movement_type: 'layaway_consumption',
      quantity: 2,
      metadata: { layaway_id: layaway.id, sale_id: sale.id },
      created_at: when
    };
    cloud.inventoryMovements.push(movement);
    cloud.inventoryMovementCount += 1;
    appendEvent('layaway', layaway.id, layaway.id);
    for (const reservation of cloud.reservations.filter(row => row.layaway_id === layaway.id)) {
      appendEvent('layaway_inventory_reservation', reservation.id, layaway.id);
    }
    appendEvent('sale', sale.id, layaway.id);
    appendEvent('inventory_movement', movement.id, layaway.id, { sale_id: sale.id, product_id: 'product-layaway', batch_id: 'batch-layaway' });
    appendEvent('product_batch', 'batch-layaway', layaway.id, { product_id: 'product-layaway' });
    appendEvent('product', 'product-layaway', layaway.id);
    return {
      success: true,
      layaway: { ...layaway },
      sale,
      items: [item],
      payments: [payment],
      inventory_reservations: cloud.reservations.filter(row => row.layaway_id === layaway.id),
      inventory_movements: [movement]
    };
  }

  throw new Error(`Unexpected financial operation ${operationType}`);
};

const response = data => ({ data, error: null });
const installRpcTransport = () => fixture.rpc.mockImplementation((name, args = {}) => {
  const query = Promise.resolve().then(async () => {
  expect(args.p_license_key).toBe(LICENSE);
  const cloud = fixture.cloud;
  if (name === 'pos_fin01_sync_contract_v1') return response(migrationContract);
  if (name === 'pos_get_cash_station_state') {
    return response({ cash_station: { id: CASH_STATION_ID }, station_open_cash_session: { id: 'cash-session-a' } });
  }
  if (name === 'pos_execute_financial_operation_v2') {
    expect(args.p_device_fingerprint).toBe(fixture.device);
    cloud.financialWriteCount += 1;
    return response(operationEnvelope(name, args, buildMutationResult(args.p_operation_type, args.p_request)));
  }
  if (name === 'pos_snapshot_sync_contract_v1') {
    return { data: null, error: { code: 'PGRST202', message: 'Function missing in transport fixture' } };
  }
  if (name === 'pos_pull_sync_events') {
    const since = Number(args.p_since_change_seq || 0);
    const events = fixture.replayEvents
      ? cloud.events.slice(-12)
      : cloud.events.filter(event => event.change_seq > since);
    fixture.replayEvents = false;
    return response({
      success: true,
      events,
      latest_change_seq: cloud.seq,
      server_latest_change_seq: cloud.seq,
      safe_change_seq: cloud.seq,
      has_more: false,
      sync_deferred: false
    });
  }
  if (name === 'pos_pull_layaway_changes') {
    expect(args.p_limit).toBe(499);
    if (fixture.revokeOnLayawayRead) {
      fixture.revokeOnLayawayRead = false;
      actorRuntimeController.lock('fixture_permission_revoked_during_read');
    }
    if (fixture.failLayawayRead) {
      fixture.failLayawayRead = false;
      return { data: null, error: new Error('Failed to fetch') };
    }
    const since = Number(args.p_since_change_seq || 0);
    if (since > cloud.seq) {
      return response({
        success: true, events: [], layaways: [], payments: [], inventory_reservations: [],
        cash_movements: [], inventory_movements: [], deleted_ids: [],
        since_change_seq: since, latest_change_seq: since, server_latest_change_seq: cloud.seq,
        safe_change_seq: cloud.seq, has_more: false, sync_deferred: true,
        cursor_ahead_of_safe_frontier: true
      });
    }
    if (fixture.deferLayawayRead) {
      fixture.deferLayawayRead = false;
      return response({
        success: true, events: [], layaways: [], payments: [], inventory_reservations: [],
        cash_movements: [], inventory_movements: [], deleted_ids: [],
        since_change_seq: since, latest_change_seq: since, server_latest_change_seq: cloud.seq,
        safe_change_seq: cloud.seq, has_more: false, sync_deferred: true
      });
    }
    const eligibleTypes = new Set([
      'layaway', 'layaway_payment', 'layaway_inventory_reservation', 'cash_movement', 'product', 'product_batch'
    ]);
    const allEvents = cloud.events.filter(event => event.change_seq > since && eligibleTypes.has(event.entity_type));
    const selected = allEvents.slice(0, 499);
    const latest = allEvents.length > 499 ? selected.at(-1).change_seq : cloud.seq;
    const ids = new Set(selected.map(event => (
      event.entity_type === 'layaway' ? event.entity_id : event.metadata?.layaway_id
    )).filter(Boolean));
    return response({
      success: true,
      events: selected,
      layaways: [...ids].map(id => cloud.layaways.get(id)).filter(Boolean).map(layaway => ({ ...layaway, items: layaway.items.map(item => ({ ...item })) })),
      payments: cloud.payments.filter(row => ids.has(row.layaway_id)).map(row => ({ ...row })),
      inventory_reservations: cloud.reservations.filter(row => ids.has(row.layaway_id)).map(row => ({ ...row })),
      cash_movements: cloud.cashMovements.filter(row => ids.has(row.layaway_id)).map(row => ({ ...row })),
      inventory_movements: cloud.inventoryMovements.filter(row => ids.has(row.layaway_id)).map(row => ({ ...row })),
      deleted_ids: cloud.deletedIds.filter(id => ids.has(id)),
      since_change_seq: since,
      latest_change_seq: latest,
      server_latest_change_seq: cloud.seq,
      safe_change_seq: cloud.seq,
      has_more: allEvents.length > 499,
      sync_deferred: false
    });
  }
  if (name === 'pos_pull_cash_changes') {
    const since = Number(args.p_since_change_seq || 0);
    return response({
      success: true,
      cash_sessions: [],
      movements: cloud.cashMovements.filter(movement => movement.change_seq > since).map(movement => ({ ...movement })),
      latest_change_seq: cloud.seq,
      has_more: false,
      sync_deferred: false
    });
  }
  if (name === 'pos_pull_product_catalog_changes') {
    const since = Number(args.p_since_change_seq || 0);
    const changed = since < cloud.productChangeSeq;
    return response({
      success: true,
      categories: [],
      products: changed ? [catalogProduct(cloud.productVersion, cloud.productStock)] : [],
      batches: changed ? [catalogBatch(cloud.productVersion, cloud.batchStock)] : [],
      events: cloud.events.filter(event => event.change_seq > since && ['product', 'product_batch'].includes(event.entity_type)),
      latest_change_seq: cloud.seq,
      has_more: false,
      sync_deferred: false
    });
  }
  if (name === 'pos_pull_sales_changes') {
    const since = Number(args.p_since_change_seq || 0);
    const changed = cloud.sales.filter(({ sale }) => since < cloud.seq && sale);
    return response({
      success: true,
      sales: changed.map(row => ({ ...row.sale })),
      items: changed.map(row => ({ ...row.item })),
      payments: changed.map(row => ({ ...row.payment })),
      events: cloud.events.filter(event => event.change_seq > since && ['sale', 'sale_item', 'sale_payment', 'sale_cancellation'].includes(event.entity_type)),
      latest_change_seq: cloud.seq,
      has_more: false,
      sync_deferred: false
    });
  }
    throw new Error(`Unexpected RPC ${name}`);
  });
  query.abortSignal = () => query;
  return query;
});

const grant = (device, { permissions = ['*'], actorId = 'owner-a' } = {}) => {
  fixture.device = device;
  actorRuntimeController.lock('test_device_switch');
  actorRuntimeController.beginAuthentication({ actorType: permissions.includes('*') ? 'admin' : 'staff', deviceRef: device });
  actorRuntimeController.grant({
    actorType: permissions.includes('*') ? 'admin' : 'staff',
    actorId,
    sessionId: `session-${device}`,
    deviceRef: device,
    permissions,
    tenantOpaqueId: getActiveTenantRuntime().opaqueId,
    authorizationExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
  useAppStore.setState({
    licenseDetails: details,
    currentDeviceRole: permissions.includes('*') ? 'admin' : 'staff',
    currentAdminUser: permissions.includes('*') ? { id: actorId } : null,
    currentStaffUser: permissions.includes('*') ? null : { id: actorId }
  });
  return actorRuntimeController.capture();
};

const createLayaway = (id, quantity = 1, totalAmount = quantity * 10) => (
  salesCloudCashierService.processCloudLayawayCreate({
    licenseDetails: details,
    layawayData: {
      id,
      customerId: 'customer-qa',
      customerName: 'Cliente QA',
      deadline: '2099-12-31',
      totalAmount,
      items: [makeItem(`item-${id}`, quantity)]
    }
  })
);

const snapshotDeviceTables = async () => {
  const tableNames = [
    STORES.LAYAWAYS, STORES.MENU, STORES.PRODUCT_BATCHES, STORES.CAJAS,
    STORES.MOVIMIENTOS_CAJA, STORES.SALES, STORES.SYNC_CACHE, STORES.INVENTORY_EVENTS,
    STORES.FINANCIAL_INTENTS, POS_SYNC_STORES.META, POS_SYNC_STORES.OUTBOX
  ];
  const rows = new Map();
  for (const name of tableNames) rows.set(name, await db.table(name).toArray());
  return rows;
};

const restoreDeviceTables = async (rows) => {
  for (const [name, tableRows] of rows) {
    await db.table(name).clear();
    if (tableRows.length > 0) await db.table(name).bulkPut(tableRows);
  }
};

const runAsAWhilePreservingB = async (action) => {
  const bRows = await snapshotDeviceTables();
  const wasOnline = navigator.onLine;
  const wasStarted = posSyncOrchestrator.getStatus().started;
  if (wasStarted) await posSyncOrchestrator.stop({ preserveStatus: true });
  grant('device-a');
  try {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    return await action();
  } finally {
    await restoreDeviceTables(bRows);
    grant('device-b');
    Object.defineProperty(navigator, 'onLine', { value: wasOnline, configurable: true });
    if (wasStarted) await posSyncOrchestrator.start({ licenseDetails: details, reason: 'initial_bootstrap' });
  }
};

const pullForB = async (reason = 'two_device_sync') => {
  let result;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = await posSyncOrchestrator.pullIncremental(attempt === 0 ? reason : `${reason}_settled`);
    if (result?.reason !== 'pull_in_progress_pending') return result;
    await vi.waitFor(() => {
      const state = posSyncOrchestrator.getStatus();
      expect(state.pullInProgress || state.pendingPull).toBe(false);
    }, { timeout: 5000 });
  }
  return result;
};

describe('cloud layaway sync: confirmed server reads across separate actor/device contexts', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_ENABLE_CLOUD_LAYAWAYS', 'true');
    vi.stubEnv('VITE_ENABLE_CLOUD_CASHIER_SALES', 'true');
    fixture.cloud = makeCloud();
    fixture.failLayawayRead = false;
    fixture.deferLayawayRead = false;
    fixture.revokeOnLayawayRead = false;
    fixture.replayEvents = false;
    fixture.rpc.mockReset();
    vi.mocked(isCloudLayawaysEnabled).mockReturnValue(true);
    installRpcTransport();
    await openTenantRuntime(await resolveActiveTenantIdentity(LICENSE));
    await Promise.all(getActiveTenantDatabase().tables.map(table => table.clear()));
    await assertLocalTenantAccess({ license_key: LICENSE });
    useAppStore.setState({ licenseDetails: details, currentDeviceRole: 'admin' });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  afterEach(async () => {
    await posSyncOrchestrator.stop({ preserveStatus: true });
    actorRuntimeController.lock('layaway_fixture_closed');
    useAppStore.setState({ licenseDetails: null, currentDeviceRole: 'admin', currentAdminUser: null, currentStaffUser: null });
    await closeTestTenantRuntime();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it.each(['onStart', 'onEvents'])('keeps the real layaway %s hook inside its scoped promise', async (hook) => {
    grant('device-b');
    expect(layawaySyncHandler.executionScopeLifecycle).toEqual({
      version: 1,
      awaitedHooks: ['onStart', 'onEvents']
    });
    expect(isSyncHandlerHookLifecycleTracked(layawaySyncHandler, hook)).toBe(true);
    expect(posSyncOrchestrator.getStatus().handlers).toEqual(expect.arrayContaining([
      'layaway', 'layaway_payment', 'layaway_inventory_reservation'
    ]));
    let releaseRead;
    fixture.rpc.mockImplementationOnce((name) => {
      expect(name).toBe('pos_pull_layaway_changes');
      const query = new Promise(resolve => { releaseRead = resolve; });
      query.abortSignal = () => query;
      return query;
    });

    const scope = createSyncExecutionScope({
      id: `layaway-${hook}-lifecycle`,
      generation: 1,
      context: { actor: 'owner-a', tenant: LICENSE, device: 'device-b' },
      isContextCurrent: () => fixture.device === 'device-b'
    });
    const task = scope.run(`layaway:${hook}`, () => hook === 'onStart'
      ? layawaySyncHandler.onStart({ licenseDetails: details, reason: 'manual' })
      : layawaySyncHandler.onEvents([{ entity_type: 'layaway', entity_id: 'layaway-lifecycle' }], { licenseKey: LICENSE }));
    await vi.waitFor(() => expect(releaseRead).toEqual(expect.any(Function)));
    scope.quiesce();
    expect(scope.getSnapshot().pending).toBe(1);

    releaseRead(response({
      success: true, events: [], layaways: [], payments: [], inventory_reservations: [],
      cash_movements: [], inventory_movements: [], deleted_ids: [],
      since_change_seq: 0, latest_change_seq: 0, server_latest_change_seq: 0,
      safe_change_seq: 0, has_more: false, sync_deferred: false,
      cursor_ahead_of_safe_frontier: false
    }));

    await expect(task).resolves.toMatchObject({ success: true, syncDeferred: false });
    expect((await scope.settleObserved()).state).toBe('DRAINED');
  });

  it('reconciles create, payment, offline catch-up, cancellation, delivery and duplicate/stale reads without repeating writes', async () => {
    grant('device-a');
    await createLayaway('layaway-payment-flow', 1, 100);
    // The receiving device starts with independent local projections and cursor.
    for (const name of [STORES.LAYAWAYS, STORES.MENU, STORES.PRODUCT_BATCHES, STORES.CAJAS,
      STORES.MOVIMIENTOS_CAJA, STORES.SALES, STORES.SYNC_CACHE, STORES.INVENTORY_EVENTS]) {
      await db.table(name).clear();
    }
    grant('device-b');
    await posSyncOrchestrator.start({ licenseDetails: details, reason: 'initial_bootstrap' });
    await pullForB('create_from_device_a');
    expect(await layawayRepository.getById('layaway-payment-flow')).toMatchObject({
      sourceMode: 'cloud_committed', status: 'active', paidAmount: 0, balanceDue: 100,
      cloudServerVersion: 1,
      cloudInventoryReservations: [expect.objectContaining({ status: 'reserved', batch_id: 'batch-layaway' })]
    });
    expect(await syncMetaService.getMeta(LAYAWAY_CURSOR, 0, { licenseKey: LICENSE })).toBe(fixture.cloud.seq);
    expect(fixture.rpc.mock.calls.filter(([name]) => name === 'pos_pull_layaway_changes')[0][1].p_since_change_seq).toBe(0);

    await runAsAWhilePreservingB(() => salesCloudCashierService.processCloudLayawayPayment({
      layawayId: 'layaway-payment-flow', cashSessionId: 'cash-session-a', licenseDetails: details,
      payment: { id: 'payment-one', amount: 30, customerId: 'customer-qa', type: 'installment', date: when }
    }));
    await pullForB('first_payment');
    expect(await layawayRepository.getById('layaway-payment-flow')).toMatchObject({ paidAmount: 30, balanceDue: 70, cloudServerVersion: 2 });
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(1);

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await runAsAWhilePreservingB(() => salesCloudCashierService.processCloudLayawayPayment({
      layawayId: 'layaway-payment-flow', cashSessionId: 'cash-session-a', licenseDetails: details,
      payment: { id: 'payment-two', amount: 20, customerId: 'customer-qa', type: 'installment', date: when }
    }));
    const layawayReadCountBeforeOffline = fixture.rpc.mock.calls.filter(([name]) => name === 'pos_pull_layaway_changes').length;
    await pullForB('offline_device');
    expect(fixture.rpc.mock.calls.filter(([name]) => name === 'pos_pull_layaway_changes')).toHaveLength(layawayReadCountBeforeOffline);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await pullForB('reconnected_device');
    expect(await layawayRepository.getById('layaway-payment-flow')).toMatchObject({ paidAmount: 50, balanceDue: 50, cloudServerVersion: 3 });
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(2);

    await runAsAWhilePreservingB(() => createLayaway('layaway-cancel-flow', 1, 10));
    await pullForB('cancel_layaway_create');
    await runAsAWhilePreservingB(() => salesCloudCashierService.processCloudLayawayCancel({
      layawayId: 'layaway-cancel-flow', retainMoney: true, licenseDetails: details
    }));
    await pullForB('cancel_layaway');
    expect(await layawayRepository.getById('layaway-cancel-flow')).toMatchObject({
      status: 'cancelled', cloudInventoryReservations: [expect.objectContaining({ status: 'released' })]
    });
    expect(await db.table(STORES.MENU).get('product-layaway')).toMatchObject({ stock: 20 });

    await runAsAWhilePreservingB(() => createLayaway('layaway-delivery-flow', 2, 20));
    await pullForB('delivery_layaway_create');
    await runAsAWhilePreservingB(() => salesCloudCashierService.processCloudLayawayPayment({
      layawayId: 'layaway-delivery-flow', cashSessionId: 'cash-session-a', licenseDetails: details,
      payment: { id: 'payment-delivery', amount: 20, customerId: 'customer-qa', type: 'installment', date: when }
    }));
    await pullForB('delivery_layaway_payment');
    await runAsAWhilePreservingB(() => salesCloudCashierService.processCloudLayawayCompletion({
      licenseDetails: details,
      request: {
        layaway_id: 'layaway-delivery-flow',
        sale: { id: 'local-delivery-sale', total: 20, customer_id: 'customer-qa', timestamp: when },
        items: [makeItem('sale-line-delivery', 2)],
        payments: [{ id: 'completion-payment', method: 'layaway_completed', amount: 20 }],
        local_items: [makeItem('sale-line-delivery', 2)]
      }
    }));
    await pullForB('delivery_layaway_complete');
    const completed = await layawayRepository.getById('layaway-delivery-flow');
    expect(completed).toMatchObject({ status: 'completed', paidAmount: 20, balanceDue: 0,
      cloudInventoryReservations: [expect.objectContaining({ status: 'consumed' })],
      cloudInventoryMovements: [expect.objectContaining({ id: 'inventory-layaway-delivery-flow' })]
    });
    expect(await db.table(STORES.MENU).get('product-layaway')).toMatchObject({ stock: 18 });
    expect(await db.table(STORES.PRODUCT_BATCHES).get('batch-layaway')).toMatchObject({ stock: 18 });
    expect(await db.table(STORES.SYNC_CACHE).filter(row => row.key === 'cloud_sale:cloud-local-delivery-sale').count()).toBe(1);
    expect(await db.table(STORES.SALES).count()).toBe(0);
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(0);

    const newer = await layawayRepository.getById('layaway-payment-flow');
    const stale = fixture.cloud.layaways.get('layaway-payment-flow');
    await layawayRepository.upsertCloudSnapshot({
      layaway: { ...stale, status: 'active', paid_amount: 30, balance_due: 70, server_version: 2 },
      payments: fixture.cloud.payments.filter(row => row.layaway_id === stale.id).slice(0, 1)
    });
    expect(await layawayRepository.getById('layaway-payment-flow')).toMatchObject({
      status: newer.status, paidAmount: 50, balanceDue: 50, cloudServerVersion: 3
    });

    fixture.replayEvents = true;
    const writesBeforeReplay = fixture.cloud.financialWriteCount;
    await pullForB('duplicate_notification');
    expect(await layawayRepository.getById('layaway-delivery-flow')).toMatchObject({ status: 'completed', paidAmount: 20 });
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(3);
    expect(await db.table(STORES.SYNC_CACHE).filter(row => row.key === 'cloud_sale:cloud-local-delivery-sale').count()).toBe(1);
    expect(fixture.cloud.financialWriteCount).toBe(writesBeforeReplay);
    expect(fixture.cloud.cashMovementCount).toBe(3);
    expect(fixture.cloud.inventoryMovementCount).toBe(1);
    expect(fixture.cloud.saleWriteCount).toBe(1);
    expect(await db.table(POS_SYNC_STORES.OUTBOX).count()).toBe(0);
    expect(fixture.rpc.mock.calls.filter(([name]) => name === 'pos_execute_financial_operation_v2')).toHaveLength(writesBeforeReplay);
  }, 30000);

  it('keeps the layaway cursor on read, apply and checkpoint failure, then resumes after restart', async () => {
    grant('device-a');
    await createLayaway('layaway-recovery', 1, 10);
    for (const name of [STORES.LAYAWAYS, STORES.MENU, STORES.PRODUCT_BATCHES, STORES.CAJAS,
      STORES.MOVIMIENTOS_CAJA, STORES.SALES, STORES.SYNC_CACHE, STORES.INVENTORY_EVENTS]) {
      await db.table(name).clear();
    }
    grant('device-b');
    await posSyncOrchestrator.start({ licenseDetails: details, reason: 'initial_bootstrap' });
    await pullForB('initial_recovery');
    const cursorBefore = await syncMetaService.getMeta(LAYAWAY_CURSOR, 0, { licenseKey: LICENSE });

    await runAsAWhilePreservingB(() => salesCloudCashierService.processCloudLayawayPayment({
      layawayId: 'layaway-recovery', cashSessionId: 'cash-session-a', licenseDetails: details,
      payment: { id: 'payment-recovery', amount: 2, customerId: 'customer-qa', type: 'installment', date: when }
    }));
    fixture.failLayawayRead = true;
    await pullForB('read_failure');
    await vi.waitFor(async () => {
      expect(await syncMetaService.getDeferredHandlerReads(LICENSE)).toContain('layaway');
    }, { timeout: 5000 });
    expect(await syncMetaService.getMeta(LAYAWAY_CURSOR, 0, { licenseKey: LICENSE })).toBe(cursorBefore);

    const originalAdvance = syncMetaService.advanceMeta.bind(syncMetaService);
    const advanceSpy = vi.spyOn(syncMetaService, 'advanceMeta').mockImplementation((key, value, options) => (
      key === LAYAWAY_CURSOR ? Promise.resolve(null) : originalAdvance(key, value, options)
    ));
    await pullForB('checkpoint_failure');
    expect(await layawayRepository.getById('layaway-recovery')).toMatchObject({ paidAmount: 2, balanceDue: 8 });
    expect(await syncMetaService.getMeta(LAYAWAY_CURSOR, 0, { licenseKey: LICENSE })).toBe(cursorBefore);
    advanceSpy.mockRestore();

    fixture.deferLayawayRead = true;
    await pullForB('deferred_empty_page');
    expect(await syncMetaService.getMeta(LAYAWAY_CURSOR, 0, { licenseKey: LICENSE })).toBe(cursorBefore);
    expect(await syncMetaService.getDeferredHandlerReads(LICENSE)).toContain('layaway');
    await posSyncOrchestrator.stop({ preserveStatus: true });
    const bDatabase = getActiveTenantDatabase();
    bDatabase.close();
    await bDatabase.open();
    grant('device-b');
    await posSyncOrchestrator.start({ licenseDetails: details, reason: 'initial_bootstrap' });
    await pullForB('restart_recovery');
    expect(await syncMetaService.getMeta(LAYAWAY_CURSOR, 0, { licenseKey: LICENSE })).toBe(fixture.cloud.seq);
    expect(await syncMetaService.getDeferredHandlerReads(LICENSE)).not.toContain('layaway');
    expect(await layawayRepository.getById('layaway-recovery')).toMatchObject({ paidAmount: 2, balanceDue: 8 });
  }, 30000);

  it('defers cursors above the safe frontier, paginates at 499, and preserves deletion tombstones', async () => {
    grant('device-a');
    await createLayaway('layaway-paginated', 1, 10);
    for (const name of [STORES.LAYAWAYS, STORES.MENU, STORES.PRODUCT_BATCHES, STORES.CAJAS,
      STORES.MOVIMIENTOS_CAJA, STORES.SALES, STORES.SYNC_CACHE, STORES.INVENTORY_EVENTS,
      STORES.FINANCIAL_INTENTS, POS_SYNC_STORES.META, POS_SYNC_STORES.OUTBOX]) {
      await db.table(name).clear();
    }
    const paginatedLayaway = fixture.cloud.layaways.get('layaway-paginated');
    for (let index = 0; index < 500; index += 1) {
      paginatedLayaway.server_version += 1;
      appendEvent('layaway', 'layaway-paginated', 'layaway-paginated');
    }

    grant('device-b');
    await posSyncOrchestrator.start({ licenseDetails: details, reason: 'initial_bootstrap' });
    const aheadCursor = fixture.cloud.seq + 10;
    await syncMetaService.setMeta(LAYAWAY_CURSOR, aheadCursor, { licenseKey: LICENSE });
    const ahead = await layawaySyncHandler.onStart({ licenseDetails: details, reason: 'manual' });
    expect(ahead).toMatchObject({ success: true, syncDeferred: true, reason: 'cursor_ahead_of_safe_frontier' });
    expect(await syncMetaService.getMeta(LAYAWAY_CURSOR, 0, { licenseKey: LICENSE })).toBe(aheadCursor);
    expect(await syncMetaService.getDeferredHandlerReads(LICENSE)).toContain('layaway');
    expect(await layawayRepository.getById('layaway-paginated')).toBeUndefined();

    await posSyncOrchestrator.stop({ preserveStatus: true });
    await syncMetaService.setMeta(LAYAWAY_CURSOR, 0, { licenseKey: LICENSE });
    await posSyncOrchestrator.start({ licenseDetails: details, reason: 'initial_bootstrap' });
    await pullForB('safe_frontier_recovery');
    const layawayPages = fixture.rpc.mock.calls
      .filter(([name]) => name === 'pos_pull_layaway_changes')
      .map(([, args]) => args.p_since_change_seq);
    expect(layawayPages).toContain(0);
    expect(layawayPages).toContain(499);
    expect(await syncMetaService.getMeta(LAYAWAY_CURSOR, 0, { licenseKey: LICENSE })).toBe(fixture.cloud.seq);
    expect(await syncMetaService.getDeferredHandlerReads(LICENSE)).not.toContain('layaway');
    expect(await layawayRepository.getById('layaway-paginated')).toMatchObject({ cloudServerVersion: 501, status: 'active' });

    fixture.cloud.deletedIds.push('layaway-paginated');
    paginatedLayaway.server_version += 1;
    paginatedLayaway.deleted_at = when;
    appendEvent('layaway', 'layaway-paginated', 'layaway-paginated');
    await pullForB('layaway_tombstone');
    expect(await layawayRepository.getById('layaway-paginated')).toMatchObject({ cloudDeleted: true, status: 'deleted' });
    expect(await layawayRepository.getByCustomer('customer-qa', false)).toEqual([]);
    await layawayRepository.upsertCloudSnapshot({ layaway: {
      ...fixture.cloud.layaways.get('layaway-paginated'), server_version: 1
    } });
    expect(await layawayRepository.getById('layaway-paginated')).toMatchObject({ cloudDeleted: true, status: 'deleted' });
  }, 30000);

  it('does not apply a page after actor revocation and skips the reader for Free/Local', async () => {
    grant('device-a');
    await createLayaway('layaway-authorization', 1, 10);
    for (const name of [STORES.LAYAWAYS, STORES.MENU, STORES.PRODUCT_BATCHES, STORES.CAJAS,
      STORES.MOVIMIENTOS_CAJA, STORES.SALES, STORES.SYNC_CACHE, STORES.INVENTORY_EVENTS]) {
      await db.table(name).clear();
    }
    grant('device-b');
    fixture.revokeOnLayawayRead = true;
    const events = fixture.cloud.events.filter(event => ['layaway', 'layaway_inventory_reservation'].includes(event.entity_type));
    await expect(layawaySyncHandler.onEvents(events, { licenseKey: LICENSE })).rejects.toThrow();
    expect(await layawayRepository.getById('layaway-authorization')).toBeUndefined();
    expect(await syncMetaService.getMeta(LAYAWAY_CURSOR, 0, { licenseKey: LICENSE })).toBe(0);

    const localActor = grant('device-b', { permissions: ['sales_view'], actorId: 'staff-without-pos' });
    expect(await layawaySyncHandler.onEvents(events, { licenseKey: LICENSE })).toMatchObject({
      skipped: true, reason: 'actor_permission_missing'
    });
    expect(localActor.actorType).toBe('staff');
    const callsBeforeFree = fixture.rpc.mock.calls.length;
    vi.mocked(isCloudLayawaysEnabled).mockReturnValue(false);
    grant('device-b');
    expect(await layawaySyncHandler.onStart({ licenseDetails: details, licenseKey: LICENSE, reason: 'manual' })).toMatchObject({ skipped: true });
    expect(fixture.rpc.mock.calls).toHaveLength(callsBeforeFree);
  });
});
