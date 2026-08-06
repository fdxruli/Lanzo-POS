import { describe, expect, it } from 'vitest';
import { getProductFormDefaults } from '../config/productFormDefaults';
import { buildProductFormPayload } from '../domain/buildProductFormPayload';
import { validateProductForm } from '../domain/validateProductForm';

const base = (overrides = {}) => ({ name: 'Producto', price: 20, cost: 10, trackStock: true, stock: 3, minStock: '', maxStock: '', saleType: 'unit', unit: 'pza', conversionFactor: { enabled: false, purchaseUnit: '', factor: '' }, expirationMode: 'NONE', shelfLifeValue: '', shelfLifeUnit: 'days', expiryDate: '', manufacturerBatchId: '', hasVariants: false, quickVariants: [], restaurantType: 'ready', recipe: [], modifiers: [], ...overrides });

describe('Product Form V2 defaults', () => {
  it.each([['abarrotes', 'unit'], ['hardware', 'unit'], ['verduleria/fruteria', 'bulk'], ['apparel', 'unit'], ['farmacia', 'unit'], ['food_service', 'unit'], ['otro', 'unit']])('sets safe defaults for %s', (activeRubro, saleType) => {
    const result = getProductFormDefaults({ activeRubro });
    expect(result.saleType).toBe(saleType);
    expect(result.trackStock).toBe(activeRubro !== 'food_service');
  });

  it('defaults a restaurant dish to no direct stock', () => {
    expect(getProductFormDefaults({ activeRubro: 'food_service' }).trackStock).toBe(false);
  });
});

describe('Product Form V2 validation', () => {
  it('reports required name, price, negative stock and invalid conversion', () => {
    const result = validateProductForm(base({ name: '', price: 0, stock: -1, conversionFactor: { enabled: true, purchaseUnit: '', factor: 0 } }));
    expect(result.fieldErrors).toMatchObject({ name: expect.any(String), price: expect.any(String), stock: expect.any(String), purchaseUnit: expect.any(String), conversionFactor: expect.any(String) });
  });

  it('rejects simultaneous strict date and shelf life', () => {
    const result = validateProductForm(base({ expirationMode: 'STRICT', expiryDate: '2026-10-01', shelfLifeValue: 4 }));
    expect(result.fieldErrors.expirationMode).toBeTruthy();
  });

  it('requires pharmacy initial lot and expiry only when stock is positive', () => {
    expect(validateProductForm(base({ stock: 0, expirationMode: 'STRICT' }), { activeRubro: 'farmacia' }).fieldErrors.manufacturerBatchId).toBeUndefined();
    const result = validateProductForm(base({ stock: 1, expirationMode: 'STRICT' }), { activeRubro: 'farmacia' });
    expect(result.fieldErrors.manufacturerBatchId).toBeTruthy();
    expect(result.fieldErrors.expiryDate).toBeTruthy();
  });

  it('rejects incomplete and duplicate variants', () => {
    const result = validateProductForm(base({ hasVariants: true, quickVariants: [{ talla: 'M', color: 'Rojo' }, { talla: 'M', color: 'Rojo' }, { talla: 'L', color: '' }] }));
    expect(result.fieldErrors.quickVariants).toBeTruthy();
  });
});

describe('Product Form V2 payload', () => {
  it('does not create initial stock or expiration data without inventory', () => {
    const payload = buildProductFormPayload(base({ trackStock: false, stock: 8, expirationMode: 'STRICT', expiryDate: '2026-11-01' }), { activeRubro: 'abarrotes' });
    expect(payload).toMatchObject({ trackStock: false, stock: 0, expirationMode: 'NONE', expiryDate: null });
  });

  it('preserves new-product initial stock and fractioned conversion', () => {
    const payload = buildProductFormPayload(base({ stock: 24, saleType: 'fractioned', conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 24 } }), { activeRubro: 'abarrotes' });
    expect(payload.stock).toBe(24);
    expect(payload.conversionFactor).toEqual({ enabled: true, purchaseUnit: 'caja', factor: 24 });
  });

  it('normalizes shelf life and strict produce expiry as mutually exclusive', () => {
    const shelfLife = buildProductFormPayload(base({ saleType: 'bulk', unit: 'kg', expirationMode: 'SHELF_LIFE', shelfLifeValue: 5, expiryDate: '2026-12-01' }), { activeRubro: 'verduleria/fruteria' });
    expect(shelfLife).toMatchObject({ expiryDate: null, shelfLifeValue: 5, shelfLifeUnit: 'days' });
    const strict = buildProductFormPayload(base({ expirationMode: 'STRICT', expiryDate: '2026-12-01', shelfLifeValue: 5 }), { activeRubro: 'verduleria/fruteria' });
    expect(strict).toMatchObject({ expiryDate: '2026-12-01', shelfLifeValue: null });
  });

  it('uses variant lots without duplicating general stock', () => {
    const payload = buildProductFormPayload(base({ stock: 4, hasVariants: true, quickVariants: [{ talla: 'M', color: 'Azul', stock: 2, cost: 10, price: 20 }] }), { activeRubro: 'apparel' });
    expect(payload.stock).toBe(0);
    expect(payload.quickVariants).toHaveLength(1);
  });

  it('preserves existing stock on edit', () => {
    const payload = buildProductFormPayload(base({ stock: 99 }), { activeRubro: 'hardware', productToEdit: { id: 'p1', stock: 7, unmappedField: 'keep' } });
    expect(payload.stock).toBe(7);
    expect(payload.unmappedField).toBe('keep');
  });

  it.each([
    ['ingredient', 'ingredient', 0, false],
    ['ingredient', 'ingredient', '', false],
    ['dish', 'sellable', 0, true],
    ['drink', 'sellable', 0, true],
    ['ready', 'sellable', 0, true]
  ])('handles sale-price validation for %s', (restaurantType, productType, price, expectsPriceError) => {
    const result = validateProductForm(base({ restaurantType, productType, price }));
    expect(Boolean(result.fieldErrors.price)).toBe(expectsPriceError);
  });

  it('accepts recipe entries with canonical or legacy ingredient identifiers', () => {
    expect(validateProductForm(base({ restaurantType: 'dish', recipe: [{ ingredientId: 'ingredient-1', quantity: 1 }] })).fieldErrors.recipe).toBeUndefined();
    expect(validateProductForm(base({ restaurantType: 'dish', recipe: [{ productId: 'ingredient-1', quantity: 1 }] })).fieldErrors.recipe).toBeUndefined();
    expect(validateProductForm(base({ restaurantType: 'dish', recipe: [{ quantity: 1 }] })).fieldErrors.recipe).toBeTruthy();
    expect(validateProductForm(base({ restaurantType: 'dish', recipe: [{ ingredientId: 'ingredient-1', quantity: 0 }] })).fieldErrors.recipe).toBeTruthy();
  });

  it('uses the canonical pharmacy FEFO value and records explicit image removal', () => {
    const payload = buildProductFormPayload(base({ imageRemoved: true }), { activeRubro: 'farmacia', productToEdit: { id: 'p1', image: 'img-old' } });
    expect(payload.batchManagement.selectionStrategy).toBe('fefo');
    expect(payload).toMatchObject({ image: null, imageRemoved: true });
  });

  it('normalizes ingredients to a zero sale price while preserving cost and stock', () => {
    const payload = buildProductFormPayload(base({ restaurantType: 'ingredient', productType: 'sellable', price: 99, cost: 18, stock: 7 }), { activeRubro: 'food_service' });
    expect(payload).toMatchObject({ restaurantType: 'ingredient', productType: 'ingredient', price: 0, cost: 18, stock: 7 });
  });
});
