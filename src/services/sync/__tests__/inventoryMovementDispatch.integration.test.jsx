// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), device: null }));

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc: fixture.rpc },
  getStableDeviceId: async () => fixture.device,
  getDeviceSecurityToken: async () => 'security-'+fixture.device,
  getActorSessionToken: async () => 'session-'+fixture.device
}));
vi.mock('../../auth/actorRuntimeController', async (importOriginal) => {
  const actual = await importOriginal();
  const { getActiveTenantRuntime } = await import('../../db/tenantRuntimeRouter');
  return { ...actual, actorRuntimeController: actual.createActorRuntimeController({
    getTenantAuthority: getActiveTenantRuntime
  }) };
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
import { posSyncOrchestrator } from '../posSyncOrchestrator';
import { syncMetaService } from '../syncMetaService';
import { POS_SYNC_STORES } from '../syncConstants';
import { productCloudRepository } from '../../products/productCloudRepository';
import { productLocalRepository } from '../../products/productLocalRepository';
import '../../products/productSyncHandler';
import '../../salesCloud/salesCloudSyncHandler';

const LICENSE = 'inventory-movement-dispatch-integration';
const details = {
  license_key: LICENSE, plan_code: 'pro', valid: true,
  features: { cloud_pos_sync: true, cloud_products_sync: true, cloud_sales_sync_base: true }
};
const PRODUCT = 'product-movement';
const BATCH = 'batch-movement';
const SALE = 'sale-movement';
const CATALOG_SEQ = 'products_catalog_last_change_seq';
const SALES_SEQ = 'sales_cloud_base_last_change_seq';
const when = '2026-11-25T01:00:00.000Z';
const product = (stock, version) => ({ id: PRODUCT, name: 'Producto QA', price: 10, cost: 5, stock,
  track_stock: true, uses_batches: true, is_active: true, server_version: version, created_at: when, updated_at: when });
const batch = (stock, version) => ({ id: BATCH, product_id: PRODUCT, sku: 'Lote-QA', stock,
  price: 10, cost: 5, is_active: true, server_version: version, created_at: when, updated_at: when });
const sale = (status, version) => ({ id: SALE, local_sale_id: SALE, status, total: 20,
  source_mode: 'cloud_committed', effects_status: 'cash_inventory_applied', payment_method: 'cash',
  payment_status: 'paid', amount_paid: 20, balance_due: 0, server_version: version, sold_at: when });
const item = { id: 'item-movement', sale_id: SALE, product_id: PRODUCT, product_name: 'Producto QA',
  quantity: 2, batch_id: BATCH, unit_price: 10, line_total: 20 };
const payment = { id: 'payment-movement', sale_id: SALE, method: 'cash', amount: 20 };
const discovery = {
  contract_version: 1, contract_kind: 'SNAPSHOT_READ_ONLY', tenant_id: 'fixture-inventory-tenant',
  server_status: 'SUPPORTED',
  capabilities: ['historical_credit_preservation_v1','customer_projection_safe_apply_v1','snapshot_keyset_reference_v1'],
  endpoint_families: ['product_catalog','customer_directory','customer_credit','sales','cash_register'],
  endpoints: ['pos_pull_product_catalog_snapshot_v2','pos_pull_customers_snapshot_v3',
    'pos_pull_customer_credit_snapshot_v3','pos_pull_sales_snapshot_v2','pos_pull_cash_snapshot_v2']
};
const grant = (device) => {
  fixture.device = device;
  actorRuntimeController.lock('test_device_switch');
  actorRuntimeController.beginAuthentication({ actorType: 'admin', deviceRef: device });
  actorRuntimeController.grant({
    actorType: 'admin', actorId: 'owner-a', sessionId: 'session-'+device,
    deviceRef: device, permissions: ['*'], tenantOpaqueId: getActiveTenantRuntime().opaqueId,
    authorizationExpiresAt: new Date(Date.now()+60*60*1000).toISOString()
  });
  return actorRuntimeController.capture();
};
const event = (type, id, seq, metadata = {}) => ({ entity_type: type, entity_id: id, change_seq: seq, metadata });

describe('inventory movement dispatch: two authorized device contexts, real repositories and receiving IndexedDB', () => {
  beforeEach(async () => {
    await openTenantRuntime(await resolveActiveTenantIdentity(LICENSE));
    await assertLocalTenantAccess({ license_key: LICENSE });
    await Promise.all(getActiveTenantDatabase().tables.map(table => table.clear()));
    useAppStore.setState({ licenseDetails: details, currentDeviceRole: 'admin' });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    fixture.rpc.mockReset();
  });

  afterEach(async () => {
    await posSyncOrchestrator.stop({ preserveStatus: true });
    actorRuntimeController.lock('inventory_dispatch_fixture_closed');
    useAppStore.setState({ licenseDetails: null, currentDeviceRole: 'admin' });
    await closeTestTenantRuntime();
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('recovers A inventory receipt on B, converges sales and cancellation deltas, and never replays writes', async () => {
    // Only the transport is simulated: A sends the actual authorized inventory
    // repository mutation; B executes the real orchestrator, repositories,
    // actor guard, sync metadata and Dexie projections.
    const cloud = { seq: 0, stock: 10, version: 1, sale: null, catalogSeq: 0, salesSeq: 0, events: [],
      receipt: null, movementCount: 0, deferSale: false, replay: false };
    const catalog = () => ({ products: [product(cloud.stock, cloud.version)], batches: [batch(cloud.stock, cloud.version)], categories: [] });
    const response = data => ({ data, error: null });
    fixture.rpc.mockImplementation(async (name, args) => {
      expect(args.p_license_key).toBe(LICENSE);
      if (name === 'pos_add_inventory_entry') {
        expect(args.p_device_fingerprint).toBe('device-a');
        expect(args.p_idempotency_key).toBe('entry-a');
        if (!cloud.receipt) {
          cloud.stock += args.p_base_quantity;
          cloud.version += 1;
          cloud.seq = 3; cloud.catalogSeq = 2; cloud.movementCount += 1;
          cloud.events = [event('product_batch',BATCH,1),event('product',PRODUCT,2),
            event('inventory_movement','entry-movement',3,{product_id:PRODUCT,source:'inventory_entry'})];
          cloud.receipt = { success: true, product: product(cloud.stock,cloud.version),
            batch: batch(cloud.stock,cloud.version), inventory_movement: { id: 'entry-movement' },
            idempotency_key: args.p_idempotency_key };
        }
        return response(cloud.receipt);
      }
      expect(args.p_device_fingerprint).toBe('device-b');
      if (name === 'pos_snapshot_sync_contract_v1') return response(discovery);
      const since = args.p_since_change_seq ?? 0;
      const base = { success: true, latest_change_seq: cloud.seq, server_latest_change_seq: cloud.seq,
        safe_change_seq: cloud.seq, has_more: false, sync_deferred: false };
      if (name === 'pos_pull_sync_events') {
        const events = cloud.events.filter(row => cloud.replay || row.change_seq > since);
        cloud.replay = false;
        return response({ ...base, events });
      }
      if (name === 'pos_pull_product_catalog_changes') {
        return response({ ...base, ...(since < cloud.catalogSeq ? catalog() : { products: [], batches: [], categories: [] }),
          events: cloud.events.filter(row => ['product','product_batch'].includes(row.entity_type) && row.change_seq > since) });
      }
      if (name === 'pos_pull_sales_changes') {
        if (cloud.deferSale) {
          cloud.deferSale = false;
          return response({ ...base, latest_change_seq: since, safe_change_seq: since, sync_deferred: true, sales: [], items: [], payments: [], events: [] });
        }
        const changed = cloud.sale && since < cloud.salesSeq;
        return response({ ...base, sales: changed ? [cloud.sale] : [], items: changed ? [item] : [], payments: changed ? [payment] : [],
          events: cloud.events.filter(row => ['sale','sale_item'].includes(row.entity_type) && row.change_seq > since) });
      }
      throw new Error('Unexpected RPC '+name);
    });

    // B's device storage already contains the previous confirmed projection.
    grant('device-b');
    await productLocalRepository.applyCloudCatalog(catalog());
    const pending = { id: 'other-actor-pending', licenseKey: LICENSE, entityType: 'product',
      entityId: 'unrelated-product', operation: 'upsert', status: 'pending', attempts: 0,
      idempotencyKey: 'other-actor-pending', createdAt: when, originActorKey: 'staff:other', actorSensitivity: 'actor_bound' };
    await db.table(POS_SYNC_STORES.OUTBOX).put(pending);
    await syncMetaService.setLastChangeSeq(2, LICENSE);
    const handleA = grant('device-a');
    const receipt = await productCloudRepository.addInventoryEntry({
      licenseKey: LICENSE, actorHandle: handleA,
      entry: { productId: PRODUCT, batchId: BATCH, quantity: 3, baseQuantity: 3, unitCost: 5 },
      idempotencyKey: 'entry-a'
    });
    expect(receipt).toMatchObject({ success: true, product: { stock: 13 }, batch: { stock: 13 } });
    grant('device-b');
    expect(() => handleA.assertCurrent()).toThrow();
    expect(await db.table(STORES.MENU).get(PRODUCT)).toMatchObject({ stock: 10 });
    expect(await db.table(STORES.PRODUCT_BATCHES).get(BATCH)).toMatchObject({ stock: 10 });
    expect(await posSyncOrchestrator.start({ licenseDetails: details, reason: 'initial_bootstrap' })).toMatchObject({ started: true });

    await posSyncOrchestrator.pullIncremental('isolated_movement_no_broadcast');
    expect(await db.table(STORES.MENU).get(PRODUCT)).toMatchObject({ stock: 13, serverVersion: 2 });
    expect(await db.table(STORES.PRODUCT_BATCHES).get(BATCH)).toMatchObject({ productId: PRODUCT, stock: 13, serverVersion: 2 });
    expect(await syncMetaService.getMeta(CATALOG_SEQ,0,{licenseKey:LICENSE})).toBe(3);
    expect(await syncMetaService.getLastChangeSeq(LICENSE)).toBe(3);

    // Simulate a confirmed Cloud sale and its companion events. The first
    // sales read is deferred; the catalog succeeds independently.
    cloud.stock = 11; cloud.version = 3; cloud.seq = 7; cloud.catalogSeq = 5;
    cloud.salesSeq = 6; cloud.sale = sale('closed',1); cloud.movementCount += 1; cloud.deferSale = true;
    cloud.events = [event('product_batch',BATCH,4),event('product',PRODUCT,5),
      event('sale',SALE,6),event('inventory_movement','sale-movement',7,{sale_id:SALE,product_id:PRODUCT,batch_id:BATCH})];
    const before = fixture.rpc.mock.calls.length;
    await posSyncOrchestrator.pullIncremental('combined_sale_deferred');
    expect(await db.table(STORES.MENU).get(PRODUCT)).toMatchObject({ stock: 11 });
    expect(await db.table(STORES.PRODUCT_BATCHES).get(BATCH)).toMatchObject({ stock: 11 });
    expect(await db.table(STORES.SYNC_CACHE).get('cloud_sale:'+SALE)).toBeUndefined();
    expect(await syncMetaService.getLastChangeSeq(LICENSE)).toBe(3);
    expect(await syncMetaService.getDeferredHandlerReads(LICENSE)).toEqual(['sale']);
    expect(fixture.rpc.mock.calls.slice(before).filter(([name]) => name === 'pos_pull_product_catalog_changes')).toHaveLength(1);
    expect(fixture.rpc.mock.calls.slice(before).filter(([name]) => name === 'pos_pull_sales_changes')).toHaveLength(1);

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await posSyncOrchestrator.pullIncremental('offline');
    expect(await syncMetaService.getDeferredHandlerReads(LICENSE)).toEqual(['sale']);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await posSyncOrchestrator.pullIncremental('reconnected_delta');
    expect(await syncMetaService.getDeferredHandlerReads(LICENSE)).toEqual([]);
    expect(await syncMetaService.getLastChangeSeq(LICENSE)).toBe(7);
    expect(await syncMetaService.getMeta(SALES_SEQ,0,{licenseKey:LICENSE})).toBe(7);
    expect((await db.table(STORES.SYNC_CACHE).get('cloud_sale:'+SALE)).value).toMatchObject({
      sale: { status: 'closed', server_version: 1 }, items: [item],
      payments: [expect.objectContaining({ id: payment.id, amount: '20', method: 'cash', sale_id: SALE })]
    });

    // Server-confirmed cancellation restores stock; the client applies only
    // the authoritative quantity and sale version, never an additive reversal.
    cloud.stock = 13; cloud.version = 4; cloud.seq = 11; cloud.catalogSeq = 9;
    cloud.salesSeq = 10; cloud.sale = sale('cancelled',2); cloud.movementCount += 1;
    cloud.events = [event('product_batch',BATCH,8),event('product',PRODUCT,9),
      event('sale',SALE,10),event('inventory_movement','cancel-movement',11,{sale_id:SALE,product_id:PRODUCT,batch_id:BATCH})];
    await posSyncOrchestrator.pullIncremental('cancel_delta');
    cloud.replay = true;
    await posSyncOrchestrator.pullIncremental('duplicate_notification');
    expect(await db.table(STORES.MENU).get(PRODUCT)).toMatchObject({ stock: 13, serverVersion: 4 });
    expect(await db.table(STORES.PRODUCT_BATCHES).get(BATCH)).toMatchObject({ productId: PRODUCT, stock: 13, serverVersion: 4 });
    expect(await db.table(STORES.SYNC_CACHE).filter(row => row.key === 'cloud_sale:'+SALE).count()).toBe(1);
    expect((await db.table(STORES.SYNC_CACHE).get('cloud_sale:'+SALE)).value.sale).toMatchObject({ status: 'cancelled', server_version: 2 });
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(0);
    expect(await db.table(POS_SYNC_STORES.OUTBOX).get(pending.id)).toEqual(pending);
    expect(cloud.movementCount).toBe(3);
    expect(fixture.rpc.mock.calls.filter(([name]) => !name.startsWith('pos_pull_') && name !== 'pos_snapshot_sync_contract_v1').map(([name]) => name)).toEqual(['pos_add_inventory_entry']);
    expect(await syncMetaService.getLastChangeSeq(LICENSE)).toBe(11);
  }, 15000);
});
