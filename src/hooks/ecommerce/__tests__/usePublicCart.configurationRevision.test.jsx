// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import usePublicCart, { getPublicCartStorageKey } from '../usePublicCart';
import { buildEcommerceConfiguredLineKey } from '../../../utils/ecommerceConfiguredProduct';

const REVISION = 'c'.repeat(64);
const product = {
  id: 'product-1',
  name: 'Producto configurable',
  price: 100,
  currency: 'MXN',
  isAvailable: true,
  stock: { mode: 'hidden', status: 'available', quantity: null },
  configuration: {
    type: 'configurable',
    version: 1,
    hasVariants: true,
    hasOptionGroups: true,
    requiresConfiguration: true
  }
};

const lineKey = buildEcommerceConfiguredLineKey({
  productId: product.id,
  variantId: 'variant-1',
  selections: [{ groupId: 'group-1', optionIds: ['option-1'] }]
});

const configuredLine = {
  success: true,
  lineKey,
  productId: product.id,
  variantId: 'variant-1',
  selections: [{ groupId: 'group-1', optionIds: ['option-1'] }],
  configurationVersion: 1,
  configurationRevision: REVISION,
  configurationSnapshot: {
    version: 1,
    configurationVersion: 1,
    configurationRevision: REVISION,
    variant: { id: 'variant-1', name: 'Rojo / M', optionValues: { color: 'Rojo', talla: 'M' } },
    groups: [],
    pricing: { finalUnitPrice: 115 }
  },
  display: { variantName: 'Rojo / M', groups: [] },
  estimatedUnitPrice: 115,
  maxQuantity: 10,
  quantity: 2
};

const renderCart = () => renderHook(() => usePublicCart({
  slug: 'mi-tienda',
  products: [product],
  catalogReady: true,
  catalogExhausted: true,
  catalogRevision: 7,
  maxItemQuantity: 10,
  maxOrderItems: 30,
  minOrderTotal: 0
}));

describe('usePublicCart configurationRevision', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('stores and restores the revision without changing line identity', async () => {
    const first = renderCart();
    await waitFor(() => expect(first.result.current.isReconciled).toBe(true));

    act(() => first.result.current.addProduct(configuredLine));
    await waitFor(() => expect(first.result.current.items).toHaveLength(1));

    const stored = JSON.parse(
      window.sessionStorage.getItem(getPublicCartStorageKey('mi-tienda'))
    );
    expect(stored.version).toBe(3);
    expect(stored.items[0]).toMatchObject({
      lineKey,
      configurationVersion: 1,
      configurationRevision: REVISION
    });
    expect(stored.items[0].configurationSnapshot.configurationRevision).toBe(REVISION);

    first.unmount();
    const restored = renderCart();
    await waitFor(() => expect(restored.result.current.items).toHaveLength(1));
    expect(restored.result.current.items[0].product.configurationLine).toMatchObject({
      lineKey,
      configurationRevision: REVISION
    });
  });

  it('does not restore a configurable line that has no content revision', async () => {
    window.sessionStorage.setItem(getPublicCartStorageKey('mi-tienda'), JSON.stringify({
      version: 2,
      items: [{
        lineKey,
        productId: product.id,
        variantId: 'variant-1',
        selections: [{ groupId: 'group-1', optionIds: ['option-1'] }],
        configurationVersion: 1,
        quantity: 1
      }]
    }));

    const { result } = renderCart();
    await waitFor(() => expect(result.current.isReconciled).toBe(true));
    expect(result.current.items).toHaveLength(0);
    expect(window.sessionStorage.getItem(getPublicCartStorageKey('mi-tienda'))).toBeNull();
  });

  it('replaces the revision on edit while retaining the deterministic key', async () => {
    const { result } = renderCart();
    await waitFor(() => expect(result.current.isReconciled).toBe(true));
    act(() => result.current.addProduct(configuredLine));

    const refreshedRevision = 'd'.repeat(64);
    act(() => result.current.addProduct({
      ...configuredLine,
      configurationRevision: refreshedRevision,
      configurationSnapshot: {
        ...configuredLine.configurationSnapshot,
        configurationRevision: refreshedRevision
      },
      quantity: 1
    }, { replaceLineKey: lineKey }));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].product.configurationLine).toMatchObject({
      lineKey,
      configurationRevision: refreshedRevision
    });
  });
});
