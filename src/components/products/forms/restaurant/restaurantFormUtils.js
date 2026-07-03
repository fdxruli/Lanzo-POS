import {
  findInvalidModifierGroupForSave,
  findInvalidModifierOptionForSave,
  normalizeModifierGroups
} from '../../../../utils/restaurantModifiers';

export const calculateRecipeCost = (recipe = []) => (
  recipe.reduce((acc, item) => acc + (item.estimatedCost || 0), 0)
);

export const findInvalidModifierGroup = (modifiers = []) => (
  findInvalidModifierGroupForSave(modifiers)
);

export const findInvalidModifierOption = (modifiers = []) => (
  findInvalidModifierOptionForSave(modifiers)
);

export const hasEmptyModifierOption = (modifiers = []) => (
  Boolean(findInvalidModifierOption(modifiers))
);

export function buildRestaurantPayload({
  productId,
  commonData,
  activeRubroContext,
  productType,
  recipe,
  printStation,
  prepTime,
  modifiers,
  productToEdit
}) {
  const finalRecipe = productType === 'ingredient' ? [] : recipe;
  const finalModifiers = productType === 'ingredient' ? [] : normalizeModifierGroups(modifiers);
  const hasRecipe = finalRecipe.length > 0; // Agregamos esta validación

  const finalStock = productType === 'ingredient'
    ? commonData.stock
    : (hasRecipe ? 0 : commonData.stock);

  const payload = {
    id: productId,
    ...commonData,
    stock: finalStock,
    // CORRECCIÓN: Si el producto tiene receta, su stock directo NO debe gestionarse.
    trackStock: hasRecipe ? false : commonData.trackStock,
    rubroContext: activeRubroContext,
    productType,
    recipe: finalRecipe,
    printStation,
    prepTime,
    modifiers: finalModifiers,
    saleType: productType === 'sellable' ? 'unit' : (commonData.saleType || 'unit'),
    batchManagement: productType === 'ingredient' ? { enabled: true } : { enabled: false },
    ...(productToEdit ? {} : { createdAt: new Date().toISOString() })
  };

  if (!productToEdit && productType === 'ingredient' && payload.stock === undefined) {
    payload.stock = 0;
  }

  return payload;
}
