import { describe, expect, it } from 'vitest';
import {
  buildInventoryOperationalAlerts,
  getInventoryOperationalState,
  INVENTORY_OPERATIONAL_TYPES
} from '../inventoryOperationalAlerts';
import { getLowStockAlertStatus } from '../db/utils';

const NOW = new Date(2026, 8, 22, 12, 0, 0);

const product = (overrides = {}) => ({
  id: 'product-1',
  name: 'Producto',
  stock: 20,
  committedStock: 0,
  minStock: 5,
  trackStock: true,
  isActive: true,
  ...overrides
});

const batch = (overrides = {}) => ({
  id: 'batch-1',
  productId: 'product-1',
  stock: 3,
  committedStock: 0,
  isActive: true,
  activeStockStatus: 1,
  expiryDate: '2026-09-25',
  ...overrides
});

const stockState = (overrides = {}) => (
  getInventoryOperationalState({ product: product(overrides), now: NOW }).stock
);

const expiryState = (batchOverrides = {}, productOverrides = {}) => (
  getInventoryOperationalState({
    product: product(productOverrides),
    batch: batch(batchOverrides),
    now: NOW
  }).expiry
);

describe('inventory operational stock contract', () => {
  it('classifies configured minStock=10 and available=6 as low_stock', () => {
    expect(stockState({ stock: 6, minStock: 10 })).toMatchObject({
      type: 'low_stock',
      severity: 'warning',
      availableStock: 6,
      minStock: 10,
      minStockSource: 'configured'
    });
  });

  it('keeps configured minStock=2 and available=4 healthy', () => {
    expect(stockState({ stock: 4, minStock: 2 }).type).toBe('healthy');
  });

  it('respects minStock=0 instead of replacing it with the legacy fallback', () => {
    expect(stockState({ stock: 1, minStock: 0 })).toMatchObject({
      type: 'healthy',
      minStock: 0,
      minStockSource: 'configured'
    });
  });

  it('uses legacy fallback 5 only when minStock is not configured', () => {
    expect(stockState({ stock: 4, minStock: null })).toMatchObject({
      type: 'low_stock',
      minStock: 5,
      minStockSource: 'legacy_fallback'
    });
  });

  it('defines the legacy fallback boundary as available <= 5', () => {
    expect(stockState({ stock: 5, minStock: undefined })).toMatchObject({
      type: 'low_stock',
      availableStock: 5,
      minStock: 5
    });
  });

  it('classifies available=0 as out_of_stock instead of low_stock', () => {
    expect(stockState({ stock: 0, minStock: 10 })).toMatchObject({
      type: 'out_of_stock',
      severity: 'critical',
      availableStock: 0
    });
  });

  it('preserves negative operational availability as out_of_stock', () => {
    expect(stockState({ stock: -2, committedStock: 0 })).toMatchObject({
      type: 'out_of_stock',
      availableStock: -2
    });
  });

  it('subtracts committed stock before classifying the product', () => {
    expect(stockState({ stock: 7, committedStock: 2, minStock: 5 })).toMatchObject({
      type: 'low_stock',
      physicalStock: 7,
      committedStock: 2,
      availableStock: 5
    });
  });

  it('does not alert for products that do not track stock', () => {
    const state = getInventoryOperationalState({
      product: product({ stock: 0, trackStock: false }),
      now: NOW
    });
    expect(state.alerts).toHaveLength(0);
  });

  it('does not alert for inactive products', () => {
    const state = getInventoryOperationalState({
      product: product({ stock: 0, isActive: false }),
      now: NOW
    });
    expect(state.alerts).toHaveLength(0);
    expect(state.stock.type).toBe('not_applicable');
  });

  it('marks invalid stock data as unknown instead of healthy', () => {
    const state = getInventoryOperationalState({
      product: product({ stock: 'invalid' }),
      now: NOW
    });
    expect(state.alerts).toHaveLength(0);
    expect(state.stock.type).toBe('unknown');
  });

  it('keeps the Dexie lowStockAlertStatus compatibility index exclusive to low_stock', () => {
    expect(getLowStockAlertStatus(product({ stock: 4, minStock: 5 }))).toBe(1);
    expect(getLowStockAlertStatus(product({ stock: 0, minStock: 5 }))).toBe(0);
    expect(getLowStockAlertStatus(product({ stock: 1, minStock: 0 }))).toBe(0);
  });
});

describe('inventory operational expiry contract', () => {
  it('does not alert outside the default 7-day window', () => {
    expect(expiryState({ expiryDate: '2026-09-30' }).type).toBe('none');
  });

  it('classifies exactly 7 days as expiring warning', () => {
    expect(expiryState({ expiryDate: '2026-09-29' })).toMatchObject({
      type: 'expiring',
      severity: 'warning',
      daysUntilExpiry: 7,
      expiresToday: false
    });
  });

  it('classifies tomorrow as expiring warning', () => {
    expect(expiryState({ expiryDate: '2026-09-23' })).toMatchObject({
      type: 'expiring',
      severity: 'warning',
      daysUntilExpiry: 1
    });
  });

  it('classifies today as expiring critical', () => {
    expect(expiryState({ expiryDate: '2026-09-22' })).toMatchObject({
      type: 'expiring',
      severity: 'critical',
      daysUntilExpiry: 0,
      expiresToday: true
    });
  });

  it('keeps yesterday visible as expired critical', () => {
    expect(expiryState({ expiryDate: '2026-09-21' })).toMatchObject({
      type: 'expired',
      severity: 'critical',
      daysUntilExpiry: -1
    });
  });

  it('keeps batches expired several days ago visible as expired', () => {
    expect(expiryState({ expiryDate: '2026-09-15' })).toMatchObject({
      type: 'expired',
      severity: 'critical',
      daysUntilExpiry: -7
    });
  });

  it('does not fabricate an expiry alert for an invalid date', () => {
    const state = getInventoryOperationalState({
      product: product(),
      batch: batch({ expiryDate: 'not-a-date' }),
      now: NOW
    });
    expect(state.alerts.some((alert) => (
      alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRED
      || alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRING
    ))).toBe(false);
  });

  it('ignores inactive or stockless batches explicitly', () => {
    expect(expiryState({ expiryDate: '2026-09-21', isActive: false }).type).toBe('none');
    expect(expiryState({
      expiryDate: '2026-09-21',
      stock: 0,
      activeStockStatus: 0
    }).type).toBe('none');
  });
});

describe('inventory operational collection contract', () => {
  it('uses canonical severities for all required states', () => {
    expect(stockState({ stock: 0 }).severity).toBe('critical');
    expect(stockState({ stock: 4, minStock: 5 }).severity).toBe('warning');
    expect(expiryState({ expiryDate: '2026-09-21' }).severity).toBe('critical');
    expect(expiryState({ expiryDate: '2026-09-22' }).severity).toBe('critical');
    expect(expiryState({ expiryDate: '2026-09-23' }).severity).toBe('warning');
  });

  it('is deterministic for identical inputs', () => {
    const input = {
      products: [product({ stock: 4 })],
      batches: [batch({ expiryDate: '2026-09-23' })],
      now: NOW
    };

    expect(buildInventoryOperationalAlerts(input)).toEqual(
      buildInventoryOperationalAlerts(input)
    );
  });

  it('does not mutate product or batch inputs', () => {
    const products = [product({ stock: 4, metadata: { source: 'test' } })];
    const batches = [batch({ expiryDate: '2026-09-21', notes: 'keep' })];
    const productsBefore = structuredClone(products);
    const batchesBefore = structuredClone(batches);

    buildInventoryOperationalAlerts({ products, batches, now: NOW });

    expect(products).toEqual(productsBefore);
    expect(batches).toEqual(batchesBefore);
  });

  it('does not expose sensitive product fields in alert results', () => {
    const alerts = buildInventoryOperationalAlerts({
      products: [product({
        stock: 0,
        licenseKey: 'LANZO-SECRET',
        token: 'token-secret',
        deviceFingerprint: 'fingerprint-secret'
      })],
      now: NOW
    });

    expect(alerts).toHaveLength(1);
    const serialized = JSON.stringify(alerts[0]);
    expect(serialized).not.toContain('LANZO-SECRET');
    expect(serialized).not.toContain('token-secret');
    expect(serialized).not.toContain('fingerprint-secret');
    expect(alerts[0]).not.toHaveProperty('licenseKey');
    expect(alerts[0]).not.toHaveProperty('token');
    expect(alerts[0]).not.toHaveProperty('deviceFingerprint');
  });

  it('returns a stable canonical priority order', () => {
    const products = [
      product({ id: 'expired-parent', name: 'Expired', stock: 20 }),
      product({ id: 'out', name: 'Out', stock: 0 }),
      product({ id: 'today-parent', name: 'Today', stock: 20 }),
      product({ id: 'low', name: 'Low', stock: 4 }),
      product({ id: 'future-parent', name: 'Future', stock: 20 })
    ];
    const batches = [
      batch({ id: 'expired-batch', productId: 'expired-parent', expiryDate: '2026-09-21' }),
      batch({ id: 'today-batch', productId: 'today-parent', expiryDate: '2026-09-22' }),
      batch({ id: 'future-batch', productId: 'future-parent', expiryDate: '2026-09-23' })
    ];

    const alerts = buildInventoryOperationalAlerts({ products, batches, now: NOW });

    expect(alerts.map((alert) => [
      alert.type,
      alert.expiresToday === true ? 'today' : alert.productName
    ])).toEqual([
      ['expired', 'Expired'],
      ['out_of_stock', 'Out'],
      ['expiring', 'today'],
      ['low_stock', 'Low'],
      ['expiring', 'Future']
    ]);
  });
});
