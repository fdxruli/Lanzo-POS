import { describe, expect, it } from 'vitest';
import { canAddInventoryEntry, hasInventoryRecipe } from '../inventoryEntryEligibility';

describe('inventory entry eligibility and normalized recipes', () => {
  it.each([
    ['empty array', { recipe: [] }, true],
    ['null recipe', { recipe: null }, true],
    ['missing recipe', {}, true],
    ['recipe ingredients', { recipe: [{ ingredientId: 'rice', quantity: 1 }] }, false]
  ])('treats %s consistently with the inventory write service', (_name, fields, expected) => {
    const product = { id: 'product-1', trackStock: true, ...fields };
    expect(hasInventoryRecipe(product)).toBe(!expected);
    expect(canAddInventoryEntry(product)).toBe(expected);
  });

  it('requires a product identity and enabled stock tracking', () => {
    expect(canAddInventoryEntry({ trackStock: true })).toBe(false);
    expect(canAddInventoryEntry({ id: 'untracked', trackStock: false })).toBe(false);
  });
});
