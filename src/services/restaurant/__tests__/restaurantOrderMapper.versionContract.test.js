import { describe, expect, it } from 'vitest';
import { buildRestaurantOrderPayloadFromOpenSale } from '../restaurantOrderMapper';
import { buildRestaurantOrderPayloadFromOpenSale as productionMapper } from './fixtures/productionRestaurantOrderMapper';
import { buildRestaurantOrderPayloadFromOpenSale as pr338Mapper } from './fixtures/pr338RestaurantOrderMapper';

describe('Cloud parent version in every Kitchen mapper consumer', () => {
  it.each([['Production', productionMapper], ['PR338', pr338Mapper]])('%s has no version field even when the sale carries a Cloud token', (_name, mapper) => {
    const { order } = mapper({ sale: { id: 'table-a', total: 0, items: [],
      cloudRestaurantOrderUpdatedAt: '2026-10-10T01:32:58.123456+00:00' } });
    for (const field of ['expectedParentVersion', 'interventionReason', 'createdByDeviceId', 'createdByStaffUserId', 'updatedAt', 'serverVersion']) {
      expect(Object.hasOwn(order, field)).toBe(false);
    }
    expect(order.localOrderId).toBe('table-a');
    expect(order.saleId).toBe('table-a');
  });
  it('preserves the exact server token and intervention reason', () => {
    const token = '2026-10-10T01:32:58.123456+00:00';
    const { order } = buildRestaurantOrderPayloadFromOpenSale({ sale: {
      id: 'table-a', total: 0, items: [], cloudRestaurantOrderUpdatedAt: token,
      restaurantInterventionReason: 'Corregir la mesa', updatedAt: Date.now()
    } });
    expect(order.expectedParentVersion).toBe(token);
    expect(order.interventionReason).toBe('Corregir la mesa');
    expect(order.localOrderId).toBe('table-a');
    expect(order.saleId).toBe('table-a');
  });
  it('never substitutes a device timestamp for an unknown Cloud version', () => {
    const { order } = buildRestaurantOrderPayloadFromOpenSale({ sale: {
      id: 'local-table', total: 0, items: [], updatedAt: '2026-10-10T01:00:00Z'
    } });
    expect(order.expectedParentVersion).toBeNull();
    expect(order.interventionReason).toBeNull();
  });
});
