export const hasInventoryRecipe = (product) => (
  Array.isArray(product?.recipe) && product.recipe.length > 0
);

/** Share the product-card and write-path definition of an inventory recipe. */
export const canAddInventoryEntry = (product) => Boolean(
  product?.id && product.trackStock !== false && !hasInventoryRecipe(product)
);
