export const calculateRecipeCost = (recipe = []) => (
  recipe.reduce((acc, item) => acc + (item.estimatedCost || 0), 0)
);

export const findInvalidModifierGroup = (modifiers = []) => (
  modifiers.find((modifier) => (modifier.options || []).length === 0)
);

export const hasEmptyModifierOption = (modifiers = []) => (
  modifiers.some((modifier) => (
    (modifier.options || []).some((option) => !option.name || option.name.trim() === '')
  ))
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
  const finalStock = productType === 'ingredient'
    ? commonData.stock
    : (recipe.length > 0 ? 0 : commonData.stock);

  const payload = {
    id: productId,
    ...commonData,
    stock: finalStock,
    rubroContext: activeRubroContext,
    productType,
    recipe: finalRecipe,
    printStation,
    prepTime,
    modifiers,
    saleType: productType === 'sellable' ? 'unit' : (commonData.saleType || 'unit'),
    batchManagement: productType === 'ingredient' ? { enabled: true } : { enabled: false },
    ...(productToEdit ? {} : { createdAt: new Date().toISOString() })
  };

  if (!productToEdit && productType === 'ingredient' && payload.stock === undefined) {
    payload.stock = 0;
  }

  return payload;
}

