import { describe, expect, it } from 'vitest';
import {
  convertInventoryQuantity,
  createStableConfigurationId,
  detectEcommerceProductConfiguration,
  normalizeEcommerceProductConfiguration,
  normalizeInventoryUnit,
  validateEcommerceProductConfiguration
} from '../ecommerceProductConfiguration';

describe('ecommerceProductConfiguration', () => {
  it('mantiene productos actuales como simple', () => {
    expect(detectEcommerceProductConfiguration({ id: 'simple' })).toEqual({
      type: 'simple',
      version: 1,
      hasRecipe: false,
      hasVariants: false,
      hasOptionGroups: false,
      requiresConfiguration: false,
      tracksDerivedStock: false
    });
  });

  it('detecta recipe sin exigir configuracion publica', () => {
    expect(detectEcommerceProductConfiguration({
      recipe: [{ ingredientId: 'pan', quantity: 1, unit: 'pza' }]
    })).toMatchObject({
      type: 'recipe',
      hasRecipe: true,
      requiresConfiguration: false,
      tracksDerivedStock: true
    });
  });

  it('detecta variant_parent y protege la seleccion', () => {
    expect(detectEcommerceProductConfiguration({
      variants: [{ sourceProductId: 'sku-1', optionValues: { talla: '25' } }]
    })).toMatchObject({
      type: 'variant_parent',
      hasVariants: true,
      requiresConfiguration: true
    });
  });

  it('detecta configurable por grupos', () => {
    expect(detectEcommerceProductConfiguration({
      modifiers: [{ name: 'Extras', options: [] }]
    })).toMatchObject({
      type: 'configurable',
      hasOptionGroups: true,
      requiresConfiguration: false
    });
  });

  it('marca grupos obligatorios como configuracion requerida', () => {
    expect(detectEcommerceProductConfiguration({
      modifiers: [{ name: 'Tamaño', required: true, options: [] }]
    }).requiresConfiguration).toBe(true);
  });

  it('normaliza variantes como combinaciones completas y SKU en mayusculas', () => {
    const config = normalizeEcommerceProductConfiguration({ id: 'tenis' }, {
      variants: [{
        sourceProductId: 'sku-negro-26',
        sku: 'urban-negro-26',
        optionValues: { talla: '26', color: 'Negro' }
      }]
    });
    expect(config.variants[0]).toMatchObject({
      sourceProductId: 'sku-negro-26',
      sku: 'URBAN-NEGRO-26',
      optionValues: { color: 'Negro', talla: '26' }
    });
  });

  it('normaliza grupos, opciones, precio e ingrediente', () => {
    const config = normalizeEcommerceProductConfiguration({ id: 'burger' }, {
      optionGroups: [{
        id: 'extras',
        name: 'Extras',
        multiple: true,
        minSelections: 0,
        maxSelections: 3,
        options: [{
          id: 'queso',
          name: 'Queso',
          price: 15,
          ingredientId: 'ing-cheese',
          ingredientQuantity: 1,
          ingredientUnit: 'pieza'
        }]
      }]
    });
    expect(config.optionGroups[0]).toMatchObject({
      selectionType: 'multiple',
      minSelect: 0,
      maxSelect: 3
    });
    expect(config.optionGroups[0].options[0]).toMatchObject({
      priceDelta: 15,
      sourceIngredientId: 'ing-cheese',
      ingredientQuantity: 1,
      ingredientUnit: 'pza',
      tracksInventory: true
    });
  });

  it('produce IDs estables sin depender de Date.now', () => {
    const first = createStableConfigurationId('option', 'burger', 'extras', 'queso');
    const second = createStableConfigurationId('option', 'burger', 'extras', 'queso');
    expect(first).toBe(second);
    expect(first).toMatch(/^option_[a-z0-9]+$/);
  });

  it('normaliza aliases de unidades', () => {
    expect(normalizeInventoryUnit('PIEZAS')).toBe('pza');
    expect(normalizeInventoryUnit('litros')).toBe('lt');
    expect(normalizeInventoryUnit('gramos')).toBe('g');
  });

  it('convierte kg/g y lt/ml sin mezclar familias', () => {
    expect(convertInventoryQuantity(1.5, 'kg', 'g')).toBe(1500);
    expect(convertInventoryQuantity(2500, 'ml', 'lt')).toBe(2.5);
    expect(convertInventoryQuantity(1, 'pza', 'g')).toBeNull();
  });

  it('valida limites y consistencia', () => {
    const valid = normalizeEcommerceProductConfiguration({ id: 'burger' }, {
      optionGroups: [{
        name: 'Extras',
        options: [{ name: 'Sin cebolla', price: 0 }]
      }]
    });
    expect(validateEcommerceProductConfiguration(valid)).toEqual({
      valid: true,
      errors: []
    });

    const invalid = validateEcommerceProductConfiguration({
      type: 'configurable',
      version: 1,
      variants: [],
      optionGroups: [{
        selectionType: 'single',
        required: true,
        minSelect: 0,
        maxSelect: 2,
        options: [{
          priceDelta: -1,
          tracksInventory: true,
          sourceIngredientId: null,
          ingredientQuantity: 0,
          ingredientUnit: null
        }]
      }]
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual(expect.arrayContaining([
      'ECOMMERCE_OPTION_GROUP_SINGLE_MAX_INVALID',
      'ECOMMERCE_OPTION_GROUP_REQUIRED_MIN_INVALID',
      'ECOMMERCE_OPTION_PRICE_INVALID',
      'ECOMMERCE_OPTION_INVENTORY_INVALID'
    ]));
  });
});
