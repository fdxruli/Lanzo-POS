import { describe, expect, it } from 'vitest';
import {
  ensureCartProductReference,
  getCartProductId
} from '../cartLineIdentity';

describe('cart product and line identity', () => {
  it('adds productId to a catalog line without mixing id and lineId', () => {
    const source = {
      id: 'product-1',
      lineId: 'line-1',
      name: 'Producto',
      price: 20,
      quantity: 1
    };

    const line = ensureCartProductReference(source, { allowIdFallback: true });

    expect(line).toMatchObject({
      id: 'product-1',
      lineId: 'line-1',
      productId: 'product-1'
    });
    expect(line).not.toBe(source);
  });

  it.each([
    ['product_id', { product_id: 'product-snake' }, 'product-snake'],
    ['productId', { productId: 'product-camel' }, 'product-camel'],
    ['parentId', { parentId: 'product-parent' }, 'product-parent']
  ])('preserves the explicit %s product reference', (_field, source, expected) => {
    const line = ensureCartProductReference({ id: 'line-1', lineId: 'line-1', ...source });

    expect(getCartProductId(line)).toBe(expected);
    expect(line.productId).toBe(expected);
  });

  it('does not infer a product from a legacy line identity', () => {
    const line = { id: 'line-1', lineId: 'line-1', name: 'Línea heredada' };

    expect(getCartProductId(line)).toBeNull();
    expect(ensureCartProductReference(line)).toBe(line);
  });
});
