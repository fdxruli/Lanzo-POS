import { describe, expect, it } from 'vitest';
import { evaluateEcommerceRecipeAvailability } from '../ecommerceRecipeAvailability';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const map = (...products) => new Map(products.map((product) => [product.id, product]));
const ingredient = (id, stock, overrides = {}) => ({
  id,
  name: id,
  stock,
  committedStock: 0,
  trackStock: true,
  unit: 'pza',
  isActive: true,
  ...overrides
});

describe('ecommerceRecipeAvailability', () => {
  it('calcula el minimo y el ingrediente limitante', () => {
    const result = evaluateEcommerceRecipeAvailability({
      product: {
        recipe: [
          { ingredientId: 'pan', quantity: 1, unit: 'pza' },
          { ingredientId: 'carne', quantity: 150, unit: 'g' },
          { ingredientId: 'queso', quantity: 1, unit: 'pza' }
        ]
      },
      ingredientsById: map(
        ingredient('pan', 20),
        ingredient('carne', 1.5, { unit: 'kg' }),
        ingredient('queso', 12)
      ),
      now: NOW
    });
    expect(result).toMatchObject({
      verified: true,
      status: 'in_stock',
      availableStock: 10,
      limitingIngredientId: 'carne',
      reasonCode: 'RECIPE_CAPACITY_CALCULATED'
    });
  });

  it('distingue cero confirmado de unverified', () => {
    const result = evaluateEcommerceRecipeAvailability({
      product: {
        recipe: [
          { ingredientId: 'pan', quantity: 1, unit: 'pza' },
          { ingredientId: 'missing', quantity: 1, unit: 'pza' }
        ]
      },
      ingredientsById: map(ingredient('pan', 0)),
      now: NOW
    });
    expect(result).toMatchObject({
      verified: true,
      status: 'out_of_stock',
      availableStock: 0,
      limitingIngredientId: 'pan'
    });
    expect(result.diagnostics).toContain('RECIPE_INGREDIENT_MISSING');
  });

  it('reporta ingrediente faltante', () => {
    const result = evaluateEcommerceRecipeAvailability({
      product: { recipe: [{ ingredientId: 'missing', quantity: 1, unit: 'pza' }] },
      ingredientsById: new Map(),
      now: NOW
    });
    expect(result).toMatchObject({
      verified: false,
      status: 'unverified',
      reasonCode: 'RECIPE_INGREDIENT_MISSING'
    });
  });

  it('reporta ingrediente inactivo', () => {
    const result = evaluateEcommerceRecipeAvailability({
      product: { recipe: [{ ingredientId: 'pan', quantity: 1, unit: 'pza' }] },
      ingredientsById: map(ingredient('pan', 10, { isActive: false })),
      now: NOW
    });
    expect(result.reasonCode).toBe('RECIPE_INGREDIENT_INACTIVE');
  });

  it('rechaza cantidad invalida', () => {
    const result = evaluateEcommerceRecipeAvailability({
      product: { recipe: [{ ingredientId: 'pan', quantity: 0, unit: 'pza' }] },
      ingredientsById: map(ingredient('pan', 10)),
      now: NOW
    });
    expect(result.reasonCode).toBe('RECIPE_QUANTITY_INVALID');
  });

  it('convierte kg/g con precision decimal', () => {
    const result = evaluateEcommerceRecipeAvailability({
      product: { recipe: [{ ingredientId: 'carne', quantity: 0.15, unit: 'kg' }] },
      ingredientsById: map(ingredient('carne', 1500, { unit: 'g' })),
      now: NOW
    });
    expect(result.availableStock).toBe(10);
  });

  it('convierte lt/ml', () => {
    const result = evaluateEcommerceRecipeAvailability({
      product: { recipe: [{ ingredientId: 'salsa', quantity: 80, unit: 'ml' }] },
      ingredientsById: map(ingredient('salsa', 1, { unit: 'lt' })),
      now: NOW
    });
    expect(result.availableStock).toBe(12);
  });

  it('rechaza unidades incompatibles', () => {
    const result = evaluateEcommerceRecipeAvailability({
      product: { recipe: [{ ingredientId: 'pan', quantity: 100, unit: 'g' }] },
      ingredientsById: map(ingredient('pan', 10, { unit: 'pza' })),
      now: NOW
    });
    expect(result.reasonCode).toBe('RECIPE_UNIT_INCOMPATIBLE');
  });

  it('descuenta committed stock', () => {
    const result = evaluateEcommerceRecipeAvailability({
      product: { recipe: [{ ingredientId: 'pan', quantity: 1, unit: 'pza' }] },
      ingredientsById: map(ingredient('pan', 10, { committedStock: 4 })),
      now: NOW
    });
    expect(result.availableStock).toBe(6);
  });

  it('respeta FEFO, excluye vencidos y bloqueados y acepta vence hoy', () => {
    const result = evaluateEcommerceRecipeAvailability({
      product: { recipe: [{ ingredientId: 'carne', quantity: 1, unit: 'kg' }] },
      ingredientsById: map(ingredient('carne', 0, {
        unit: 'kg',
        batchManagement: { enabled: true },
        expirationMode: 'STRICT'
      })),
      batches: [
        { id: 'expired', productId: 'carne', stock: 20, expiryDate: '2026-07-14', isActive: true },
        { id: 'blocked', productId: 'carne', stock: 20, expiryDate: '2026-07-20', isActive: true, status: 'blocked' },
        { id: 'today', productId: 'carne', stock: 3, committedStock: 1, expiryDate: '2026-07-15', isActive: true },
        { id: 'future', productId: 'carne', stock: 4, expiryDate: '2026-07-20', isActive: true }
      ],
      now: NOW
    });
    expect(result.availableStock).toBe(6);
    expect(result.components[0].batches.map((batch) => batch.batchId)).toEqual([
      'today',
      'future'
    ]);
  });

  it('no deja que un ingrediente no controlado limite', () => {
    const result = evaluateEcommerceRecipeAvailability({
      product: {
        recipe: [
          { ingredientId: 'sal', quantity: 1, unit: 'g' },
          { ingredientId: 'pan', quantity: 1, unit: 'pza' }
        ]
      },
      ingredientsById: map(
        ingredient('sal', 0, { unit: 'g', trackStock: false }),
        ingredient('pan', 8)
      ),
      now: NOW
    });
    expect(result.availableStock).toBe(8);
  });

  it('produce not_tracked cuando todos los ingredientes son no controlados', () => {
    const result = evaluateEcommerceRecipeAvailability({
      product: { recipe: [{ ingredientId: 'sal', quantity: 1, unit: 'g' }] },
      ingredientsById: map(ingredient('sal', 0, { unit: 'g', trackStock: false })),
      now: NOW
    });
    expect(result).toMatchObject({
      verified: true,
      status: 'not_tracked',
      availableStock: null
    });
  });

  it('reporta lectura de lotes fallida', () => {
    const result = evaluateEcommerceRecipeAvailability({
      product: { recipe: [{ ingredientId: 'carne', quantity: 1, unit: 'kg' }] },
      ingredientsById: map(ingredient('carne', 1, {
        unit: 'kg',
        batchManagement: { enabled: true }
      })),
      batchReadFailed: true,
      now: NOW
    });
    expect(result.reasonCode).toBe('RECIPE_BATCH_READ_FAILED');
  });

  it('no modifica producto, ingredientes ni lotes', () => {
    const product = { recipe: [{ ingredientId: 'pan', quantity: 1, unit: 'pza' }] };
    const pan = ingredient('pan', 2);
    const before = JSON.stringify({ product, pan });
    evaluateEcommerceRecipeAvailability({
      product,
      ingredientsById: map(pan),
      now: NOW
    });
    expect(JSON.stringify({ product, pan })).toBe(before);
  });
});
