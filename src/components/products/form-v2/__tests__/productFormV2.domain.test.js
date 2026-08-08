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

  it('hydrates canonical and legacy grocery sale units without turning bulk into pieces', () => {
    expect(getProductFormDefaults({ activeRubro: 'abarrotes', productToEdit: { saleType: 'bulk', bulkData: { sale: { unit: 'kg' } } } })).toMatchObject({ saleMode: 'bulk', saleType: 'bulk', unit: 'kg' });
    expect(getProductFormDefaults({ activeRubro: 'abarrotes', productToEdit: { saleType: 'bulk', unit: 'kilo' } }).unit).toBe('kg');
    expect(getProductFormDefaults({ activeRubro: 'abarrotes', productToEdit: { unit: 'pieza' } }).unit).toBe('pza');
    expect(getProductFormDefaults({ activeRubro: 'abarrotes', productToEdit: { unit: 'gr' } }).unit).toBe('g');
  });

  it('hydrates fractioned products as a UI mode while accepting legacy cloud values', () => {
    expect(getProductFormDefaults({ activeRubro: 'abarrotes', productToEdit: { saleType: 'unit', conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 12 } } })).toMatchObject({ saleMode: 'fractioned', saleType: 'unit' });
    expect(getProductFormDefaults({ activeRubro: 'abarrotes', productToEdit: { saleType: 'fractioned', conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 12 } } })).toMatchObject({ saleMode: 'fractioned', saleType: 'unit' });
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
    const payload = buildProductFormPayload(base({ stock: 24, saleMode: 'fractioned', unit: 'pza', conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 24 } }), { activeRubro: 'abarrotes' });
    expect(payload.stock).toBe(24);
    expect(payload.saleType).toBe('unit');
    expect(payload.conversionFactor).toEqual({ enabled: true, purchaseUnit: 'caja', factor: 24 });
  });

  it('persists bulk kg in bulkData.sale and keeps the canonical value through defaults', () => {
    const payload = buildProductFormPayload(base({ saleMode: 'bulk', unit: 'kg' }), { activeRubro: 'abarrotes' });
    expect(payload).toMatchObject({ saleType: 'bulk', unit: 'kg', bulkData: { sale: { unit: 'kg' } } });
    expect(getProductFormDefaults({ activeRubro: 'abarrotes', productToEdit: payload })).toMatchObject({ saleMode: 'bulk', saleType: 'bulk', unit: 'kg' });
  });

  it('requires a purchase unit and a factor greater than one for fractioned sales', () => {
    const invalid = validateProductForm(base({ saleMode: 'fractioned', conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 1 } }));
    expect(invalid.fieldErrors.conversionFactor).toMatch(/mayor que 1/i);
    const valid = validateProductForm(base({ saleMode: 'fractioned', conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 12 } }));
    expect(valid.fieldErrors.conversionFactor).toBeUndefined();
    expect(valid.fieldErrors.purchaseUnit).toBeUndefined();
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

  it('preserves existing wholesale tiers while editing unrelated fields', () => {
    const productToEdit = { id: 'p-tier', stock: 7, wholesaleTiers: [{ min: 6, price: 15 }] };
    const payload = buildProductFormPayload(base({ name: 'Nombre editado', wholesaleTiers: productToEdit.wholesaleTiers }), { activeRubro: 'abarrotes', productToEdit });
    expect(payload.wholesaleTiers).toEqual([{ min: 6, price: 15 }]);
  });

  it('normalizes legacy ingredient units and resolves missing unit ingredients as pieces', () => {
    expect(getProductFormDefaults({ activeRubro: 'food_service', productToEdit: { id: 'ing-gr', productType: 'ingredient', unit: 'gr' } })).toMatchObject({ restaurantType: 'ingredient', unit: 'g', saleType: 'bulk' });
    expect(getProductFormDefaults({ activeRubro: 'food_service', productToEdit: { id: 'ing-pza', productType: 'ingredient', saleType: 'unit' } })).toMatchObject({ restaurantType: 'ingredient', unit: 'pza', saleType: 'unit' });
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

  it.each([['kg', 'bulk'], ['pza', 'unit']])('persists ingredient %s with coherent unit, sale type, and bulk data', (unit, saleType) => {
    const payload = buildProductFormPayload(base({ restaurantType: 'ingredient', unit, saleType: 'unit', price: 99 }), { activeRubro: 'food_service' });
    expect(payload).toMatchObject({ productType: 'ingredient', price: 0, unit, saleType });
    if (saleType === 'bulk') expect(payload.bulkData?.purchase?.unit).toBe(unit);
  });

  it('updates only the legacy bulk purchase unit and preserves it for piece edits', () => {
    const legacyBulkData = { purchase: { unit: 'kilo', supplier: 'Proveedor' }, batches: [{ id: 'lot-1' }] };
    const bulkPayload = buildProductFormPayload(base({ restaurantType: 'ingredient', unit: 'g', saleType: 'unit', bulkData: legacyBulkData }), { activeRubro: 'food_service' });
    expect(bulkPayload.bulkData).toEqual({ purchase: { unit: 'g', supplier: 'Proveedor' }, batches: [{ id: 'lot-1' }] });

    const piecePayload = buildProductFormPayload(base({ restaurantType: 'ingredient', unit: 'pza', saleType: 'bulk' }), { activeRubro: 'food_service', productToEdit: { id: 'piece-1', bulkData: legacyBulkData } });
    expect(piecePayload.bulkData).toEqual(legacyBulkData);
  });
});
