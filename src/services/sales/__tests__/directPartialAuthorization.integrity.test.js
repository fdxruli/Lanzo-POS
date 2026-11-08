import { describe, expect, it } from 'vitest';
import {
  captureDirectPartialAuthorization,
  matchesDirectPartialAuthorization
} from '../directPartialAuthorization';

const makeContext = () => ({
  order: [{ parentId: 'dish-1', quantity: 2, selectedModifiers: [] }],
  total: 100,
  paymentData: { paymentMethod: 'cash', amountPaid: 100 },
  saleId: 'sale-1',
  attemptId: 'attempt-1',
  actorContext: { actorKey: 'admin:1', tenant: { opaqueId: 'tenant-1' } },
  recipeSnapshot: {
    'dish-1': {
      productId: 'dish-1',
      recipe: [{ ingredientId: 'flour', quantity: 0.15, unit: 'kg' }],
      conversionFactor: { enabled: false }
    }
  }
});

describe('direct partial authorization integrity', () => {
  it('captures the exact product, quantity and modifiers for server reconciliation', () => {
    const context = makeContext();
    const approval = captureDirectPartialAuthorization(context, [{ ingredientId: 'flour', missing: 0.1 }]);
    expect(approval.approvedItems).toEqual([
      { productId: 'dish-1', quantity: 2, selectedModifiers: [] }
    ]);
    expect(matchesDirectPartialAuthorization(approval, context)).toBe(true);
    context.order[0].selectedModifiers.push({ ingredientId: 'new', quantity: 1 });
    expect(approval.approvedItems[0].selectedModifiers).toEqual([]);
    expect(matchesDirectPartialAuthorization(approval, context)).toBe(false);
    context.order[0].quantity = 3;
    expect(matchesDirectPartialAuthorization(approval, context)).toBe(false);
  });

  it('expires approval when a recipe, factor, operation or modifier changes', () => {
    const original = makeContext();
    const approval = captureDirectPartialAuthorization(original, [{ ingredientId: 'flour', missing: 0.1 }]);
    for (const mutate of [
      (c) => { c.recipeSnapshot['dish-1'].recipe[0].quantity = 0.2; },
      (c) => { c.recipeSnapshot['dish-1'].recipe[0].unit = 'g'; },
      (c) => { c.recipeSnapshot['dish-1'].recipe[0].ingredientId = 'other'; },
      (c) => { c.recipeSnapshot['dish-1'].conversionFactor = { enabled: true, factor: 2 }; },
      (c) => { c.order[0].selectedModifiers = [{ ingredientId: 'tomato', quantity: 1 }]; },
      (c) => { c.paymentData.amountPaid = 90; },
      (c) => { c.attemptId = 'attempt-2'; }
    ]) {
      const changed = makeContext();
      mutate(changed);
      expect(matchesDirectPartialAuthorization(approval, changed)).toBe(false);
    }
  });
});
