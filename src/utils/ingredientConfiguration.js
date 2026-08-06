export const getRecipeIngredientId = (item) => (
  item?.ingredientId || item?.productId || null
);

export const getIngredientDefaultUnit = (ingredient) => (
  ingredient?.unit
  || ingredient?.bulkData?.purchase?.unit
  || ingredient?.bulkData?.unit
  || ingredient?.measurementUnit
  || ingredient?.saleUnit
  || (ingredient?.saleType === 'unit' ? 'pza' : 'kg')
);
