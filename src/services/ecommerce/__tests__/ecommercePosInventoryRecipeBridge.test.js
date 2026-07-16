import { describe, expect, it } from 'vitest';
import { ecommercePosInventoryRecipeBridgeInternals } from '../ecommercePosInventoryResolution';

const parent = {
  id: 'papas',
  name: 'Papas',
  price: 45,
  trackStock: false,
  recipe: [
    { ingredientId: 'papa', quantity: 0.25 },
    { ingredientId: 'salsa', quantity: 0.02 }
  ]
};
const papa = { id: 'papa', name: 'Papa', trackStock: true, stock: 1, committedStock: 0 };
const salsa = { id: 'salsa', name: 'Salsa', trackStock: true, stock: 1, committedStock: 0 };
const queso = { id: 'queso', name: 'Queso', trackStock: true, stock: 0.1, committedStock: 0 };

const order = {
  items: [{
    id: 'papas',
    quantity: 1,
    selectedModifiers: [{
      id: 'queso-extra',
      name: 'Queso extra',
      ingredientId: 'queso',
      quantity: 0.05,
      ingredientQuantity: 0.05,
      tracksInventory: true
    }]
  }]
};

const buildDeps = (products) => {
  const map = new Map(products.map((product) => [product.id, product]));
  return {
    loadData: async (_store, id) => map.get(id) || null,
    loadMultipleData: async (_store, ids) => ids.map((id) => map.get(id) || null),
    queryBatchesByProductIdAndActive: async () => [],
    STORES: { MENU: 'menu', PRODUCT_BATCHES: 'productBatches' }
  };
};

describe('ecommerce POS recipe inventory bridge', () => {
  it('validates recipe ingredients and the selected cheese extra together', async () => {
    const products = [parent, papa, salsa, queso];
    const result = await ecommercePosInventoryRecipeBridgeInternals.validateRecipeAndConfiguredInventory({
      order,
      products,
      deps: buildDeps(products)
    });

    expect(result).toEqual({ ok: true });
  });

  it('keeps the order blocked when the selected extra ingredient is insufficient', async () => {
    const products = [parent, papa, salsa, { ...queso, stock: 0.01 }];
    const result = await ecommercePosInventoryRecipeBridgeInternals.validateRecipeAndConfiguredInventory({
      order,
      products,
      deps: buildDeps(products)
    });

    expect(result.ok).toBe(false);
    expect(result.response.errorType).toBe('STOCK_WARNING');
    expect(result.response.missingData).toEqual(expect.arrayContaining([
      expect.objectContaining({ ingredientName: 'Queso' })
    ]));
  });

  it('normalizes a verified recipe parent for the legacy direct-stock resolver', () => {
    const safeProduct = ecommercePosInventoryRecipeBridgeInternals.buildRecipeSafeProduct(parent);
    const safeItem = ecommercePosInventoryRecipeBridgeInternals.buildRecipeSafeItem({ ...order.items[0], recipe: parent.recipe });

    expect(safeProduct).toMatchObject({ recipe: [], trackStock: false, ecommerceRecipeSource: true });
    expect(safeItem).toMatchObject({ recipe: [], trackStock: false, ecommerceRecipeSource: true });
    expect(safeItem.ecommerceOriginalRecipe).toEqual(parent.recipe);
  });
});
