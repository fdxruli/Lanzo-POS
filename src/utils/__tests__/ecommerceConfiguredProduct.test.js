import { describe, expect, it } from 'vitest';
import {
  buildEcommerceConfiguredCartLine,
  buildEcommerceConfiguredLineKey,
  buildMinimalConfiguredOrderItem,
  calculateEcommerceConfiguredPrice,
  canonicalizeEcommerceSelections,
  findEcommerceVariant,
  getEcommerceVariantAxes,
  isEcommerceVariantValueAvailable,
  normalizePublicProductConfiguration,
  reconcileEcommerceVariantAttributes,
  validateEcommerceConfiguration
} from '../ecommerceConfiguredProduct';

const detail = normalizePublicProductConfiguration({
  success: true,
  catalogRevision: 12,
  product: {
    id: 'product-1', name: 'Tenis Urban', currency: 'MXN', basePrice: 100,
    configurationType: 'variant_parent', configurationVersion: 4,
    requiresConfiguration: true, hasVariants: true, hasOptionGroups: true,
    isAvailable: true
  },
  variants: [
    { id: 'variant-black-26', publicName: 'Negro / 26', optionValues: { color: 'Negro', talla: '26' }, priceMode: 'delta', priceValue: 20, isAvailable: true, stock: { mode: 'exact', quantity: 2 } },
    { id: 'variant-black-27', publicName: 'Negro / 27', optionValues: { color: 'Negro', talla: '27' }, priceMode: 'absolute', priceValue: 160, isAvailable: false },
    { id: 'variant-white-27', publicName: 'Blanco / 27', optionValues: { color: 'Blanco', talla: '27' }, priceMode: 'base', priceValue: 0, isAvailable: true }
  ],
  groups: [
    { id: 'group-laces', publicName: 'Agujetas', selectionType: 'single', required: true, minSelect: 1, maxSelect: 1, options: [
      { id: 'option-black', publicName: 'Negras', priceDelta: 0, isAvailable: true },
      { id: 'option-red', publicName: 'Rojas', priceDelta: 15, isAvailable: true }
    ] },
    { id: 'group-extras', publicName: 'Extras', selectionType: 'multiple', required: false, minSelect: 0, maxSelect: 2, options: [
      { id: 'option-protector', publicName: 'Protector', priceDelta: 10, isAvailable: true },
      { id: 'option-bag', publicName: 'Bolsa', priceDelta: 25, isAvailable: false }
    ] }
  ]
});

const validSelections = [
  { groupId: 'group-laces', optionIds: ['option-red'] },
  { groupId: 'group-extras', optionIds: ['option-protector'] }
];

describe('ecommerceConfiguredProduct', () => {
  it('normalizes public detail without private fields', () => {
    expect(detail.product).toMatchObject({ id: 'product-1', configurationVersion: 4 });
    expect(JSON.stringify(detail)).not.toContain('sourceIngredientId');
  });

  it('derives variant attributes and valid concrete combinations', () => {
    expect(getEcommerceVariantAxes(detail)).toEqual([
      { attribute: 'color', values: ['Blanco', 'Negro'] },
      { attribute: 'talla', values: ['26', '27'] }
    ]);
    expect(findEcommerceVariant(detail, { color: 'Negro', talla: '26' })?.id).toBe('variant-black-26');
    expect(findEcommerceVariant(detail, { color: 'Negro', talla: '27' })).toBeNull();
  });

  it('disables attribute values that cannot create an available variant', () => {
    expect(isEcommerceVariantValueAvailable(detail, { color: 'Negro' }, 'talla', '27')).toBe(false);
    expect(isEcommerceVariantValueAvailable(detail, { color: 'Blanco' }, 'talla', '27')).toBe(true);
  });

  it('clears only incompatible attributes', () => {
    expect(reconcileEcommerceVariantAttributes(detail, { color: 'Blanco', talla: '26' }, 'color'))
      .toEqual({ color: 'Blanco' });
  });

  it('validates required, single, multiple, min and max groups', () => {
    expect(validateEcommerceConfiguration(detail, { variantId: 'variant-black-26', selections: [] }).errors['group-laces'])
      .toBe('Selecciona una opción.');
    expect(validateEcommerceConfiguration(detail, {
      variantId: 'variant-black-26',
      selections: [{ groupId: 'group-laces', optionIds: ['option-black', 'option-red'] }]
    }).errors['group-laces']).toBe('Selecciona una sola opción.');
    expect(validateEcommerceConfiguration(detail, { variantId: 'variant-black-26', selections: validSelections }).valid).toBe(true);
  });

  it('rejects unavailable options and variants locally for UX', () => {
    expect(validateEcommerceConfiguration(detail, { variantId: 'variant-black-27', selections: validSelections }).valid).toBe(false);
    expect(validateEcommerceConfiguration(detail, {
      variantId: 'variant-black-26',
      selections: [{ groupId: 'group-laces', optionIds: ['option-black'] }, { groupId: 'group-extras', optionIds: ['option-bag'] }]
    }).errors['group-extras']).toBe('Esta opción ya no está disponible.');
  });

  it('calculates base, delta, absolute and extras with two-decimal money', () => {
    expect(calculateEcommerceConfiguredPrice(detail, { variantId: 'variant-black-26', selections: validSelections }))
      .toEqual({ baseUnitPrice: 100, variantAdjustment: 20, optionsAdjustment: 25, finalUnitPrice: 145 });
    expect(calculateEcommerceConfiguredPrice(detail, { variantId: 'variant-black-27', selections: [{ groupId: 'group-laces', optionIds: ['option-black'] }] }))
      .toEqual({ baseUnitPrice: 100, variantAdjustment: 60, optionsAdjustment: 0, finalUnitPrice: 160 });
  });

  it('builds a deterministic line key independent from option order', () => {
    const left = buildEcommerceConfiguredLineKey({ productId: 'p', variantId: 'v', selections: [
      { groupId: 'g2', optionIds: ['b', 'a'] }, { groupId: 'g1', optionIds: ['c'] }
    ] });
    const right = buildEcommerceConfiguredLineKey({ productId: 'p', variantId: 'v', selections: [
      { groupId: 'g1', optionIds: ['c'] }, { groupId: 'g2', optionIds: ['a', 'b'] }
    ] });
    expect(left).toBe(right);
    expect(canonicalizeEcommerceSelections([{ groupId: 'g', optionIds: ['b', 'a', 'a'] }]))
      .toEqual([{ groupId: 'g', optionIds: ['a', 'b'] }]);
  });

  it('keeps different configurations as different keys', () => {
    expect(buildEcommerceConfiguredLineKey({ productId: 'p', variantId: 'v1' }))
      .not.toBe(buildEcommerceConfiguredLineKey({ productId: 'p', variantId: 'v2' }));
  });

  it('builds a configured cart line and clamps quantity to exact variant stock', () => {
    const line = buildEcommerceConfiguredCartLine(detail, {
      variantId: 'variant-black-26', selections: validSelections, quantity: 8, maxItemQuantity: 99
    });
    expect(line).toMatchObject({ success: true, productId: 'product-1', quantity: 2, maxQuantity: 2, estimatedUnitPrice: 145 });
    expect(line.configurationSnapshot.variant.name).toBe('Negro / 26');
    expect(line.display.groups[0].options).toEqual(['Rojas']);
  });

  it('creates a minimal server payload without client prices or names', () => {
    const line = buildEcommerceConfiguredCartLine(detail, {
      variantId: 'variant-black-26', selections: validSelections, quantity: 1
    });
    expect(buildMinimalConfiguredOrderItem({ productId: line.lineKey, quantity: 1, price: 999 })).toEqual({
      productId: 'product-1', quantity: 1, variantId: 'variant-black-26',
      selections: canonicalizeEcommerceSelections(validSelections)
    });
  });
});
