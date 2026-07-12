// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import usePublicCart, { getPublicCartStorageKey } from '../usePublicCart';

const product = (overrides = {}) => ({
  id: 'product-1',
  name: 'Producto',
  price: 50,
  currency: 'MXN',
  isAvailable: true,
  stock: { mode: 'exact', status: 'available', quantity: 5 },
  ...overrides
});

const props = (overrides = {}) => ({
  slug: 'mi-tienda',
  products: [product()],
  catalogReady: true,
  catalogExhausted: true,
  catalogRevision: 1,
  maxItemQuantity: 99,
  maxOrderItems: 30,
  minOrderTotal: 0,
  ...overrides
});

describe('usePublicCart catalog revision reconciliation', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('revalidates prices and quantities when catalogRevision changes', async () => {
    const { result, rerender } = renderHook((hookProps) => usePublicCart(hookProps), {
      initialProps: props()
    });
    await waitFor(() => expect(result.current.isReconciled).toBe(true));

    act(() => result.current.addProduct(product()));
    act(() => result.current.setQuantity('product-1', 4));
    expect(result.current.subtotal).toBe('200.00');

    rerender(props({
      catalogRevision: 2,
      products: [product({ price: 60, stock: { mode: 'exact', status: 'available', quantity: 2 } })]
    }));

    await waitFor(() => expect(result.current.isReconciled).toBe(true));
    expect(result.current.items[0]).toMatchObject({
      quantity: 2,
      product: { id: 'product-1', price: 60 }
    });
    expect(result.current.subtotal).toBe('120.00');
    expect(result.current.notice).toMatch(/precios y la disponibilidad vigentes/i);
  });

  it('does not remove unresolved persisted ids while the new revision still has pages', async () => {
    window.sessionStorage.setItem(getPublicCartStorageKey('mi-tienda'), JSON.stringify({
      version: 1,
      items: [{ id: 'later-page', quantity: 2 }]
    }));

    const { result, rerender } = renderHook((hookProps) => usePublicCart(hookProps), {
      initialProps: props({
        products: [product()],
        catalogRevision: 8,
        catalogExhausted: false
      })
    });

    await waitFor(() => expect(result.current.pendingProductIds).toEqual(['later-page']));
    expect(result.current.isReconciled).toBe(false);

    rerender(props({
      catalogRevision: 8,
      catalogExhausted: false,
      products: [product(), product({ id: 'later-page', price: 30 })]
    }));

    await waitFor(() => expect(result.current.isReconciled).toBe(true));
    expect(result.current.items[0]).toMatchObject({
      quantity: 2,
      product: { id: 'later-page', price: 30 }
    });
  });
});
