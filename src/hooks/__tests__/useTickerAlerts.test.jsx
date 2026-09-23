// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapshots = vi.hoisted(() => ({
  inventory: { catalogSize: 0, alerts: [] },
  ecommerce: null
}));

vi.mock('../useInventoryOperationalAlertsSnapshot', () => ({
  useInventoryOperationalAlertsSnapshot: () => snapshots.inventory
}));

vi.mock('../useEcommercePublishedStockAlerts', () => ({
  useEcommercePublishedStockAlerts: () => ({ snapshot: snapshots.ecommerce })
}));

import { useTickerAlerts } from '../useTickerAlerts';

describe('useTickerAlerts shared snapshot consumer', () => {
  beforeEach(() => {
    snapshots.inventory = { catalogSize: 0, alerts: [] };
    snapshots.ecommerce = null;
  });

  it('consumes the complete shared inventory snapshot without owning a scan', () => {
    snapshots.inventory = {
      catalogSize: 12,
      alerts: Array.from({ length: 10 }, (_, index) => ({
        incidentId: `inventory-stock:p${index}`,
        productId: `p${index}`,
        productName: `P${index}`,
        type: 'low_stock',
        severity: 'warning',
        availableStock: 2,
        minStock: 5
      }))
    };

    const { result } = renderHook(() => useTickerAlerts(true));

    expect(result.current.catalogSize).toBe(12);
    expect(result.current.alerts).toHaveLength(10);
    expect(result.current.alerts.every((alert) => alert.type === 'low-stock')).toBe(true);
  });

  it('stays empty when the local ticker consumer is disabled', () => {
    snapshots.inventory = {
      catalogSize: 2,
      alerts: [{
        productId: 'p1',
        productName: 'P1',
        type: 'out_of_stock',
        severity: 'critical'
      }]
    };

    const { result } = renderHook(() => useTickerAlerts(false));

    expect(result.current).toEqual({ catalogSize: 0, alerts: [] });
  });
});
