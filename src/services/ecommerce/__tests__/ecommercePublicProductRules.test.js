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

  it('keeps hidden stock private and follows only isAvailable', () => {
    const inconsistentHiddenStock = {
      isAvailable: true,
      stock: { mode: 'hidden', status: 'out_of_stock', quantity: 0 },
    };

    expect(getPublicProductStockLabel(inconsistentHiddenStock)).toBeNull();
    expect(isPublicProductAvailable(inconsistentHiddenStock)).toBe(true);
    expect(getPublicProductMaxQuantity(inconsistentHiddenStock, 8)).toBe(8);
    expect(isPublicProductAvailable({
      isAvailable: false,
      stock: { mode: 'hidden' },
    })).toBe(false);
  });

  it('lets confirmed out_of_stock override inconsistent positive exact quantity', () => {
    const product = {
      isAvailable: true,
      stock: { mode: 'exact', status: 'out_of_stock', quantity: 5 },
    };

    expect(isPublicProductAvailable(product)).toBe(false);
    expect(getPublicProductStockLabel(product)).toBe('Agotado');
  });

  it('prioritizes effective availability over positive stock labels', () => {
    expect(getPublicProductStockLabel({
      isAvailable: false,
      stock: { mode: 'status', status: 'available' },
    })).toBe('No disponible');

    expect(getPublicProductStockLabel({
      isAvailable: false,
      stock: { mode: 'exact', status: 'available', quantity: 5 },
    })).toBe('No disponible');

    expect(getPublicProductStockLabel({
      isAvailable: true,
      stock: { mode: 'status', status: 'out_of_stock' },
    })).toBe('Agotado');

    expect(getPublicProductStockLabel({
      isAvailable: true,
      stock: { mode: 'exact', status: 'available', quantity: 5 },
    })).toBe('5 disponibles');
  });
});
