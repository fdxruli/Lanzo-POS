import { describe, expect, it } from 'vitest';
import { mapLocalCheckoutToCloudSale } from '../salesCloudCashierMapper';

describe('salesCloudCashierMapper discounts', () => {
  it('maps line discount as net line_total', () => {
    const payload = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-1', timestamp: '2026-07-03T12:00:00.000Z', subtotal: 200, discountTotal: 20, total: 180 },
      processedItems: [{ id: 'product-1', lineId: 'line-1', name: 'Producto', price: 100, quantity: 2, exactTotal: 200, discount: { amount: 20, reason: 'Cortesía' }, discountAmount: 20, lineTotal: 180 }],
      paymentData: { paymentMethod: 'efectivo', amountPaid: 180 },
      total: 180
    });

    expect(payload.sale.discount_total).toBe(20);
    expect(payload.sale.total).toBe(180);
    expect(payload.items[0].discount_amount).toBe(20);
    expect(payload.items[0].line_total).toBe(180);
  });

  it('uses exactTotal minus discount when lineTotal is missing', () => {
    const payload = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-3', timestamp: '2026-07-03T12:00:00.000Z', subtotal: 200, discountTotal: 20, total: 180 },
      processedItems: [{ id: 'product-1', lineId: 'line-1', name: 'Producto', price: 100, quantity: 2, exactTotal: 200, discountAmount: 20 }],
      paymentData: { paymentMethod: 'efectivo', amountPaid: 180 },
      total: 180
    });

    expect(payload.items[0].line_subtotal).toBe(200);
    expect(payload.items[0].discount_amount).toBe(20);
    expect(payload.items[0].line_total).toBe(180);
  });

  it('keeps restaurant modifiers with cloud inventory', () => {
    const selectedModifiers = [{ id: 'extra-cheese', name: 'Queso extra', price: 10, ingredientId: 'ingredient-cheese', ingredientQuantity: 1, ingredientUnit: 'pieza', tracksInventory: true, quantity: 1 }];
    const payload = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-2', timestamp: '2026-07-03T12:00:00.000Z', subtotal: 210, discountTotal: 10, total: 200 },
      processedItems: [{ id: 'burger-1', lineId: 'line-burger', name: 'Hamburguesa', price: 210, quantity: 1, exactTotal: 210, selectedModifiers, discountAmount: 10, lineTotal: 200 }],
      paymentData: { paymentMethod: 'efectivo', amountPaid: 200 },
      total: 200,
      inventoryEnabled: true
    });

    expect(payload.items[0].quantity).toBe(1);
    expect(payload.items[0].selected_modifiers).toEqual(selectedModifiers);
    expect(payload.items[0].metadata.selectedModifiers).toEqual(selectedModifiers);
    expect(payload.items[0].line_total).toBe(200);
  });
});
