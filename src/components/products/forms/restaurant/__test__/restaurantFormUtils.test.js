import { describe, expect, it } from 'vitest';
import {
  buildRestaurantPayload,
  calculateRecipeCost,
  findInvalidModifierGroup,
  hasEmptyModifierOption
} from '../restaurantFormUtils';

describe('restaurantFormUtils', () => {
  it('calculates recipe cost from estimatedCost', () => {
    const total = calculateRecipeCost([
      { estimatedCost: 10 },
      { estimatedCost: 2.5 },
      { estimatedCost: 0 }
    ]);
    expect(total).toBe(12.5);
  });

  it('detects invalid modifier group without options', () => {
    const invalid = findInvalidModifierGroup([
      { name: 'Salsas', options: [{ name: 'Verde' }] },
      { name: 'Extras', options: [] }
    ]);

    expect(invalid?.name).toBe('Extras');
  });

  it('detects empty modifier option names', () => {
    const hasEmpty = hasEmptyModifierOption([
      { options: [{ name: 'Queso' }, { name: '' }] }
    ]);

    expect(hasEmpty).toBe(true);
  });

  it('builds payload for sellable product with recipe', () => {
    const payload = buildRestaurantPayload({
      productId: 'prod-1',
      commonData: { stock: 8, saleType: 'bulk' },
      activeRubroContext: 'food_service',
      productType: 'sellable',
      recipe: [{ ingredientId: 'ing-1', quantity: 1 }],
      printStation: 'kitchen',
      prepTime: '15',
      modifiers: [],
      productToEdit: null
    });

    expect(payload).toMatchObject({
      id: 'prod-1',
      stock: 0,
      rubroContext: 'food_service',
      productType: 'sellable',
      saleType: 'unit',
      recipe: [{ ingredientId: 'ing-1', quantity: 1 }],
      batchManagement: { enabled: false }
    });
  });

  it('builds payload for ingredient product', () => {
    const payload = buildRestaurantPayload({
      productId: 'prod-2',
      commonData: { stock: 4, saleType: 'unit' },
      activeRubroContext: 'food_service',
      productType: 'ingredient',
      recipe: [{ ingredientId: 'ing-1', quantity: 1 }],
      printStation: 'kitchen',
      prepTime: '',
      modifiers: [],
      productToEdit: { id: 'prod-2' }
    });

    expect(payload).toMatchObject({
      id: 'prod-2',
      stock: 4,
      productType: 'ingredient',
      recipe: [],
      saleType: 'unit',
      batchManagement: { enabled: true }
    });
  });
});

