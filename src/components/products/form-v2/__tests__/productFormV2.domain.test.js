import { describe, expect, it } from 'vitest';
import { getProductFormDefaults } from '../config/productFormDefaults';
import { buildProductFormPayload } from '../domain/buildProductFormPayload';
import { validateProductForm } from '../domain/validateProductForm';
import { calculateFractionedUnitCost, calculateSaleMargin } from '../domain/fractionedPricing';
import { validateWholesaleCondition } from '../../../../services/pricingLogic';
import { BULK_SALE_UNITS, PRODUCE_WEIGHT_SALE_UNITS } from '../../../../utils/productUnitConfiguration';

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

  it('hydrates legacy hardware measurement units with the canonical sale mode and unit', () => {
    expect(getProductFormDefaults({ activeRubro: 'hardware', productToEdit: { saleType: 'bulk', unit: 'm' } })).toMatchObject({ saleMode: 'bulk', saleType: 'bulk', unit: 'mt' });
  });

  it('uses a coherent default and canonical edit values for produce sale modes', () => {
    expect(getProductFormDefaults({ activeRubro: 'verduleria/fruteria' })).toMatchObject({ saleMode: 'bulk', saleType: 'bulk', unit: 'kg' });
    expect(getProductFormDefaults({ activeRubro: 'verduleria/fruteria', productToEdit: { saleType: 'bulk', unit: 'g' } })).toMatchObject({ saleMode: 'bulk', saleType: 'bulk', unit: 'g' });
    expect(getProductFormDefaults({ activeRubro: 'verduleria/fruteria', productToEdit: { saleType: 'unit', unit: 'kg' } })).toMatchObject({ saleMode: 'unit', saleType: 'unit', unit: 'pza' });
    expect(getProductFormDefaults({ activeRubro: 'verduleria/fruteria', productToEdit: { saleType: 'bulk', unit: 'mt' } })).toMatchObject({ saleMode: 'bulk', saleType: 'bulk', unit: 'kg' });
  });

  it('keeps the global bulk catalog available to grocery and hardware while deriving produce-only units', () => {
    expect(PRODUCE_WEIGHT_SALE_UNITS.map(({ value }) => value)).toEqual(['kg', 'g']);
    expect(BULK_SALE_UNITS.map(({ value }) => value)).toEqual(expect.arrayContaining(['mt', 'cm', 'ft']));
  });

  it('hydrates fractioned products as a UI mode while accepting legacy cloud values', () => {
    expect(getProductFormDefaults({ activeRubro: 'abarrotes', productToEdit: { saleType: 'unit', conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 12 } } })).toMatchObject({ saleMode: 'fractioned', saleType: 'unit' });
    expect(getProductFormDefaults({ activeRubro: 'abarrotes', productToEdit: { saleType: 'fractioned', conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 12 } } })).toMatchObject({ saleMode: 'fractioned', saleType: 'unit' });
  });

  it('keeps legacy fractioned cost as unit cost and does not infer a purchase cost', () => {
    const defaults = getProductFormDefaults({ activeRubro: 'abarrotes', productToEdit: {
      saleType: 'unit', cost: 10, conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 12 }
    } });
    expect(defaults).toMatchObject({ saleMode: 'fractioned', cost: 10, conversionFactor: { purchaseUnit: 'caja', factor: 12, purchaseCost: '' } });
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
    expect(validateProductForm(base({ stock: 0, expirationMode: 'STRICT', pharmacyKind: 'medicine' }), { activeRubro: 'farmacia' }).fieldErrors.manufacturerBatchId).toBeUndefined();
    const result = validateProductForm(base({ stock: 1, expirationMode: 'STRICT', pharmacyKind: 'medicine' }), { activeRubro: 'farmacia' });
    expect(result.fieldErrors.manufacturerBatchId).toBeTruthy();
    expect(result.fieldErrors.expiryDate).toBeTruthy();
  });

  it('requires an explicit medicine or other pharmacy article type for new records', () => {
    expect(validateProductForm(base({ stock: 0, pharmacyKind: '' }), { activeRubro: 'farmacia' }).fieldErrors.pharmacyKind)
      .toMatch(/Selecciona si se trata de un medicamento u otro producto/);
    expect(validateProductForm(base({ stock: 0, pharmacyKind: 'other' }), { activeRubro: 'farmacia' }).fieldErrors.pharmacyKind)
      .toBeUndefined();
  });

  it('requires a valid, unique structured composition for a new pharmacy medicine', () => {
    const empty = validateProductForm(base({ stock: 0, pharmacyKind: 'medicine' }), { activeRubro: 'farmacia' });
    expect(empty.fieldErrors.compositionIngredients).toBeTruthy();
    const complete = [{ activeIngredientId: 'ai-1', name: 'Aspirina', amount: '125.5', unit: 'mg', basisAmount: 1, basisUnit: 'tableta' }];
    expect(validateProductForm(base({ stock: 0, pharmacyKind: 'medicine', compositionIngredients: complete }), { activeRubro: 'farmacia' }).fieldErrors.compositionIngredients).toBeUndefined();
    expect(validateProductForm(base({ stock: 0, pharmacyKind: 'medicine', compositionIngredients: [...complete, ...complete] }), { activeRubro: 'farmacia' }).fieldErrors.compositionIngredients).toMatch(/una vez/);
  });

  it('requires normalized units, an explicit compatible base, dosage form and package for new medicine', () => {
    const compositionIngredients = [{
      activeIngredientId: 'ai-1', name: 'Aspirina', amount: '125.5', unit: 'mg', basisAmount: '1', basisUnit: 'tableta'
    }];
    const incomplete = validateProductForm(base({
      stock: 0, pharmacyKind: 'medicine', compositionIngredients
    }), { activeRubro: 'farmacia' });
    expect(incomplete.fieldErrors.dosageFormCode).toBeTruthy();
    expect(incomplete.fieldErrors.commercialPresentation).toBeTruthy();

    const complete = validateProductForm(base({
      stock: 0, pharmacyKind: 'medicine', compositionIngredients,
      dosageFormCode: 'tablet', packageType: 'box', packageContentAmount: '10', packageContentUnit: 'tableta'
    }), { activeRubro: 'farmacia' });
    expect(complete.fieldErrors).not.toHaveProperty('compositionIngredients');
    expect(complete.fieldErrors).not.toHaveProperty('dosageFormCode');
    expect(complete.fieldErrors).not.toHaveProperty('commercialPresentation');

    const ambiguousBase = validateProductForm(base({
      stock: 0, pharmacyKind: 'medicine', dosageFormCode: 'tablet', packageType: 'box',
      packageContentAmount: 10, packageContentUnit: 'tableta',
      compositionIngredients: [{ ...compositionIngredients[0], basisUnit: '' }]
    }), { activeRubro: 'farmacia' });
    expect(ambiguousBase.fieldErrors.compositionIngredients).toBeTruthy();

    const incompatiblePercentage = validateProductForm(base({
      stock: 0, pharmacyKind: 'medicine', dosageFormCode: 'cream', packageType: 'tube',
      packageContentAmount: 30, packageContentUnit: 'g',
      compositionIngredients: [{ ...compositionIngredients[0], unit: '% m/m', basisUnit: 'mL' }]
    }), { activeRubro: 'farmacia' });
    expect(incompatiblePercentage.fieldErrors.compositionIngredients).toMatch(/compatibles/);
  });

  it('keeps historical pharmacy text and unknown F01 composition units readable and editable', () => {
    const productToEdit = {
      id: 'legacy-pharmacy', rubroContext: 'farmacia', name: 'Medicamento histórico', price: 25, cost: 10,
      stock: 4, presentation: 'Caja texto anterior',
      metadata: { pharmacy: {
        kind: 'medicine', dosageForm: 'Liberación prolongada (texto anterior)',
        composition: { version: 1, activeIngredients: [{
          activeIngredientId: 'ai-legacy', name: 'Principio anterior', amount: 2.5,
          unit: 'unidad de concentración anterior', basisAmount: 1, basisUnit: 'envase anterior'
        }] }
      } }
    };
    const defaults = getProductFormDefaults({ activeRubro: 'farmacia', productToEdit });
    expect(defaults).toMatchObject({
      dosageFormCode: '', dosageForm: 'Liberación prolongada (texto anterior)',
      dosageFormLegacy: 'Liberación prolongada (texto anterior)', presentationLegacy: 'Caja texto anterior'
    });
    expect(validateProductForm({ ...base(), ...defaults }, {
      activeRubro: 'farmacia', isEditing: true, productToEdit
    }).fieldErrors).toEqual({});

    const payload = buildProductFormPayload({ ...base(), ...defaults }, { activeRubro: 'farmacia', productToEdit });
    expect(payload.metadata.pharmacy).toMatchObject({
      dosageForm: 'Liberación prolongada (texto anterior)',
      composition: { activeIngredients: [{
        unit: 'unidad de concentración anterior', basisUnit: 'envase anterior', amount: 2.5
      }] }
    });
    expect(payload.presentation).toBe('Caja texto anterior');
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

  it('preserves new-product initial stock and stores fractioned purchase data with unit cost authority', () => {
    const payload = buildProductFormPayload(base({ stock: 24, saleMode: 'fractioned', unit: 'pza', price: 15, conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 12, purchaseCost: 120 } }), { activeRubro: 'abarrotes' });
    expect(payload.stock).toBe(24);
    expect(payload.saleType).toBe('unit');
    expect(payload.cost).toBe(10);
    expect(payload.price).toBe(15);
    expect(payload.conversionFactor).toEqual({ enabled: true, purchaseUnit: 'caja', factor: 12, purchaseCost: 120 });
    expect(getProductFormDefaults({ activeRubro: 'abarrotes', productToEdit: payload })).toMatchObject({
      saleMode: 'fractioned', cost: 10, price: 15, conversionFactor: { purchaseUnit: 'caja', factor: 12, purchaseCost: 120 }
    });
  });

  it('persists bulk kg in bulkData.sale and keeps the canonical value through defaults', () => {
    const payload = buildProductFormPayload(base({ saleMode: 'bulk', unit: 'kg' }), { activeRubro: 'abarrotes' });
    expect(payload).toMatchObject({ saleType: 'bulk', unit: 'kg', bulkData: { sale: { unit: 'kg' } } });
    expect(getProductFormDefaults({ activeRubro: 'abarrotes', productToEdit: payload })).toMatchObject({ saleMode: 'bulk', saleType: 'bulk', unit: 'kg' });
  });

  it('stores normalized pharmacy form and package metadata without changing commercial or stock fields', () => {
    const productToEdit = {
      id: 'medicine-1', name: 'Medicamento', stock: 18, saleType: 'unit', unit: 'pza', cost: 32, price: 49,
      sku: 'MED-1', barcode: '750000000001', presentation: 'Caja anterior',
      metadata: { pharmacy: { kind: 'medicine', dosageForm: 'Forma histórica' } }
    };
    const values = getProductFormDefaults({ activeRubro: 'farmacia', productToEdit });
    const payload = buildProductFormPayload({
      ...base({ stock: 18, unit: 'pza', cost: 32, price: 49 }),
      ...values,
      dosageFormCode: 'tablet', packageType: 'box', packageContentAmount: '10.5', packageContentUnit: 'tableta'
    }, { activeRubro: 'farmacia', productToEdit });
    expect(payload).toMatchObject({
      stock: 18, unit: 'pza', cost: 32, price: 49, sku: 'MED-1', barcode: '750000000001',
      presentation: 'Caja con 10.5 tabletas',
      metadata: { pharmacy: {
        dosageFormCode: 'tablet', dosageForm: 'Tableta', dosageFormLegacy: 'Forma histórica',
        commercialPresentation: {
          version: 1, packageType: 'box', contentAmount: 10.5, contentUnit: 'tableta',
          legacyDescription: 'Caja anterior'
        }
      } }
    });
  });

  it('records new F02 fields when editing an unclassified historical medicine without a prior pharmacy object', () => {
    const productToEdit = {
      id: 'legacy-medicine-without-pharmacy-metadata', name: 'Medicamento histórico QA',
      stock: 7, saleType: 'unit', unit: 'pza', cost: 12.5, price: 24,
      presentation: 'Caja de texto histórico', isActive: true,
      prescriptionType: 'otc', requiresPrescription: false, metadata: { custom: 'preservar' }
    };
    const values = {
      ...base({ stock: 7, unit: 'pza', cost: 12.5, price: 24 }),
      ...getProductFormDefaults({ activeRubro: 'farmacia', productToEdit }),
      pharmacyKind: 'medicine', sanitaryFraction: '', isAntibiotic: false,
      dosageFormCode: 'suspension', packageType: 'bottle',
      packageContentAmount: '120.5', packageContentUnit: 'mL',
      compositionIngredients: [], compositionTouched: false
    };
    const payload = buildProductFormPayload(values, { activeRubro: 'farmacia', productToEdit });

    expect(payload.metadata).toMatchObject({
      custom: 'preservar',
      pharmacy: {
        kind: 'medicine', fraction: null, status: 'pending',
        dosageFormCode: 'suspension', dosageForm: 'Suspensión',
        commercialPresentation: {
          version: 1, packageType: 'bottle', contentAmount: 120.5, contentUnit: 'mL',
          legacyDescription: 'Caja de texto histórico'
        }
      }
    });
    expect(payload).toMatchObject({
      stock: 7, unit: 'pza', cost: 12.5, price: 24,
      presentation: 'Frasco con 120.5 mL', isActive: true,
      prescriptionType: 'otc', requiresPrescription: false
    });
  });

  it('defensively serializes produce sale modes with coherent canonical units', () => {
    const piece = buildProductFormPayload(base({ saleMode: 'unit', saleType: 'unit', unit: 'kg' }), { activeRubro: 'verduleria/fruteria' });
    expect(piece).toMatchObject({ saleType: 'unit', unit: 'pza' });

    const weight = buildProductFormPayload(base({ saleMode: 'bulk', saleType: 'unit', unit: 'pza' }), { activeRubro: 'verduleria/fruteria' });
    expect(weight).toMatchObject({ saleType: 'bulk', unit: 'kg', bulkData: { sale: { unit: 'kg' } } });

    const grams = buildProductFormPayload(base({ saleMode: 'bulk', saleType: 'bulk', unit: 'g' }), { activeRubro: 'verduleria/fruteria' });
    expect(grams).toMatchObject({ saleType: 'bulk', unit: 'g', bulkData: { sale: { unit: 'g' } } });
  });

  it.each(['mt', 'cm'])('persists hardware %s measurement sales as bulk with the canonical unit', (unit) => {
    const payload = buildProductFormPayload(base({ saleMode: 'bulk', unit }), { activeRubro: 'hardware' });
    expect(payload).toMatchObject({ rubroContext: 'hardware', saleType: 'bulk', unit, bulkData: { sale: { unit } } });
  });

  it('preserves hardware fractioned conversion data and deactivates it when returning to unit sales', () => {
    const fractioned = buildProductFormPayload(base({ saleMode: 'fractioned', unit: 'pza', conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 100, purchaseCost: 250 } }), { activeRubro: 'hardware' });
    expect(fractioned).toMatchObject({ saleType: 'unit', unit: 'pza', conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 100, purchaseCost: 250 } });

    const unit = buildProductFormPayload(base({ saleMode: 'unit', unit: 'pza', conversionFactor: fractioned.conversionFactor }), { activeRubro: 'hardware' });
    expect(unit).toMatchObject({ saleType: 'unit', unit: 'pza', conversionFactor: { enabled: false, purchaseUnit: 'caja', factor: 100 } });
    expect(unit.conversionFactor.enabled).toBe(false);
  });

  it('requires a purchase unit and a factor greater than one for fractioned sales', () => {
    const invalid = validateProductForm(base({ saleMode: 'fractioned', conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 1, purchaseCost: 0 } }));
    expect(invalid.fieldErrors.conversionFactor).toMatch(/contiene/i);
    expect(invalid.fieldErrors.purchaseCost).toMatch(/cuesta/i);
    const valid = validateProductForm(base({ saleMode: 'fractioned', conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 12, purchaseCost: 120 } }));
    expect(valid.fieldErrors.conversionFactor).toBeUndefined();
    expect(valid.fieldErrors.purchaseUnit).toBeUndefined();
    expect(valid.fieldErrors.purchaseCost).toBeUndefined();
  });

  it('calculates fractioned cost and margin from the sellable unit, never from the purchase presentation', () => {
    expect(calculateFractionedUnitCost({ purchaseCost: 120, factor: 12 })).toBe(10);
    expect(calculateSaleMargin({ cost: 10, price: 15 })).toBeCloseTo(33.333, 2);
  });

  it('uses the calculated product cost when validating fractioned wholesale tiers', () => {
    const product = buildProductFormPayload(base({ saleMode: 'fractioned', price: 15, conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 12, purchaseCost: 120 }, wholesaleTiers: [{ min: 6, price: 12 }] }), { activeRubro: 'abarrotes' });
    expect(product.cost).toBe(10);
    expect(validateWholesaleCondition(product, 6)).toMatchObject({ status: 'ok' });
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
