import { describe, expect, it } from 'vitest';
import { getCloudInventoryNotificationNavigationRoute } from '../inventoryNotificationNavigation';

const inventory = (classification) => ({
  type: 'inventory',
  metadata: { classification }
});

describe('cloud inventory notification navigation', () => {
  it.each([
    ['low_stock', '/ventas?tab=restock'],
    ['out_of_stock', '/ventas?tab=restock'],
    ['expired', '/ventas?tab=expiration'],
    ['expiring', '/ventas?tab=expiration']
  ])('routes %s to the authorized reports destination', (classification, expected) => {
    expect(getCloudInventoryNotificationNavigationRoute(
      inventory(classification),
      { canReadReports: true, canReadProducts: true }
    )).toBe(expected);
  });

  it('falls back to Products for Staff without reports but with product/inventory access', () => {
    expect(getCloudInventoryNotificationNavigationRoute(
      inventory('out_of_stock'),
      { canReadReports: false, canReadProducts: true }
    )).toBe('/productos');
  });

  it('returns no route when the actor has no authorized inventory destination', () => {
    expect(getCloudInventoryNotificationNavigationRoute(
      inventory('expired'),
      { canReadReports: false, canReadProducts: false }
    )).toBeNull();
  });

  it('never applies inventory routing to another notification type', () => {
    expect(getCloudInventoryNotificationNavigationRoute(
      { type: 'cash', metadata: { classification: 'out_of_stock' } },
      { canReadReports: true, canReadProducts: true }
    )).toBeNull();
  });
});
