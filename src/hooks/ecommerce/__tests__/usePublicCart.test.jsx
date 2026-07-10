// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import usePublicCart, { getPublicCartStorageKey } from '../usePublicCart';

const products = [
  {
    id: 'a',
    name: 'Producto A',
    price: 0.1,
    currency: 'MXN',
    isAvailable: true,
    stock: { mode: 'hidden', status: null },
  },
  {
    id: 'b',
    name: 'Producto B',
    price: 0.2,
    currency: 'MXN',
    isAvailable: true,
    stock: { mode: 'status', status: 'available' },
  },
  {
    id: 'c',
    name: 'Producto C',
    price: 10,
    currency: 'MXN',
    isAvailable: false,
    stock: { mode: 'hidden', status: null },
  },
];

const renderCart = (overrides = {}) => renderHook((props) => usePublicCart(props), {
  initialProps: {
    slug: 'tienda-a',
    products,
    catalogReady: true,
    maxItemQuantity: 3,
    maxOrderItems: 2,
    minOrderTotal: 1,
    ...overrides,
  },
});

describe('usePublicCart', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('adds, changes, removes and clears products with precise totals', async () => {
    const { result } = renderCart();
    await waitFor(() => expect(result.current.items).toHaveLength(0));

    act(() => {
      result.current.addProduct(products[0]);
      result.current.addProduct(products[1]);
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.subtotal).toBe('0.30');

    act(() => result.current.increment('a'));
    expect(result.current.subtotal).toBe('0.40');

    act(() => result.current.setQuantity('b', 3));
    expect(result.current.subtotal).toBe('0.80');

    act(() => result.current.decrement('a'));
    expect(result.current.subtotal).toBe('0.70');

    act(() => result.current.removeProduct('a'));
    expect(result.current.items.map((item) => item.product.id)).toEqual(['b']);

    act(() => result.current.clearCart());
    expect(result.current.items).toHaveLength(0);
  });

  it('respects maximum quantity and maximum distinct lines', async () => {
    const { result } = renderCart({ maxItemQuantity: 2, maxOrderItems: 1 });
    await waitFor(() => expect(result.current.items).toHaveLength(0));

    act(() => {
      result.current.addProduct(products[0]);
      result.current.addProduct(products[0]);
      result.current.addProduct(products[0]);
      result.current.addProduct(products[1]);
    });

    await waitFor(() => expect(result.current.items[0].quantity).toBe(2));
    expect(result.current.items).toHaveLength(1);
  });

  it('restores by slug, drops unavailable products and uses current catalog prices', async () => {
    window.sessionStorage.setItem(getPublicCartStorageKey('tienda-a'), JSON.stringify({
      version: 1,
      items: [
        { id: 'a', quantity: 2, price: 999 },
        { id: 'missing', quantity: 1, price: 999 },
        { id: 'c', quantity: 1, price: 999 },
      ],
    }));
    window.sessionStorage.setItem(getPublicCartStorageKey('tienda-b'), JSON.stringify({
      version: 1,
      items: [{ id: 'b', quantity: 1 }],
    }));

    const { result, rerender } = renderCart();
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]).toMatchObject({ quantity: 2, product: { id: 'a', price: 0.1 } });
    expect(result.current.subtotal).toBe('0.20');

    rerender({
      slug: 'tienda-b',
      products,
      catalogReady: true,
      maxItemQuantity: 3,
      maxOrderItems: 2,
      minOrderTotal: 0,
    });
    await waitFor(() => expect(result.current.items[0]?.product.id).toBe('b'));
    expect(result.current.subtotal).toBe('0.20');
  });
});
