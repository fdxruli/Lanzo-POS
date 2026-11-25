// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cash: { negotiateSnapshotProtocol: vi.fn(), pullCashSnapshot: vi.fn(), pullCashChanges: vi.fn() },
  credit: { negotiateSnapshotProtocol: vi.fn(), pullCreditSnapshot: vi.fn(), pullCreditChanges: vi.fn() },
  sales: { negotiateSnapshotProtocol: vi.fn(), pullSalesSnapshot: vi.fn(), pullSalesChanges: vi.fn() },
  creditMigration: { runInitialMigrationIfNeeded: vi.fn() },
  salesShadow: { retryPendingShadowSales: vi.fn() },
  orchestrator: { registerEntitySyncHandler: vi.fn() }
}));

vi.mock('../posSyncOrchestrator', () => ({ posSyncOrchestrator: mocks.orchestrator }));
vi.mock('../../auth/actorRuntimeController', async (importOriginal) => {
  const actual = await importOriginal();
  const { getActiveTenantRuntime: getTenantRuntime } = await import('../../db/tenantRuntimeRouter');
  return {
    ...actual,
    actorRuntimeController: actual.createActorRuntimeController({ getTenantAuthority: getTenantRuntime })
  };
});
vi.mock('../../cash/cashCloudRepository', () => ({ cashCloudRepository: mocks.cash }));
vi.mock('../../customerCredit/customerCreditCloudRepository', () => ({ customerCreditCloudRepository: mocks.credit }));
vi.mock('../../customerCredit/customerCreditMigrationService', () => ({ customerCreditMigrationService: mocks.creditMigration }));
vi.mock('../../salesCloud/salesCloudRepository', () => ({ salesCloudRepository: mocks.sales }));
vi.mock('../../salesCloud/salesCloudShadowService', () => ({ salesCloudShadowService: mocks.salesShadow }));

import { useAppStore } from '../../../store/useAppStore';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { actorRuntimeController } from '../../auth/actorRuntimeController';
import { db, STORES } from '../../db/dexie';
import { getActiveTenantRuntime } from '../../db/tenantRuntimeRouter';
import { syncMetaService } from '../syncMetaService';
import { buildSnapshotContextId, durableSnapshotService } from '../durableSnapshotService';
import { cashSyncHandler } from '../../cash/cashSyncHandler';
import { customerCreditSyncHandler } from '../../customerCredit/customerCreditSyncHandler';
import { salesCloudSyncHandler } from '../../salesCloud/salesCloudSyncHandler';

const LICENSE_KEY = 'license-key-sha256:snapshot-client-handler-test';
const LICENSE_DETAILS = {
  license_key: LICENSE_KEY,
  plan_code: 'pro',
  valid: true,
  features: {
    cloud_pos_sync: true,
    cloud_cash_sync: true,
    cloud_customer_credit_sync: true,
    cloud_sales_sync_base: true
  }
};
const SNAPSHOT_PROTOCOL = { supported: true, tenantId: 'snapshot-handler-tenant' };
const PAGE_CURSOR = { position_rank: 1, position_id: 'page-one' };
const DEVICE_STATION = 'cash_station_device_550e8400-e29b-41d4-a716-446655440000';

const page = (payload, { hasMore = false, cursor = null } = {}) => ({
  success: true,
  snapshot_contract: 'keyset_reference_v1',
  snapshot_contract_version: 1,
  snapshot_reference_change_seq: 37,
  safe_change_seq: 37,
  sync_deferred: false,
  has_more: hasMore,
  snapshot_complete: !hasMore,
  next_page_cursor: cursor,
  ...payload
});

const bindContext = (streamKey, scope) => buildSnapshotContextId({
  licenseKey: LICENSE_KEY, streamKey, scope, actorHandle: actorRuntimeController.capture()
});

const twoPageResponses = (method, payloadForPage) => {
  mocks[method.owner][method.name]
    .mockResolvedValueOnce(page(payloadForPage('first'), { hasMore: true, cursor: PAGE_CURSOR }))
    .mockResolvedValueOnce(page(payloadForPage('second')));
};

describe('snapshot client handler integration with Dexie', () => {
  beforeEach(async () => {
    await openTestTenantRuntime();
    useAppStore.setState({ licenseDetails: LICENSE_DETAILS, currentDeviceRole: 'admin' });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    actorRuntimeController.lock('snapshot_handler_test_reset');
    actorRuntimeController.beginAuthentication({ actorType: 'admin', deviceRef: 'snapshot-handler-device' });
    actorRuntimeController.grant({
      actorType: 'admin', actorId: 'snapshot-handler-admin', sessionId: 'snapshot-handler-session',
      deviceRef: 'snapshot-handler-device', permissions: ['*'],
      tenantOpaqueId: getActiveTenantRuntime().opaqueId,
      authorizationExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    for (const group of [mocks.cash, mocks.credit, mocks.sales]) {
      Object.values(group).forEach((method) => method.mockReset());
      group.negotiateSnapshotProtocol.mockResolvedValue(SNAPSHOT_PROTOCOL);
    }
    mocks.creditMigration.runInitialMigrationIfNeeded.mockReset().mockResolvedValue({ success: true });
    mocks.salesShadow.retryPendingShadowSales.mockReset().mockResolvedValue(0);
    mocks.orchestrator.registerEntitySyncHandler.mockClear();
  });

  afterEach(async () => {
    actorRuntimeController.lock('snapshot_handler_test_closed');
    useAppStore.setState({ licenseDetails: null, currentDeviceRole: 'admin' });
    await closeTestTenantRuntime();
    vi.clearAllMocks();
  });

  it('runs the sales snapshot pages, then applies the delta from the original reference', async () => {
    const sale = (id) => ({
      id, server_version: 1, sold_at: '2026-11-25T01:00:00.000Z', status: 'closed',
      source_mode: 'cloud_committed', total: '10.00', payment_method: 'cash'
    });
    twoPageResponses({ owner: 'sales', name: 'pullSalesSnapshot' }, (position) => ({
      sales: [sale(`snapshot-sale-${position}`)], items: [], payments: [],
      scope: { date_from: null, date_to: null, visibility: 'authorized' }
    }));

    const started = await salesCloudSyncHandler.onStart({ licenseDetails: LICENSE_DETAILS, licenseKey: LICENSE_KEY });
    expect(started).toMatchObject({ success: true, consistent: true, recoveryPending: true, referenceChangeSeq: 37 });
    expect(mocks.sales.pullSalesSnapshot.mock.calls.map(([request]) => [
      request.snapshotReferenceChangeSeq, request.pageCursor
    ])).toEqual([[null, null], [37, PAGE_CURSOR]]);
    expect(await db.table(STORES.SYNC_CACHE).get('cloud_sale:snapshot-sale-first')).toBeTruthy();

    mocks.sales.pullSalesChanges.mockResolvedValue({
      success: true, sales: [sale('snapshot-sale-delta')], items: [], payments: [],
      latest_change_seq: 38, has_more: false, sync_deferred: false
    });
    await expect(salesCloudSyncHandler.onEvents([], { licenseKey: LICENSE_KEY }))
      .resolves.toMatchObject({ latestChangeSeq: 38, syncDeferred: false });
    expect(mocks.sales.pullSalesChanges).toHaveBeenCalledWith(expect.objectContaining({ sinceChangeSeq: 37 }));
    expect(await db.table(STORES.SYNC_CACHE).get('cloud_sale:snapshot-sale-delta')).toBeTruthy();
    expect(await durableSnapshotService.getState({
      licenseKey: LICENSE_KEY, streamKey: 'sales', contextId: bindContext('sales', {
        visibility: 'authorized', actorKey: null, sessionId: null, dateFrom: null, dateTo: null
      })
    })).toMatchObject({ status: 'complete', referenceChangeSeq: 37, lastRecoveryChangeSeq: 38 });
    expect(await syncMetaService.getMeta('sales_cloud_base_last_change_seq', 0, { licenseKey: LICENSE_KEY })).toBe(38);

    const pageCallCount = mocks.sales.pullSalesSnapshot.mock.calls.length;
    await expect(salesCloudSyncHandler.onStart({ licenseDetails: LICENSE_DETAILS, licenseKey: LICENSE_KEY }))
      .resolves.toMatchObject({ success: true, skipped: true, alreadyComplete: true, referenceChangeSeq: 37 });
    expect(mocks.sales.pullSalesSnapshot).toHaveBeenCalledTimes(pageCallCount);
  });

  it('coalesces overlapping snapshot starts for the same durable authority and scope', async () => {
    let markPageRequested;
    let releasePage;
    const pageRequested = new Promise((resolve) => { markPageRequested = resolve; });
    const pendingPage = new Promise((resolve) => { releasePage = resolve; });
    const fetchPage = vi.fn(() => {
      markPageRequested();
      return pendingPage;
    });
    const applyPage = vi.fn(async () => ({ applied: 1, rowCount: 1 }));
    const options = {
      licenseKey: LICENSE_KEY,
      streamKey: 'catalog_concurrency_test',
      contextId: bindContext('catalog_concurrency_test', { scope: 'catalog' }),
      fetchPage,
      applyPage,
      advanceCursor: false
    };

    const first = durableSnapshotService.runConsistentSnapshot(options);
    const overlapping = durableSnapshotService.runConsistentSnapshot(options);
    await pageRequested;
    expect(fetchPage).toHaveBeenCalledOnce();

    releasePage(page({ products: [{ id: 'concurrent-page' }] }));
    const [firstResult, overlappingResult] = await Promise.all([first, overlapping]);

    expect(firstResult).toMatchObject({ success: true, snapshotComplete: true, recoveryPending: true, pages: 1 });
    expect(overlappingResult).toEqual(firstResult);
    expect(applyPage).toHaveBeenCalledOnce();
  });

  it('resumes the durable page after rate limiting without advancing an incomplete reference', async () => {
    const contextId = bindContext('snapshot_rate_limit_test', { scope: 'customer_directory' });
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page({ customers: [{ id: 'rate-limit-page-one' }] }, {
        hasMore: true, cursor: PAGE_CURSOR
      }))
      .mockResolvedValueOnce({ success: false, code: 'RPC_RATE_LIMITED', retryable: true, retry_after_seconds: 60 });
    const applyPage = vi.fn(async () => ({ applied: 1, rowCount: 1 }));
    const options = {
      licenseKey: LICENSE_KEY,
      streamKey: 'snapshot_rate_limit_test',
      contextId,
      cursorKey: 'snapshot_rate_limit_test_last_seq',
      fetchPage,
      applyPage
    };

    await expect(durableSnapshotService.runConsistentSnapshot(options))
      .rejects.toMatchObject({ code: 'RPC_RATE_LIMITED', retryable: true, retryAfterSeconds: 60 });
    expect(await durableSnapshotService.getState(options)).toMatchObject({
      status: 'in_progress', referenceChangeSeq: 37, pageCursor: PAGE_CURSOR, pages: 1
    });
    expect(await syncMetaService.getMeta(options.cursorKey, 0, { licenseKey: LICENSE_KEY })).toBe(0);

    const resumePage = vi.fn(async ({ referenceChangeSeq, pageCursor }) => {
      expect(referenceChangeSeq).toBe(37);
      expect(pageCursor).toEqual(PAGE_CURSOR);
      return page({ customers: [{ id: 'rate-limit-page-two' }] });
    });
    const resumed = await durableSnapshotService.runConsistentSnapshot({ ...options, fetchPage: resumePage });

    expect(resumed).toMatchObject({ success: true, snapshotComplete: true, recoveryPending: true, pages: 2 });
    expect(resumePage).toHaveBeenCalledWith({ referenceChangeSeq: 37, pageCursor: PAGE_CURSOR, firstPage: false });
    expect(await durableSnapshotService.getState(options)).toMatchObject({ status: 'recovery_pending', pages: 2 });
    expect(await syncMetaService.getMeta(options.cursorKey, 0, { licenseKey: LICENSE_KEY })).toBe(37);
  });

  it('applies cash pages and recovers their delta under the authorized all-scope cursor', async () => {
    const session = (id) => ({
      id, status: 'open', actor_key: 'admin:snapshot-handler-admin', cash_station_id: DEVICE_STATION,
      server_version: 1, opened_at: '2026-11-25T01:00:00.000Z', opening_amount: '20.00'
    });
    twoPageResponses({ owner: 'cash', name: 'pullCashSnapshot' }, (position) => ({
      cash_sessions: [session(`snapshot-cash-${position}`)], movements: [], scope: 'all'
    }));

    const started = await cashSyncHandler.onStart({ licenseDetails: LICENSE_DETAILS, licenseKey: LICENSE_KEY });
    expect(started).toMatchObject({ success: true, consistent: true, recoveryPending: true, referenceChangeSeq: 37 });
    expect(mocks.cash.pullCashSnapshot.mock.calls.map(([request]) => [
      request.scope, request.snapshotReferenceChangeSeq, request.pageCursor
    ])).toEqual([['all', null, null], ['all', 37, PAGE_CURSOR]]);
    expect(await db.table(STORES.CAJAS).get('snapshot-cash-first')).toMatchObject({ cash_session_id: 'snapshot-cash-first' });

    mocks.cash.pullCashChanges.mockResolvedValue({
      success: true, cash_sessions: [session('snapshot-cash-delta')], movements: [],
      latest_change_seq: 38, has_more: false, sync_deferred: false
    });
    await expect(cashSyncHandler.onEvents([], { licenseKey: LICENSE_KEY }))
      .resolves.toMatchObject({ latestChangeSeq: 38, syncDeferred: false });
    expect(mocks.cash.pullCashChanges).toHaveBeenCalledWith(expect.objectContaining({ sinceChangeSeq: 37 }));
    expect(await db.table(STORES.CAJAS).get('snapshot-cash-delta')).toMatchObject({ cash_session_id: 'snapshot-cash-delta' });
    expect(await durableSnapshotService.getState({
      licenseKey: LICENSE_KEY, streamKey: 'cash_register', contextId: bindContext('cash_register', { cashScope: 'all' })
    })).toMatchObject({ status: 'complete', referenceChangeSeq: 37, lastRecoveryChangeSeq: 38 });
    expect(await syncMetaService.getMeta('cash_last_change_seq', 0, { licenseKey: LICENSE_KEY })).toBe(38);
  });

  it('completes a V2 credit ledger snapshot only after its reconciled delta', async () => {
    const creditCustomer = (id, phone) => ({
      id, name: `Cliente ${id}`, phone, phone_key: phone, address: '', debt: 0, debt_cents: 0,
      credit_limit: 100, server_version: 1, created_at: '2026-11-25T01:00:00.000Z',
      updated_at: '2026-11-25T01:00:00.000Z'
    });
    const creditPage = (customer) => ({
      customer_id: null, customers: customer ? [customer] : [], ledger_entries: [], cash_movements: [], cash_sessions: [],
      ledger_reconciliation_complete: false
    });
    mocks.credit.pullCreditSnapshot
      .mockResolvedValueOnce(page(creditPage(creditCustomer('credit-snapshot-first', '5551234571')),
        { hasMore: true, cursor: PAGE_CURSOR }))
      .mockResolvedValueOnce(page({ ...creditPage(creditCustomer('credit-snapshot-second', '5551234572')),
        ledger_reconciliation_complete: true }));

    const started = await customerCreditSyncHandler.onStart({
      licenseDetails: LICENSE_DETAILS, licenseKey: LICENSE_KEY, force: true
    });
    expect(started).toMatchObject({ success: true, consistent: true, recoveryPending: true, referenceChangeSeq: 37 });
    expect(mocks.credit.pullCreditSnapshot.mock.calls.map(([request]) => [
      request.customerId, request.snapshotReferenceChangeSeq, request.pageCursor
    ])).toEqual([[null, null, null], [null, 37, PAGE_CURSOR]]);
    expect(await db.table(STORES.CUSTOMERS).count()).toBe(2);
    expect(await syncMetaService.getMeta('customer_credit_last_change_seq', 0, { licenseKey: LICENSE_KEY })).toBe(37);

    mocks.credit.pullCreditChanges.mockResolvedValue({
      success: true, customers: [], ledger_entries: [], cash_movements: [], cash_sessions: [],
      latest_change_seq: 38, has_more: false, sync_deferred: false
    });
    await expect(customerCreditSyncHandler.onEvents([], { licenseKey: LICENSE_KEY }))
      .resolves.toMatchObject({ latestChangeSeq: 38, syncDeferred: false });
    expect(mocks.credit.pullCreditChanges).toHaveBeenCalledWith(expect.objectContaining({ sinceChangeSeq: 37 }));
    expect(await durableSnapshotService.getState({
      licenseKey: LICENSE_KEY, streamKey: 'customer_credit', contextId: bindContext('customer_credit', {
        customerId: null, ledgerReconciliation: true
      })
    })).toMatchObject({ status: 'complete', referenceChangeSeq: 37, lastRecoveryChangeSeq: 38 });
    expect(await syncMetaService.getMeta('customer_credit_last_change_seq', 0, { licenseKey: LICENSE_KEY })).toBe(38);
  });
});
