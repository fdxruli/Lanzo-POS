import { describe, expect, it } from 'vitest';
import {
  reconcileCartWithCancelledRestaurantItems,
  isCartItemCancelledByKitchen
} from '../restaurantOrderReconciliation';

describe('restaurantOrderReconciliation', () => {
  it('removes cart lines that kitchen cancelled by local line id', () => {
    const cartItems = [
      { lineId: 'line-1', name: 'Taco', quantity: 1, price: 50 },
      { lineId: 'line-2', name: 'Agua', quantity: 1, price: 20 }
    ];
    const cloudItems = [
      { localLineId: 'line-1', productName: 'Taco', status: 'cancelled' },
      { localLineId: 'line-2', productName: 'Agua', status: 'ready' }
    ];

    const result = reconcileCartWithCancelledRestaurantItems(cartItems, cloudItems);

    expect(result.kept).toEqual([cartItems[1]]);
    expect(result.removed).toEqual([cartItems[0]]);
    expect(result.hasRemovableCancelledItems).toBe(true);
    expect(result.hasUnmatchedCancelledItems).toBe(false);
  });

  it('flags cancelled kitchen items that cannot be matched safely', () => {
    const result = reconcileCartWithCancelledRestaurantItems(
      [{ lineId: 'line-1', name: 'Taco', quantity: 1, price: 50 }],
      [{ productName: 'Taco', status: 'cancelled' }]
    );

    expect(result.kept).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
    expect(result.hasUnmatchedCancelledItems).toBe(true);
  });

  it('treats cancelled kitchen items with a missing cart line as already removed', () => {
    const result = reconcileCartWithCancelledRestaurantItems(
      [{ lineId: 'line-2', name: 'Agua', quantity: 1, price: 20 }],
      [
        { localLineId: 'line-1', productName: 'Taco', status: 'cancelled' },
        { localLineId: 'line-2', productName: 'Agua', status: 'ready' }
      ]
    );

    expect(result.kept).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
    expect(result.hasRemovableCancelledItems).toBe(false);
    expect(result.hasUnmatchedCancelledItems).toBe(false);
  });

  it('detects cancelled cart items for the order summary highlight', () => {
    expect(
      isCartItemCancelledByKitchen(
        { lineId: 'line-1', name: 'Taco' },
        0,
        [{ localLineId: 'line-1', status: 'cancelled' }]
      )
    ).toBe(true);
  });
});
