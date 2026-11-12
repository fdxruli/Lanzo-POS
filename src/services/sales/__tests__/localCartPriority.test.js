import { describe, expect, it } from 'vitest';
import {
  evaluateProvisionalCartChange,
  validateCartCheckoutPriority
} from '../localCartPriority';

const product = (stock = 2, committedStock = 0, quantity = 1, provisionalAddedAt = '2026-11-06T00:00:00.000Z') => ({
  id: 'X', productId: 'X', lineId: 'line-X',
  name: 'Producto X', price: 10, saleType: 'unit', trackStock: true,
  stock, committedStock, quantity, provisionalAddedAt
});
const order = (id, items = [], options = {}) => ({
  id, actorKey: 'staff:one', createdAt: '2026-11-06T00:00:00.000Z',
  items, ...options
});
const active = (a, b, target = 'B') => ({
  activeOrders: new Map([['A', a], ['B', b]]),
  currentOrderId: target
});

describe('Prioridad provisional R1, sin afectar inventario durable', () => {
  it('2 unidades en A: B necesita confirmación y identifica exactamente una unidad de A', () => {
    const state = active(order('A', [product(2, 0, 2)]), order('B'));
    const change = evaluateProvisionalCartChange({
      state, orderId: 'B', nextItems: [product(2, 0, 1, '2026-11-06T00:01:00.000Z')]
    });
    expect(change).toMatchObject({
      success: false, code: 'LOCAL_PRIORITY_CONFLICT',
      shortfall: 1, requested: 1, physical: 2, committed: 0, available: 2
    });
    expect(change.donors.map((d) => [d.orderId, d.units])).toEqual([['A', 1]]);
    expect(state.activeOrders.get('A').items[0].quantity).toBe(2);
    expect(state.activeOrders.get('B').items).toEqual([]);
  });

  it('dos carritos con una unidad cada uno permiten cobrar B y luego A con stock actualizado', () => {
    const a = order('A', [product(2)]);
    const b = order('B', [product(2, 0, 1, '2026-11-06T00:01:00.000Z')]);
    expect(validateCartCheckoutPriority({ state: active(a, b), orderId: 'B' })).toBeNull();
    expect(validateCartCheckoutPriority({
      state: active(a, order('B')), orderId: 'A', catalog: [{ id: 'X', stock: 1, committedStock: 0, trackStock: true }]
    })).toBeNull();
  });

  it('el checkout de B queda bloqueado aun con stock físico si A reclama prioridad', () => {
    const a = order('A', [product(2, 0, 2)]);
    const b = order('B', [product(2, 0, 1, '2026-11-06T00:01:00.000Z')]);
    expect(validateCartCheckoutPriority({ state: active(a, b), orderId: 'B' }))
      .toMatchObject({ code: 'LOCAL_PRIORITY_CHECKOUT_BLOCKED', earlierQuantity: 2 });
  });

  it('stock físico 0 no se convierte en ilimitado', () => {
    const state = active(order('A'), order('B'));
    expect(evaluateProvisionalCartChange({
      state, orderId: 'B', nextItems: [product(0)]
    })).toMatchObject({ code: 'LOCAL_NO_PHYSICAL_STOCK' });
  });

  it('las reservas formales consumen disponibilidad sin duplicarse con carritos guardados', () => {
    const a = order('A', [product(2, 1)], { isSaved: true });
    const b = order('B');
    const change = evaluateProvisionalCartChange({
      state: active(a, b), orderId: 'B', nextItems: [product(2, 1, 2)]
    });
    expect(change).toMatchObject({ code: 'LOCAL_FORMAL_RESERVATION', committed: 1, available: 1 });
  });

  it('una orden bloqueada para checkout jamás cede su unidad', () => {
    const a = order('A', [product(2, 0, 2)], { isLockedForCheckout: true });
    const change = evaluateProvisionalCartChange({
      state: active(a, order('B')), orderId: 'B',
      nextItems: [product(2, 0, 1, '2026-11-06T00:01:00.000Z')]
    });
    expect(change).toMatchObject({ code: 'LOCAL_SOURCE_CHECKOUT_LOCKED' });
  });

  it('rechaza ceder unidades de otro operador sin alterar las órdenes', () => {
    const a = order('A', [product(2, 0, 2)], { actorKey: 'staff:other' });
    const state = active(a, order('B'));
    expect(evaluateProvisionalCartChange({
      state, orderId: 'B', nextItems: [product(2, 0, 1)]
    })).toMatchObject({ code: 'LOCAL_SOURCE_NOT_TRANSFERABLE' });
    expect(state.activeOrders.get('A')).toBe(a);
  });

  it('fecha de primer producto manda sobre creación de pestaña y orden legacy es determinista', () => {
    const a = order('A', [product(2, 0, 1, '2026-11-06T00:02:00.000Z')], {
      createdAt: '2026-11-06T00:00:00.000Z'
    });
    const b = order('B', [product(2, 0, 2, '2026-11-06T00:01:00.000Z')], {
      createdAt: '2026-11-06T00:00:30.000Z'
    });
    const state = active(a, b, 'A');
    const change = evaluateProvisionalCartChange({
      state, orderId: 'A', nextItems: [product(2, 0, 2, '2026-11-06T00:02:00.000Z')]
    });
    expect(change).toMatchObject({ code: 'LOCAL_PRIORITY_CONFLICT' });
    expect(change.donors[0].orderId).toBe('B');
  });
});

describe('Inventario inválido no puede justificar incrementos de un carrito', () => {
  it.each([
    ['sin físico', { stock: undefined, committedStock: 0 }],
    ['compromiso inválido', { stock: 2, committedStock: Number.NaN }],
    ['sobrecomprometido', { stock: 2, committedStock: 3 }],
    ['físico negativo', { stock: -1, committedStock: 0 }]
  ])('rechaza %s como inventario desconocido', (_name, fields) => {
    const state = active(order('A'), order('B'));
    const conflict = evaluateProvisionalCartChange({
      state, orderId: 'B', nextItems: [{ ...product(2), ...fields }]
    });
    expect(conflict).toMatchObject({ code: 'LOCAL_STOCK_UNKNOWN', available: null });
    expect(state.activeOrders.get('B').items).toEqual([]);
  });
});
