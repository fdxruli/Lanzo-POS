import { CANONICAL_BUSINESS_TYPES } from '../../../../utils/businessType';
import { getSaleTypeForIngredientUnit, normalizeIngredientUnit } from '../../../../utils/ingredientConfiguration';
import { normalizeExpirationFields, toNumber } from './productFormNormalization';

export function buildProductFormPayload(values, { activeRubro, productToEdit = null } = {}) {
  const isEditing = Boolean(productToEdit?.id);
  const isIngredient = values.restaurantType === 'ingredient';
  const ingredientUnit = isIngredient ? normalizeIngredientUnit(values.unit) : values.unit;
  const saleType = isIngredient ? getSaleTypeForIngredientUnit(ingredientUnit) : values.saleType;
  const sourceBulkData = values.bulkData || productToEdit?.bulkData;
  const bulkData = isIngredient && saleType === 'bulk'
    ? { ...sourceBulkData, purchase: { ...sourceBulkData?.purchase, unit: ingredientUnit } }
    : sourceBulkData;
  const hasVariants = values.hasVariants && values.quickVariants.some((variant) => variant.talla && variant.color);
  const trackStock = Boolean(values.trackStock) && !(activeRubro === CANONICAL_BUSINESS_TYPES.FOOD_SERVICE && values.restaurantType === 'dish');
  const expiration = trackStock ? normalizeExpirationFields(values) : normalizeExpirationFields({ expirationMode: 'NONE' });
  const stock = isEditing ? (productToEdit.stock ?? 0) : (trackStock && !hasVariants ? toNumber(values.stock) : 0);
  const payload = {
    ...(productToEdit || {}),
    id: productToEdit?.id || values.id,
    name: String(values.name || '').trim(), barcode: String(values.barcode || '').trim(), categoryId: values.categoryId || '', description: String(values.description || '').trim(),
    image: values.image || (values.imageRemoved ? null : (productToEdit?.image || null)), imageUploadSource: values.imageUploadSource || null,
    imageRemoved: Boolean(values.imageRemoved),
    price: isIngredient ? 0 : toNumber(values.price), cost: toNumber(values.cost), trackStock, stock,
    minStock: trackStock && values.minStock !== '' ? toNumber(values.minStock) : null,
    maxStock: trackStock && values.maxStock !== '' ? toNumber(values.maxStock) : null,
    saleType, unit: ingredientUnit, supplier: String(values.supplier || '').trim(), location: String(values.location || '').trim(),
    conversionFactor: values.conversionFactor?.enabled ? { enabled: true, purchaseUnit: values.conversionFactor.purchaseUnit?.trim() || '', factor: toNumber(values.conversionFactor.factor) } : { enabled: false, purchaseUnit: '', factor: '' },
    ...expiration,
    hasVariants: activeRubro === CANONICAL_BUSINESS_TYPES.APPAREL ? hasVariants : Boolean(productToEdit?.hasVariants),
    quickVariants: hasVariants ? values.quickVariants.filter((variant) => variant.talla && variant.color).map((variant) => ({ ...variant, stock: toNumber(variant.stock), cost: toNumber(variant.cost, toNumber(values.cost)), price: toNumber(variant.price, toNumber(values.price)) })) : [],
    rubroContext: activeRubro, productType: isIngredient ? 'ingredient' : 'sellable', restaurantType: values.restaurantType,
    recipe: values.restaurantType === 'dish' ? values.recipe : [], modifiers: values.restaurantType === 'dish' ? values.modifiers : []
  };
  if (isIngredient && saleType === 'bulk') payload.bulkData = bulkData;
  if (activeRubro === CANONICAL_BUSINESS_TYPES.FARMACIA) Object.assign(payload, { activeSubstance: String(values.activeSubstance || '').trim().toUpperCase(), laboratory: String(values.laboratory || '').trim(), presentation: String(values.presentation || '').trim(), prescriptionType: values.prescriptionType, requiresPrescription: Boolean(values.requiresPrescription), batchManagement: { enabled: trackStock, selectionStrategy: 'fefo' } });
  if (activeRubro === CANONICAL_BUSINESS_TYPES.FOOD_SERVICE) Object.assign(payload, { prepTime: values.prepTime === '' ? null : toNumber(values.prepTime), printStation: values.printStation || 'kitchen' });
  if (isEditing) payload.updatedAt = new Date().toISOString();
  return payload;
}
