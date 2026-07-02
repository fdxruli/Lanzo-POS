import { describe, expect, it } from 'vitest';
import {
  reconcileCartWithCancelledRestaurantItems,
  isCartItemCancelledByKitchen
} from '../restaurantOrderReconciliation';

const countSellableItems = (items = []) => (
  (Array.isArray(items) ? items : []).filter((item) => Number(item?.quantity) > 0).length
);

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

  it('keeps only sellable items before checkout when kitchen cancels one line', () => {
    const cartItems = [
      { lineId: 'coca-line', id: 'prod-coca', name: 'Coca Cola', quantity: 1, price: 20, trackStock: true },
      { lineId: 'pepsi-line', id: 'prod-pepsi', name: 'Pepsi', quantity: 1, price: 18, trackStock: true }
    ];
    const cloudItems = [
      { localLineId: 'coca-line', productName: 'Coca Cola', status: 'cancelled' },
      { localLineId: 'pepsi-line', productName: 'Pepsi', status: 'ready' }
    ];

    const result = reconcileCartWithCancelledRestaurantItems(cartItems, cloudItems);

    expect(result.hasRemovableCancelledItems).toBe(true);
    expect(result.hasUnmatchedCancelledItems).toBe(false);
    expect(result.removed).toEqual([cartItems[0]]);
    expect(result.kept).toEqual([cartItems[1]]);
    expect(countSellableItems(result.kept)).toBe(1);
    expect(result.kept.reduce((sum, item) => sum + item.price * item.quantity, 0)).toBe(18);
  });

  it('leaves no sellable items when kitchen cancelled the full comanda', () => {
    const cartItems = [
      { lineId: 'coca-line', id: 'prod-coca', name: 'Coca Cola', quantity: 1, price: 20 },
      { lineId: 'pepsi-line', id: 'prod-pepsi', name: 'Pepsi', quantity: 1, price: 18 }
    ];
    const cloudItems = [
      { localLineId: 'coca-line', productName: 'Coca Cola', status: 'cancelled' },
      { localLineId: 'pepsi-line', productName: 'Pepsi', status: 'cancelled' }
    ];

    const result = reconcileCartWithCancelledRestaurantItems(cartItems, cloudItems);

    expect(result.hasRemovableCancelledItems).toBe(true);
    expect(result.hasUnmatchedCancelledItems).toBe(false);
    expect(result.removed).toEqual(cartItems);
    expect(result.kept).toEqual([]);
    expect(countSellableItems(result.kept)).toBe(0);
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
