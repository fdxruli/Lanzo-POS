// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import usePublicCart, { getPublicCartStorageKey } from '../usePublicCart';
import { buildEcommerceConfiguredLineKey } from '../../../utils/ecommerceConfiguredProduct';

const product = {
  id: 'p1', name: 'Hamburguesa', price: 100, currency: 'MXN', isAvailable: true,
  stock: { mode: 'hidden', status: 'available', quantity: null },
  configuration: { type: 'variant_parent', version: 2, hasVariants: true, hasOptionGroups: true, requiresConfiguration: true }
};
const line = (variantId, optionId, quantity = 1) => ({
  success: true,
  lineKey: buildEcommerceConfiguredLineKey({
    productId: 'p1', variantId,
    selections: [{ groupId: 'extras', optionIds: [optionId] }]
  }),
  productId: 'p1', variantId,
  selections: [{ groupId: 'extras', optionIds: [optionId] }],
  configurationVersion: 2,
  configurationSnapshot: {
    variant: { id: variantId, name: variantId, optionValues: { size: variantId } },
    groups: [{ id: 'extras', name: 'Extras', options: [{ id: optionId, name: optionId }] }]
  },
  display: { variantName: variantId, groups: [{ name: 'Extras', options: [optionId] }] },
  estimatedUnitPrice: optionId === 'cheese' ? 130 : 140,
  maxQuantity: 5,
  quantity
});

const renderCart = () => renderHook(() => usePublicCart({
  slug: 'store', products: [product], catalogReady: true, catalogExhausted: true,
  catalogRevision: 9, maxItemQuantity: 99, maxOrderItems: 30, minOrderTotal: 0
}));

describe('usePublicCart configured lines', () => {
  beforeEach(() => sessionStorage.clear());

  it('merges identical configurations and separates different configurations', async () => {
    const { result } = renderCart();
    await waitFor(() => expect(result.current.isReconciled).toBe(true));
    act(() => {
      result.current.addProduct(line('double', 'cheese'));
      result.current.addProduct(line('double', 'cheese', 2));
      result.current.addProduct(line('double', 'bacon'));
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.map((item) => item.quantity).sort()).toEqual([1, 3]);
    expect(result.current.subtotal).toBe('530.00');
  });

  it('edits a line, replaces the original and merges with an existing target', async () => {
    const { result } = renderCart();
    await waitFor(() => expect(result.current.isReconciled).toBe(true));
    const cheese = line('double', 'cheese');
    const bacon = line('double', 'bacon', 2);
    act(() => { result.current.addProduct(cheese); result.current.addProduct(bacon); });
    act(() => result.current.addProduct({ ...bacon, quantity: 1 }, { replaceLineKey: cheese.lineKey }));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ quantity: 3, product: { price: 140 } });
  });

  it('restores versioned configuration and removes it when configurationVersion changes', async () => {
    const configured = line('double', 'cheese', 2);
    sessionStorage.setItem(getPublicCartStorageKey('store'), JSON.stringify({ version: 2, items: [configured] }));
    const { result, rerender } = renderHook(({ version }) => usePublicCart({
      slug: 'store',
      products: [{ ...product, configuration: { ...product.configuration, version } }],
      catalogReady: true, catalogExhausted: true, catalogRevision: version,
      maxItemQuantity: 99, maxOrderItems: 30, minOrderTotal: 0
    }), { initialProps: { version: 2 } });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    rerender({ version: 3 });
    await waitFor(() => expect(result.current.items).toHaveLength(0));
  });
});
