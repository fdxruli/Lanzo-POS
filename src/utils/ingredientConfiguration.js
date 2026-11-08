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


// A recipe stores quantities in each ingredient's inventory unit. Reject
// ambiguous legacy unit mismatches rather than silently double-converting them.
export const assertValidRecipeReferences = (recipe, ingredientRecords, { productId = null, licenseId = null } = {}) => {
  if (!Array.isArray(recipe)) throw new Error('La receta no tiene un formato vÃ¡lido.');
  const byId = new Map((ingredientRecords || []).filter(Boolean).map((ingredient) => [ingredient.id, ingredient]));
  const seen = new Set();
  for (const item of recipe) {
    const ingredientId = getRecipeIngredientI¶»§q«^