import Dexie from 'dexie';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTickerInventoryNavigationRoute,
  mapInventoryOperationalAlertsForTicker,
  queryTickerInventoryAlerts,
  selectLocalTickerAlerts
} from '../tickerAlerts';

describe('queryTickerInventoryAlerts', () => {
  let testDb;

  beforeEach(async () => {
    testDb = new Dexie(`ticker-alerts-${crypto.randomUUID()}`, {
      indexedDB,
      IDBKeyRange
    });
    testDb.version(1).stores({
      menu: 'id, lowStockAlertStatus',
      product_batches: 'id, productId, [activeStockStatus+alertTargetDate]'
    });
    await testDb.open();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testDb.delete();
  });

  it('materializa stock bajo y próximos a vencer desde candidatos locales', async () => {
    await testDb.table('menu').bulkAdd([
      {
        id: 'low',
        name: 'Leche',
        stock: 4,
        committedStock: 0,
        minStock: 5,
        trackStock: true,
        isActive: true,
        lowStockAlertStatus: 1
      },
      {
        id: 'healthy',
        name: 'Cafe',
        stock: 20,
        committedStock: 0,
        minStock: 5,
        trackStock: true,
        isActive: true,
        lowStockAlertStatus: 0
      },
      {
        id: 'expiring',
        name: 'Yogur',
        stock: 10,
        committedStock: 0,
        minStock: 5,
        trackStock: true,
        isActive: true,
        lowStockAlertStatus: 0
      }
    ]);
    await testDb.table('product_batches').add({
      id: 'batch-expiring',
      productId: 'expiring',
      stock: 3,
      committedStock: 0,
      isActive: true,
      activeStockStatus: 1,
      alertTargetDate: '2026-06-13T12:00:00.000Z'
    });

    const batchWhere = vi.spyOn(testDb.table('product_batches'), 'where');
    const result = await queryTickerInventoryAlerts({
      database: testDb,
      now: new Date(2026, 5, 11, 12, 0, 0),
      limit: 8
    });

    expect(result.catalogSize).toBe(3);
    expect(result.alerts.map(alert => alert.id)).toEqual([
      'stock-low',
      'expiry-batch-expiring'
    ]);
    expect(result.alerts[0]).toMatchObject({
      type: 'low-stock',
      availableStock: 4,
      minStock: 5
    });
    expect(result.alerts[1]).toMatchObject({
      type: 'expiry',
      expiryDays: 2
    });
    expect(batchWhere).toHaveBeenCalledWith(
      '[activeStockStatus+alertTargetDate]'
    );
  });

  it('aplica el limite del ticker después de construir el snapshot operacional completo', async () => {
    await testDb.table('menu').bulkAdd(
      Array.from({ length: 10 }, (_, index) => ({
        id: `low-${index}`,
        name: `Low ${index}`,
        stock: 1,
        committedStock: 0,
        minStock: 5,
        trackStock: true,
        isActive: true,
        lowStockAlertStatus: 1
      }))
    );

    const result = await queryTickerInventoryAlerts({
      database: testDb,
      now: new Date(2026, 5, 11, 12, 0, 0),
      limit: 8
    });

    expect(result.catalogSize).toBe(10);
    expect(result.alerts).toHaveLength(8);
  });

  it('mantiene agotados y lotes ya vencidos visibles con prioridad crítica', async () => {
    await testDb.table('menu').bulkAdd([
      {
        id: 'out',
        name: 'Agotado',
        stock: 2,
        committedStock: 3,
        minStock: 5,
        trackStock: true,
        isActive: true,
        lowStockAlertStatus: 0
      },
      {
        id: 'expired-parent',
        name: 'Caducado',
        stock: 10,
        committedStock: 0,
        minStock: 5,
        trackStock: true,
        isActive: true,
        lowStockAlertStatus: 0
      }
    ]);
    await testDb.table('product_batches').add({
      id: 'batch-expired',
      productId: 'expired-parent',
      stock: 2,
      committedStock: 0,
      isActive: true,
      activeStockStatus: 1,
      alertTargetDate: '2026-06-10T00:00:00.000Z'
    });

    const result = await queryTickerInventoryAlerts({
      database: testDb,
      now: new Date(2026, 5, 11, 12, 0, 0),
      limit: 8
    });

    expect(result.alerts).toEqual([
      expect.objectContaining({
        id: 'expiry-batch-expired',
        type: 'expired',
        urgency: 0,
        expiryDays: -1
      }),
      expect.objectContaining({
        id: 'stock-out',
        type: 'out-of-stock',
        urgency: 0,
        availableStock: -1
      })
    ]);
  });
});


describe('ticker operational priority hardening', () => {
  const canonicalDomainAlerts = () => ([
    {
      incidentId: 'inventory-expiry:expired',
      type: 'expired',
      severity: 'critical',
      productId: 'p-expired',
      productName: 'Vencido',
      batchId: 'expired',
      daysUntilExpiry: -1
    },
    {
      incidentId: 'inventory-stock:out',
      type: 'out_of_stock',
      severity: 'critical',
      productId: 'out',
      productName: 'Agotado',
      availableStock: 0,
      minStock: 5
    },
    {
      incidentId: 'inventory-expiry:today',
      type: 'expiring',
      severity: 'critical',
      productId: 'p-today',
      productName: 'Vence hoy',
      batchId: 'today',
      daysUntilExpiry: 0,
      expiresToday: true
    },
    {
      incidentId: 'inventory-stock:low',
      type: 'low_stock',
      severity: 'warning',
      productId: 'low',
      productName: 'Stock bajo',
      availableStock: 2,
      minStock: 5
    },
    {
      incidentId: 'inventory-expiry:soon',
      type: 'expiring',
      severity: 'warning',
      productId: 'p-soon',
      productName: 'Próximo',
      batchId: 'soon',
      daysUntilExpiry: 3,
      expiresToday: false
    }
  ]);

  it('preserves the SSOT order and derives ticker urgency only from canonical severity', () => {
    const mapped = mapInventoryOperationalAlertsForTicker(canonicalDomainAlerts());

    expect(mapped.map((alert) => alert.incidentId)).toEqual([
      'inventory-expiry:expired',
      'inventory-stock:out',
      'inventory-expiry:today',
      'inventory-stock:low',
      'inventory-expiry:soon'
    ]);
    expect(mapped.map((alert) => alert.urgency)).toEqual([0, 0, 0, 1, 1]);
    expect(mapped[2]).toMatchObject({
      type: 'expiry',
      severity: 'critical',
      urgency: 0
    });
  });

  it('deduplicates inventory incidents without changing their first canonical position', () => {
    const alerts = canonicalDomainAlerts();
    const mapped = mapInventoryOperationalAlertsForTicker([
      alerts[0],
      alerts[1],
      { ...alerts[1] },
      alerts[2]
    ]);

    expect(mapped.map((alert) => alert.incidentId)).toEqual([
      'inventory-expiry:expired',
      'inventory-stock:out',
      'inventory-expiry:today'
    ]);
  });

  it('keeps inventory canonical order inside each urgency and uses deterministic source tie-breaks', () => {
    const inventory = mapInventoryOperationalAlertsForTicker(canonicalDomainAlerts());
    const selected = selectLocalTickerAlerts([
      {
        id: 'ecommerce-published-out-of-stock',
        source: 'ecommerce',
        type: 'ecommerce-published-out-of-stock',
        urgency: 1
      },
      inventory[4],
      {
        id: 'backup-stale',
        source: 'backup',
        urgency: 1
      },
      inventory[3],
      inventory[2],
      inventory[1],
      inventory[0]
    ], { limit: 8 });

    expect(selected.map((alert) => alert.incidentId || alert.id)).toEqual([
      'inventory-expiry:expired',
      'inventory-stock:out',
      'inventory-expiry:today',
      'inventory-stock:low',
      'inventory-expiry:soon',
      'ecommerce-published-out-of-stock',
      'backup-stale'
    ]);
  });

  it('applies the visual limit only after dedupe and priority without mutating the full input', () => {
    const full = [
      ...mapInventoryOperationalAlertsForTicker(canonicalDomainAlerts()),
      ...mapInventoryOperationalAlertsForTicker(
        Array.from({ length: 7 }, (_, index) => ({
          incidentId: `inventory-stock:extra-${index}`,
          type: 'low_stock',
          severity: 'warning',
          productId: `extra-${index}`,
          productName: `Extra ${index}`,
          availableStock: 1,
          minStock: 5
        }))
      ).map((alert, index) => ({
        ...alert,
        canonicalOrder: 5 + index
      }))
    ];
    const before = full.map((alert) => alert.incidentId);

    const selected = selectLocalTickerAlerts(full, { limit: 8 });

    expect(full.map((alert) => alert.incidentId)).toEqual(before);
    expect(full).toHaveLength(12);
    expect(selected).toHaveLength(8);
    expect(selected.slice(0, 5).map((alert) => alert.incidentId)).toEqual(
      before.slice(0, 5)
    );
  });

  it('routes stock and expiry alerts to specialized reports only with reports authority', () => {
    const mapped = mapInventoryOperationalAlertsForTicker(canonicalDomainAlerts());
    const expired = mapped.find((alert) => alert.type === 'expired');
    const outOfStock = mapped.find((alert) => alert.type === 'out-of-stock');
    const lowStock = mapped.find((alert) => alert.type === 'low-stock');
    const expiring = mapped.find((alert) => alert.type === 'expiry');

    expect(getTickerInventoryNavigationRoute(lowStock, { canReadReports: true }))
      .toBe('/ventas?tab=restock');
    expect(getTickerInventoryNavigationRoute(outOfStock, { canReadReports: true }))
      .toBe('/ventas?tab=restock');
    expect(getTickerInventoryNavigationRoute(expired, { canReadReports: true }))
      .toBe('/ventas?tab=expiration');
    expect(getTickerInventoryNavigationRoute(expiring, { canReadReports: true }))
      .toBe('/ventas?tab=expiration');
  });

  it('falls back to Products without elevating actors that cannot read reports', () => {
    const [expired] = mapInventoryOperationalAlertsForTicker([
      canonicalDomainAlerts()[0]
    ]);

    expect(getTickerInventoryNavigationRoute(expired, {
      canReadReports: false,
      canReadProducts: true
    })).toBe('/productos');

    expect(getTickerInventoryNavigationRoute(expired, {
      canReadReports: false,
      canReadProducts: false
    })).toBeNull();
  });
});
