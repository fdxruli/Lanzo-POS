import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getInventoryOperationalState,
  resolveOperationalMinStock
} from '../inventoryOperationalAlerts';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260923162227_inventory_operational_alerts_phase4_cloud_generation_r1.sql',
    import.meta.url
  ),
  'utf8'
).replace(/\r\n/gu, '\n');
const archivedBatchParityMigration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260923163414_inventory_operational_alerts_phase4_archived_batch_parity_r1.sql',
    import.meta.url
  ),
  'utf8'
).replace(/\r\n/gu, '\n');

const now = new Date(2026, 8, 23, 12, 0, 0);

const product = (overrides = {}) => ({
  id: 'p1',
  name: 'Producto',
  stock: 10,
  committedStock: 0,
  minStock: 5,
  trackStock: true,
  isActive: true,
  ...overrides
});

const batch = (overrides = {}) => ({
  id: 'b1',
  productId: 'p1',
  stock: 1,
  committedStock: 0,
  isActive: true,
  activeStockStatus: 1,
  ...overrides
});

describe('Phase 1 / Phase 4 inventory operational parity contract', () => {
  it('keeps the stock boundaries used by the JavaScript SSOT', () => {
    expect(getInventoryOperationalState({
      product: product({ stock: 5, minStock: 5 }),
      now
    }).stock).toMatchObject({
      type: 'low_stock',
      severity: 'warning',
      availableStock: 5,
      minStock: 5
    });

    expect(getInventoryOperationalState({
      product: product({ stock: 5, committedStock: 5 }),
      now
    }).stock).toMatchObject({
      type: 'out_of_stock',
      severity: 'critical',
      availableStock: 0
    });

    expect(resolveOperationalMinStock(product({ minStock: 0 }))).toMatchObject({
      valid: true,
      value: 0,
      source: 'configured'
    });
    expect(resolveOperationalMinStock(product({ minStock: null }))).toMatchObject({
      valid: true,
      value: 5,
      source: 'legacy_fallback'
    });
    expect(resolveOperationalMinStock(product({ minStock: -1 }))).toMatchObject({
      valid: false,
      value: null,
      source: 'invalid'
    });
  });

  it('keeps expiry day-calendar semantics and the seven-day boundary', () => {
    expect(getInventoryOperationalState({
      product: product(),
      batch: batch({ alertTargetDate: '2026-09-30T00:00:00.000Z' }),
      now
    }).expiry).toMatchObject({
      type: 'expiring',
      severity: 'warning',
      daysUntilExpiry: 7,
      expiresToday: false
    });

    expect(getInventoryOperationalState({
      product: product(),
      batch: batch({ alertTargetDate: '2026-09-23T00:00:00.000Z' }),
      now
    }).expiry).toMatchObject({
      type: 'expiring',
      severity: 'critical',
      daysUntilExpiry: 0,
      expiresToday: true
    });

    expect(getInventoryOperationalState({
      product: product(),
      batch: batch({
        alertTargetDate: '2026-09-24T00:00:00.000Z',
        expiryDate: '2026-09-01T00:00:00.000Z'
      }),
      now
    }).expiry).toMatchObject({
      type: 'expiring',
      severity: 'warning',
      daysUntilExpiry: 1
    });
  });

  it('projects the same boundaries into SQL instead of creating a third contract', () => {
    expect(migration).toMatch(/p\.stock - p\.committed_stock/u);
    expect(migration).toMatch(/p\.available_stock <= 0/u);
    expect(migration).toMatch(/p\.available_stock <= p\.operational_min_stock/u);
    expect(migration).toMatch(/when p\.min_stock is null then 5::numeric/u);
    expect(migration).toMatch(/when p\.min_stock < 0 then null/u);
    expect(migration).toMatch(/coalesce\(b\.alert_target_date, b\.expiry_date\)/u);
    expect(migration).toMatch(/at time zone 'UTC'/u);
    expect(migration).toMatch(/e\.expiry_date <= p_business_date \+ 7/u);
    expect(migration).toMatch(/when e\.expiry_date < p_business_date then 'expired'/u);
    expect(migration).toMatch(/when e\.expiry_date = p_business_date then 'inventory_expiring_critical'/u);
    expect(archivedBatchParityMigration)
      .toMatch(/not in \('inactive', 'archived'\)/u);
  });

  it('reuses the existing incident, notification, entitlement and realtime infrastructure', () => {
    expect(migration).toMatch(/private\.license_entitlement_state_v1\(p_license_id\)/u);
    expect(migration).toMatch(/private\.set_pos_operational_incident_state\(/u);
    expect(migration).toMatch(/private\.create_pos_notification_once\(/u);
    expect(migration).toMatch(/private\.broadcast_notification_event\(/u);
    expect(migration).toMatch(/p_event_key => 'inventory:' \|\| v_incident_id::text/u);
    expect(migration).toMatch(/p_type => 'inventory'/u);
    expect(migration).toMatch(/p_source => 'system'/u);
    expect(migration).toMatch(/'category', 'inventory'/u);
    expect(migration).not.toMatch(/create table .*inventory_(?:notifications|alerts|notification_reads)/iu);
    expect(migration).not.toMatch(/cron\.schedule/u);
  });

  it('fails expiry date authority safely for missing/invalid client dates', () => {
    expect(migration).toMatch(/validate_inventory_operational_business_date_v1/u);
    expect(migration).toMatch(/abs\(v_date - v_utc_date\) > 1/u);
    expect(migration).toMatch(/if p_business_date is not null then/u);
    expect(migration).toMatch(/Missing or[\s\S]*expiry state is untouched/u);
  });
});
