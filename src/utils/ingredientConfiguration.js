import { PRODUCT_SALE_UNITS, normalizeProductUnit } from './productUnitConfiguration';

export const INGREDIENT_UNITS = PRODUCT_SALE_UNITS.filter(({ value }) => (
  ['pza', 'kg', 'g', 'lt', 'ml'].includes(value)
));

export const normalizeIngredientUnit = (value) => {
  return normalizeProductUnit(value) || 'pza';
};

export const getSaleTypeForIngredientUnit = (unit) => (
  normalizeIngredientUnit(unit) === 'pza' ? 'unit' : 'bulk'
);

export const getRecipeIngredientId = (item) => (
  item?.ingredientId || item?.productId || null
);

export const getIngredientDefaultUnit = (ingredient) => {
  const unit = [
    ingredient?.unit,
    ingredient?.bulkData?.purchase?.unit,
    ingredient?.bulkData?.unit,
    ingredient?.measurementUnit,
    ingredient?.saleUnit
  ].find((value) => String(value ?? '').trim());

  return normalizeIngredientUnit(unit || (ingredient?.saleType === 'unit' ? 'pza' : 'kg'));
};
