import { CANONICAL_BUSINESS_TYPES } from '../../../../utils/businessType';
import { getSaleTypeForIngredientUnit, normalizeIngredientUnit } from '../../../../utils/ingredientConfiguration';
import { normalizeProductUnit, normalizePurchaseUnit, resolveProductSaleUnit } from '../../../../utils/productUnitConfiguration';
import { getProductRubroConfig, normalizeProductRubro } from './productRubroConfig';

const asDateInput = (value) => (value ? String(value).split('T')[0] : '');

export function getProductFormDefaults({ activeRubro, capabilities = {}, productToEdit = null } = {}) {
  const rubro = normalizeProductRubro(activeRubro);
  const config = getProductRubroConfig(rubro);
  const source = productToEdit || {};
  const restaurantType = source.restaurantType || (source.productType === 'ingredient' ? 'ingredient' : (rubro === CANONICAL_BUSINESS_TYPES.FOOD_SERVICE ? 'dish' : 'ready'));
  const isIngredient = restaurantType === 'ingredient';
  const persistedSaleType = source.saleType || config.defaultSaleType;
  const saleMode = persistedSaleType === 'bulk'
    ? 'bulk'
    : (persistedSaleType === 'fractioned' || source.conversionFactor?.enabled === true ? 'fractioned' : 'unit');
  const defaultTrackStock = rubro === CANONICAL_BUSINESS_TYPES.FOOD_SERVICE && restaurantType === 'dish' ? false : true;
  const legacyIngredientUnit = [
    source.unit,
    source.bulkData?.purchase?.unit,
    source.bulkData?.unit,
    source.measurementUnit,
    source.saleUnit
  ].find((value) => String(value ?? '').trim());
  const ingredientUnit = normalizeIngredientUnit(legacyIngredientUnit || (source.saleType === 'unit' ? 'pza' : 'kg'));
  const productUnit = resolveProductSaleUnit({ ...source, saleType: persistedSaleType });
  const expirationMode = source.expirationMode || (config.strictExpiry && capabilities.hasExpiry !== false ? 'STRICT' : 'NONE');

  return {
    ...source,
    id: source.id,
    name: source.name || '', barcode: source.barcode || '', categoryId: source.categoryId || '', description: source.description || '',
    image: source.image || null, imagePreview: source.imageUrl || source.image || null, imageUploadSource: null, imageRemoved: false,
    cost: source.cost ?? '', price: source.price ?? '', margin: '',
    trackStock: source.trackStock ?? defaultTrackStock,
    stock: productToEdit ? (source.stock ?? 0) : 0,
    minStock: source.minStock ?? '', maxStock: source.maxStock ?? '', supplier: source.metadata?.primary_supplier ?? source.supplier ?? '', location: source.location || '',
    saleMode: isIngredient ? getSaleTypeForIngredientUnit(ingredientUnit) : saleMode,
    saleType: isIngredient ? getSaleTypeForIngredientUnit(ingredientUnit) : (saleMode === 'bulk' ? 'bulk' : 'unit'),
    unit: isIngredient ? ingredientUnit : normalizeProductUnit(productUnit || (rubro === CANONICAL_BUSINESS_TYPES.VERDULERIA_FRUTERIA ? 'kg' : 'pza')),
    conversionFactor: source.conversionFactor
      ? { ...source.conversionFactor, enabled: saleMode === 'fractioned', purchaseUnit: normalizePurchaseUnit(source.conversionFactor.purchaseUnit), purchaseCost: source.conversionFactor.purchaseCost ?? '' }
      : { enabled: false, purchaseUnit: '', factor: '', purchaseCost: '' },
    expirationMode, shelfLifeValue: source.shelfLifeValue ?? '', shelfLifeUnit: source.shelfLifeUnit || 'days',
    expiryDate: asDateInput(source.expiryDate), manufacturerBatchId: source.manufacturerBatchId || '',
    hasVariants: Boolean(source.hasVariants || source.quickVariants?.length), quickVariants: source.quickVariants || [],
    activeSubstance: source.activeSubstance || '', laboratory: source.laboratory || '', presentation: source.presentation || '',
    prescriptionType: source.prescriptionType || 'otc', requiresPrescription: Boolean(source.requiresPrescription),
    restaurantType, productType: source.productType || (restaurantType === 'ingredient' ? 'ingredient' : 'sellable'),
    recipe: source.recipe || [], modifiers: source.modifiers || [], prepTime: source.prepTime ?? '', printStation: source.printStation || 'kitchen',
    wholesaleTiers: source.wholesaleTiers || [], batchSummary: null,
    rubroContext: rubro
  };
}
