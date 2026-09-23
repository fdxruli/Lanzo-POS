import Dexie from 'dexie';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tenantStorage = vi.hoisted(() => ({
  tenant: 'tenant-a',
  values: new Map()
}));

vi.mock('../tenant/tenantScopedStorage', () => ({
  getTenantStorageItem: vi.fn((key) => (
    tenantStorage.values.get(`${tenantStorage.tenant}:${key}`) ?? null
  )),
  setTenantStorageItem: vi.fn((key, value) => {
    tenantStorage.values.set(`${tenantStorage.tenant}:${key}`, value);
  })
}));

vi.mock('../inventoryOperationalAlerts', async () => {
  const actual = await vi.importActual('../inventoryOperationalAlerts');
  return {
    ...actual,
    buildInventoryOperationalAlerts: vi.fn(actual.buildInventoryOperationalAlerts)
  };
});

import { buildInventoryOperationalAlerts } from '../inventoryOperationalAlerts';
import {
  deriveLocalInventoryOperationalCounts,
  getLocalInventoryOperationalAlertsSnapshot,
  getLocalInventoryOperationalIncidentId,
  getLocalInventoryOperationalMaterialFingerprint,
  LOCAL_INVENTORY_OPERATIONAL_SEEN_KEY,
  markCurrentLocalInventoryOperationalAlertsSeen,
  markLocalInventoryOperationalAlertsSeenInState,
  queryLocalInventoryOperationalSnapshot,
  reconcileLocalInventoryOperationalSeenState,
  refreshLocalInventoryOperationalAlertsSnapshot,
  resetLocalInventoryOperationalAlertsRuntime
} from '../localInventoryOperationalAlerts';

const NOW = new Date(2026, 8, 22, 12, 0, 0);

const product = (id, overrides = {}) => ({
  id,
  name: id,
  stock: 20,
  committedStock: 0,
  minStock: 5,
  trackStock: true,
  isActive: true,
  ...overrides
});

const batch = (id, productId, alertTargetDate, overrides = {}) => ({
  id,
  productId,
  stock: 3,
  committedStock: 0,
  isActive: true,
  activeStockStatus: 1,
  alertTargetDate,
  ...overrides
});

const identify = (alert) => {
  const incidentId = getLocalInventoryOperationalIncidentId(alert);
  return {
    ...alert,
    incidentId,
    materialFingerprint: getLocalInventoryOperationalMaterialFingerprint({
      ...alert,
      incidentId
    })
  };
};

const readySnapshot = (alerts = []) => ({
  catalogSize: alerts.length,
  alerts,
  ...deriveLocalInventoryOperationalCounts(alerts),
  unseenCount: alerts.length,
  status: 'ready',
  loading: false,
  error: null,
  updatedAt: NOW.toISOString()
});

describe('local inventory operational snapshot', () => {
  let database;

  beforeEach(async () => {
    vi.clearAllMocks();
    tenantStorage.tenant = 'tenant-a';
    tenantStorage.values.clear();
    resetLocalInventoryOperationalAlertsRuntime();

    database = new Dexie(`local-inventory-alerts-${crypto.randomUUID()}`, {
      indexedDB,
      IDBKeyRange
    });
    database.version(1).stores({
      menu: 'id, lowStockAlertStatus',
      product_batches: 'id, productId, [activeStockStatus+alertTargetDate]'
    });
    await database.open();
  });

  afterEach(async () => {
    resetLocalInventoryOperationalAlertsRuntime();
    await database.delete();
  });

  it('delegates the classification to buildInventoryOperationalAlerts and returns complete counts', async () => {
    await database.table('menu').bulkAdd([
      product('out', { stock: 0 }),
      product('low-a', { stock: 1 }),
      product('low-b', { stock: 2 }),
      product('low-c', { stock: 3 }),
      product('expired-parent'),
      product('expiring-parent')
    ]);
    await database.table('product_batches').bulkAdd([
      batch('expired-batch', 'expired-parent', '2026-09-21'),
      batch('expiring-batch', 'expiring-parent', '2026-09-23')
    ]);

    const snapshot = await queryLocalInventoryOperationalSnapshot({
      database,
      now: NOW
    });

    expect(buildInventoryOperationalAlerts).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      catalogSize: 6,
      activeCount: 6,
      outOfStockCount: 1,
      lowStockCount: 3,
      expiredCount: 1,
      expiringCount: 1,
      criticalCount: 2,
      warningCount: 4
    });
    expect(snapshot.alerts.map((alert) => alert.type)).toEqual([
      'expired',
      'out_of_stock',
      'low_stock',
      'low_stock',
      'low_stock',
      'expiring'
    ]);
  });

  it('keeps today as expiring critical from the Phase 1 SSOT', async () => {
    await database.table('menu').add(product('today-parent'));
    await database.table('product_batches').add(
      batch('today-batch', 'today-parent', '2026-09-22')
    );

    const snapshot = await queryLocalInventoryOperationalSnapshot({
      database,
      now: NOW
    });

    expect(snapshot.alerts).toEqual([
      expect.objectContaining({
        type: 'expiring',
        severity: 'critical',
        expiresToday: true
      })
    ]);
    expect(snapshot.criticalCount).toBe(1);
    expect(snapshot.warningCount).toBe(0);
  });

  it('returns an empty snapshot when no operational incident exists', async () => {
    await database.table('menu').add(product('healthy'));

    const snapshot = await queryLocalInventoryOperationalSnapshot({
      database,
      now: NOW
    });

    expect(snapshot.activeCount).toBe(0);
    expect(snapshot.alerts).toEqual([]);
    expect(snapshot.criticalCount).toBe(0);
    expect(snapshot.warningCount).toBe(0);
  });

  it('derives counts only from canonical type and severity fields', () => {
    const alerts = [
      { type: 'out_of_stock', severity: 'critical', stock: 999, minStock: 0 },
      { type: 'low_stock', severity: 'warning', stock: 999, minStock: 0 },
      { type: 'expired', severity: 'critical', daysUntilExpiry: 999 },
      { type: 'expiring', severity: 'warning', daysUntilExpiry: -999 }
    ];

    expect(deriveLocalInventoryOperationalCounts(alerts)).toEqual({
      activeCount: 4,
      criticalCount: 2,
      warningCount: 2,
      outOfStockCount: 1,
      lowStockCount: 1,
      expiredCount: 1,
      expiringCount: 1
    });
  });
});

describe('local seen/dedup semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantStorage.tenant = 'tenant-a';
    tenantStorage.values.clear();
    resetLocalInventoryOperationalAlertsRuntime();
  });

  afterEach(() => resetLocalInventoryOperationalAlertsRuntime());

  it('keeps repeated low stock as one stable incident and non-material quantity changes stay seen', () => {
    const first = identify({
      productId: 'p1',
      productName: 'P1',
      type: 'low_stock',
      severity: 'warning',
      availableStock: 7,
      minStock: 10
    });
    const seen = markLocalInventoryOperationalAlertsSeenInState([first], undefined, '2026-09-22T10:00:00.000Z');

    const repeated = identify({
      ...first,
      availableStock: 6
    });
    const reconciled = reconcileLocalInventoryOperationalSeenState([repeated], seen);

    expect(repeated.incidentId).toBe('inventory-stock:p1');
    expect(reconciled.alerts).toHaveLength(1);
    expect(reconciled.alerts[0].isSeen).toBe(true);
    expect(reconciled.unseenCount).toBe(0);
  });

  it('keeps repeated expiry as one stable incident and 5 to 4 days does not become new', () => {
    const first = identify({
      productId: 'p1',
      batchId: 'b1',
      productName: 'P1',
      type: 'expiring',
      severity: 'warning',
      expiryDate: '2026-09-27',
      daysUntilExpiry: 5
    });
    const seen = markLocalInventoryOperationalAlertsSeenInState([first]);

    const next = identify({ ...first, daysUntilExpiry: 4 });
    const reconciled = reconcileLocalInventoryOperationalSeenState([next], seen);

    expect(next.incidentId).toBe('inventory-expiry:b1');
    expect(reconciled.alerts[0].isSeen).toBe(true);
  });

  it('marks low_stock to out_of_stock as unseen material escalation', () => {
    const low = identify({
      productId: 'p1',
      type: 'low_stock',
      severity: 'warning'
    });
    const seen = markLocalInventoryOperationalAlertsSeenInState([low]);
    const out = identify({
      productId: 'p1',
      type: 'out_of_stock',
      severity: 'critical'
    });

    expect(reconcileLocalInventoryOperationalSeenState([out], seen).alerts[0].isSeen)
      .toBe(false);
  });

  it('marks expiring warning to critical as unseen material escalation', () => {
    const warning = identify({
      productId: 'p1',
      batchId: 'b1',
      type: 'expiring',
      severity: 'warning',
      expiryDate: '2026-09-22'
    });
    const seen = markLocalInventoryOperationalAlertsSeenInState([warning]);
    const critical = identify({ ...warning, severity: 'critical', expiresToday: true });

    expect(reconcileLocalInventoryOperationalSeenState([critical], seen).alerts[0].isSeen)
      .toBe(false);
  });

  it('marks expiring to expired as unseen material escalation', () => {
    const expiring = identify({
      productId: 'p1',
      batchId: 'b1',
      type: 'expiring',
      severity: 'warning',
      expiryDate: '2026-09-22'
    });
    const seen = markLocalInventoryOperationalAlertsSeenInState([expiring]);
    const expired = identify({
      ...expiring,
      type: 'expired',
      severity: 'critical'
    });

    expect(reconcileLocalInventoryOperationalSeenState([expired], seen).alerts[0].isSeen)
      .toBe(false);
  });

  it('prunes resolved metadata so a later reappearance is new', () => {
    const alert = identify({
      productId: 'p1',
      type: 'out_of_stock',
      severity: 'critical'
    });
    const seen = markLocalInventoryOperationalAlertsSeenInState([alert]);
    const resolved = reconcileLocalInventoryOperationalSeenState([], seen);

    expect(resolved.seenState.incidents).toEqual({});

    const reappeared = reconcileLocalInventoryOperationalSeenState(
      [alert],
      resolved.seenState
    );
    expect(reappeared.alerts[0].isSeen).toBe(false);
    expect(reappeared.unseenCount).toBe(1);
  });

  it('opening/marking seen does not change the active snapshot count', async () => {
    const alert = identify({
      productId: 'p1',
      type: 'out_of_stock',
      severity: 'critical'
    });

    await refreshLocalInventoryOperationalAlertsSnapshot({
      querySnapshot: vi.fn(async () => readySnapshot([alert]))
    });
    expect(getLocalInventoryOperationalAlertsSnapshot().activeCount).toBe(1);

    markCurrentLocalInventoryOperationalAlertsSeen();

    expect(getLocalInventoryOperationalAlertsSnapshot()).toMatchObject({
      activeCount: 1,
      unseenCount: 0
    });
    expect(getLocalInventoryOperationalAlertsSnapshot().alerts[0].isSeen).toBe(true);
  });

  it('keeps local seen metadata tenant-scoped', async () => {
    const alert = identify({
      productId: 'p1',
      type: 'out_of_stock',
      severity: 'critical'
    });
    const querySnapshot = vi.fn(async () => readySnapshot([alert]));

    tenantStorage.tenant = 'tenant-a';
    await refreshLocalInventoryOperationalAlertsSnapshot({ querySnapshot });
    markCurrentLocalInventoryOperationalAlertsSeen();
    expect(getLocalInventoryOperationalAlertsSnapshot().alerts[0].isSeen).toBe(true);

    resetLocalInventoryOperationalAlertsRuntime();
    tenantStorage.tenant = 'tenant-b';
    await refreshLocalInventoryOperationalAlertsSnapshot({ querySnapshot });
    expect(getLocalInventoryOperationalAlertsSnapshot().alerts[0].isSeen).toBe(false);

    expect(tenantStorage.values.has(`tenant-a:${LOCAL_INVENTORY_OPERATIONAL_SEEN_KEY}`))
      .toBe(true);
    expect(tenantStorage.values.has(`tenant-b:${LOCAL_INVENTORY_OPERATIONAL_SEEN_KEY}`))
      .toBe(false);
  });
});

describe('shared runtime request protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantStorage.tenant = 'tenant-a';
    tenantStorage.values.clear();
    resetLocalInventoryOperationalAlertsRuntime();
  });

  afterEach(() => resetLocalInventoryOperationalAlertsRuntime());

  it('deduplicates concurrent refresh requests into one scan', async () => {
    let resolveQuery;
    const querySnapshot = vi.fn(() => new Promise((resolve) => {
      resolveQuery = resolve;
    }));

    const first = refreshLocalInventoryOperationalAlertsSnapshot({ querySnapshot });
    const second = refreshLocalInventoryOperationalAlertsSnapshot({ querySnapshot });

    expect(first).toBe(second);
    expect(querySnapshot).toHaveBeenCalledTimes(1);

    resolveQuery(readySnapshot([]));
    await first;

    expect(getLocalInventoryOperationalAlertsSnapshot().status).toBe('ready');
  });

  it('does not publish a stale scan after runtime reset/tenant handoff', async () => {
    let resolveOld;
    const oldQuery = vi.fn(() => new Promise((resolve) => {
      resolveOld = resolve;
    }));

    const oldRequest = refreshLocalInventoryOperationalAlertsSnapshot({
      querySnapshot: oldQuery
    });

    resetLocalInventoryOperationalAlertsRuntime();

    const freshAlert = identify({
      productId: 'fresh',
      type: 'out_of_stock',
      severity: 'critical'
    });
    await refreshLocalInventoryOperationalAlertsSnapshot({
      querySnapshot: vi.fn(async () => readySnapshot([freshAlert]))
    });

    resolveOld(readySnapshot([]));
    await oldRequest;

    expect(getLocalInventoryOperationalAlertsSnapshot().alerts).toEqual([
      expect.objectContaining({ productId: 'fresh' })
    ]);
  });
});
