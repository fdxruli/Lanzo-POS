import { describe, expect, it } from 'vitest';
import {
  getPublicProductMaxQuantity,
  getPublicProductStockLabel,
  isPublicProductAvailable,
} from '../ecommercePublicProductRules';

describe('ecommercePublicProductRules', () => {
  it('does not invent a label for unknown status stock', () => {
    const product = {
      isAvailable: true,
      stock: { mode: 'status', status: null },
    };

    expect(isPublicProductAvailable(product)).toBe(true);
    expect(getPublicProductStockLabel(product)).toBeNull();
  });

  it('treats exact zero stock as unavailable even without status', () => {
    const product = {
      isAvailable: true,
      stock: { mode: 'exact', status: null, quantity: 0 },
    };

    expect(isPublicProductAvailable(product)).toBe(false);
    expect(getPublicProductStockLabel(product)).toBe('Agotado');
    expect(getPublicProductMaxQuantity(product, 99)).toBe(0);
  });

  it('uses the lower limit between portal and exact stock', () => {
    const product = {
      isAvailable: true,
      stock: { mode: 'exact', status: 'available', quantity: 3 },
    };

    expect(getPublicProductStockLabel(product)).toBe('3 disponibles');
    expect(getPublicProductMaxQuantity(product, 99)).toBe(3);
    expect(getPublicProductMaxQuantity(product, 2)).toBe(2);
  });

  it('keeps hidden stock private and follows isAvailable', () => {
    expect(getPublicProductStockLabel({
      isAvailable: true,
      stock: { mode: 'hidden', quantity: 50 },
    })).toBeNull();
    expect(isPublicProductAvailable({
      isAvailable: false,
      stock: { mode: 'hidden' },
    })).toBe(false);
  });

  it('lets confirmed out_of_stock override inconsistent positive quantity', () => {
    const product = {
      isAvailable: true,
      stock: { mode: 'exact', status: 'out_of_stock', quantity: 5 },
    };

    expect(isPublicProductAvailable(product)).toBe(false);
    expect(getPublicProductStockLabel(product)).toBe('Agotado');
  });
});
