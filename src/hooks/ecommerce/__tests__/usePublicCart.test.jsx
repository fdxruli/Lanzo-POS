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
  {
    id: 'exact-3',
    name: 'Producto exacto',
    price: 50,
    currency: 'MXN',
    isAvailable: true,
    stock: { mode: 'exact', status: 'available', quantity: 3 },
  },
  {
    id: 'exact-0',
    name: 'Producto agotado',
    price: 50,
    currency: 'MXN',
    isAvailable: true,
    stock: { mode: 'exact', status: null, quantity: 0 },
  },
];

const renderCart = (overrides = {}) => renderHook((props) => usePublicCart(props), {
  initialProps: {
    slug: 'tienda-a',
    products,
    catalogReady: true,
    catalogExhausted: true,
    maxItemQuantity: 3,
    maxOrderItems: 5,
    minOrderTotal: 1,
    ...overrides,
  },
});

describe('usePublicCart', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('adds, changes, removes and clears products with precise totals', async () => {
    const { result } = renderCart();
    await waitFor(() => expect(result.current.isReconciled).toBe(true));

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

  it('does not delete a stored product while the catalog is partial', async () => {
    window.sessionStorage.setItem(getPublicCartStorageKey('tienda-a'), JSON.stringify({
      version: 1,
      items: [{ id: 'product-120', quantity: 2, price: 999 }],
    }));

    const product120 = {
      id: 'product-120',
      name: 'Producto 120',
      price: 55,
      currency: 'MXN',
      isAvailable: true,
      stock: { mode: 'hidden', status: null },
    };
    const { result, rerender } = renderCart({
      products,
      catalogExhausted: false,
    });

    await waitFor(() => expect(result.current.pendingProductIds).toEqual(['product-120']));
    expect(result.current.isReconciled).toBe(false);
    expect(JSON.parse(window.sessionStorage.getItem(getPublicCartStorageKey('tienda-a'))).items).toEqual([
      { id: 'product-120', quantity: 2, price: 999 },
    ]);

    rerender({
      slug: 'tienda-a',
      products: [...products, product120],
      catalogReady: true,
      catalogExhausted: false,
      maxItemQuantity: 99,
      maxOrderItems: 5,
      minOrderTotal: 0,
    });

    await waitFor(() => expect(result.current.isReconciled).toBe(true));
    expect(result.current.items[0]).toMatchObject({
      quantity: 2,
      product: { id: 'product-120', price: 55 },
    });
    expect(result.current.subtotal).toBe('110.00');
    expect(JSON.parse(window.sessionStorage.getItem(getPublicCartStorageKey('tienda-a'))).items).toEqual([
      { id: 'product-120', quantity: 2 },
    ]);
  });

  it('removes a truly missing product only after the catalog is exhausted', async () => {
    window.sessionStorage.setItem(getPublicCartStorageKey('tienda-a'), JSON.stringify({
      version: 1,
      items: [{ id: 'missing', quantity: 1 }],
    }));

    const { result, rerender } = renderCart({ catalogExhausted: false });
    await waitFor(() => expect(result.current.pendingProductIds).toEqual(['missing']));
    expect(window.sessionStorage.getItem(getPublicCartStorageKey('tienda-a'))).not.toBeNull();

    rerender({
      slug: 'tienda-a',
      products,
      catalogReady: true,
      catalogExhausted: true,
      maxItemQuantity: 3,
      maxOrderItems: 5,
      minOrderTotal: 0,
    });

    await waitFor(() => expect(result.current.isReconciled).toBe(true));
    await waitFor(() => expect(window.sessionStorage.getItem(getPublicCartStorageKey('tienda-a'))).toBeNull());
    expect(result.current.items).toHaveLength(0);
  });

  it('rejects exact zero stock from add and restoration', async () => {
    window.sessionStorage.setItem(getPublicCartStorageKey('tienda-a'), JSON.stringify({
      version: 1,
      items: [{ id: 'exact-0', quantity: 1 }],
    }));

    const { result } = renderCart({ maxItemQuantity: 99 });
    await waitFor(() => expect(result.current.isReconciled).toBe(true));
    expect(result.current.items).toHaveLength(0);
    expect(window.sessionStorage.getItem(getPublicCartStorageKey('tienda-a'))).toBeNull();

    act(() => result.current.addProduct(products[4]));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.notice).toMatch(/no está disponible/i);
  });

  it('limits restoration, increment and manual editing by exact stock', async () => {
    window.sessionStorage.setItem(getPublicCartStorageKey('tienda-a'), JSON.stringify({
      version: 1,
      items: [{ id: 'exact-3', quantity: 10 }],
    }));

    const { result } = renderCart({ maxItemQuantity: 99 });
    await waitFor(() => expect(result.current.items[0]?.quantity).toBe(3));
    expect(result.current.items[0].maxQuantity).toBe(3);

    act(() => result.current.increment('exact-3'));
    expect(result.current.items[0].quantity).toBe(3);
    expect(result.current.notice).toMatch(/3 unidades disponibles/i);

    act(() => result.current.setQuantity('exact-3', 10));
    expect(result.current.items[0].quantity).toBe(3);
  });

  it('respects maximum distinct lines and keeps carts separated by slug', async () => {
    window.sessionStorage.setItem(getPublicCartStorageKey('tienda-b'), JSON.stringify({
      version: 1,
      items: [{ id: 'b', quantity: 1 }],
    }));

    const { result, rerender } = renderCart({ maxOrderItems: 1 });
    await waitFor(() => expect(result.current.isReconciled).toBe(true));

    act(() => {
      result.current.addProduct(products[0]);
      result.current.addProduct(products[1]);
    });
    expect(result.current.items).toHaveLength(1);

    rerender({
      slug: 'tienda-b',
      products,
      catalogReady: true,
      catalogExhausted: true,
      maxItemQuantity: 3,
      maxOrderItems: 5,
      minOrderTotal: 0,
    });
    await waitFor(() => expect(result.current.items[0]?.product.id).toBe('b'));
    expect(result.current.subtotal).toBe('0.20');
  });
});
