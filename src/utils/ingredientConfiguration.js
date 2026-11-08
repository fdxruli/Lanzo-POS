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
  if (!Array.isArray(recipe)) throw new Error('La receta no tiene un formato válido.');
  const byId = new Map((ingredientRecords || []).filter(Boolean).map((ingredient) => [ingredient.id, ingredient]));
  const seen = new Set();
  for (const item of recipe) {
    const ingredientId = getRecipeIngredientId(item);
    if (typeof ingredientId !== 'string' || !ingredientId.trim()) {
      throw new Error('La receta tiene un ingrediente sin identificador. Corrígelo antes de guardar.');
    }
    if (ingredientId === productId) throw new Error('Un producto no puede ser ingrediente de sí mismo.');
    if (seen.has(ingredientId)) throw new Error('La receta tiene ingredientes repetidos. Elimina el duplicado.');
    seen.add(ingredientId);
    const ingredient = byId.get(ingredientId);
    const name = ingredient?.name || item?.name || ingredientId;
    if (!ingredient || ingredient.isActive === false || ingredient.deletedAt || ingredient.deletedTimestamp
        || (ingredient.productType || ingredient.product_type) !== 'ingredient') {
      throw new Error('El ingrediente "' + name + '" no existe o no está disponible. Corrige la receta antes de guardar.');
    }
    if (licenseId && (ingredient.licenseId || ingredient.license_id)
        && licenseId !== (ingredient.licenseId || ingredient.license_id)) {
      throw new Error('El ingrediente "' + name + '" pertenece a otro negocio.');
    }
    if (ingredient.trackStock === false) {
      throw new Error('El ingrediente "' + name + '" no tiene control de inventario activo.');
    }
    const quantity = Number(item?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('La cantidad de "' + name + '" debe ser mayor que cero y válida.');
    }
    const storageUnit = getIngredientDefaultUnit(ingredient);
    const itemUnit = item?.unit ? normalizeIngredientUnit(item.unit) : storageUnit;
    if (itemUnit !== storageUnit) {
      throw new Error('La unidad de "' + name + '" (' + itemUnit
        + ') no coincide con su inventario (' + storageUnit + '). Corrige la receta.');
    }
  }
  return true;
};
