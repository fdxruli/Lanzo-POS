import { CANONICAL_BUSINESS_TYPES } from '../../../../utils/businessType';
import { getSaleTypeForIngredientUnit, normalizeIngredientUnit } from '../../../../utils/ingredientConfiguration';
import { normalizeProductUnit, normalizePurchaseUnit } from '../../../../utils/productUnitConfiguration';
import { normalizeWholesaleTiers } from './wholesaleTiers';
import { normalizeExpirationFields, normalizeProduceSaleConfiguration, toNumber } from './productFormNormalization';
import { calculateFractionedUnitCost } from './fractionedPricing';
import { pharmacyLegacyIndicators, isSpecialPharmacyProduct } from '../../../../utils/pharmacyClassification';
import {
  formatCompositionActiveSubstance,
  formatCompositionConcentration,
  normalizePharmacyComposition
} from '../../../../services/pharmacy/pharmacyComposition';
import {
  formatPharmacyCommercialPresentation,
  getPharmacyDosageFormLabel,
  normalizePharmacyCommercialPresentation
} from '../../../../services/pharmacy/pharmacyCatalog';

export function buildProductFormPayload(values, { activeRubro, productToEdit = null } = {}) {
  const isEditing = Boolean(productToEdit?.id);
  const isIngredient = values.restaurantType === 'ingredient';
  const isProduce = activeRubro === CANONICAL_BUSINESS_TYPES.VERDULERIA_FRUTERIA;
  const requestedSaleMode = ['unit', 'bulk', 'fractioned'].includes(values.saleMode)
    ? values.saleMode
    : values.saleType;
  const produceSaleConfiguration = isProduce
    ? normalizeProduceSaleConfiguration({ saleMode: requestedSaleMode, saleType: values.saleType, unit: values.unit })
    : null;
  const saleMode = produceSaleConfiguration?.saleMode || (requestedSaleMode === 'bulk' ? 'bulk' : (requestedSaleMode === 'fractioned' ? 'fractioned' : 'unit'));
  const ingredientUnit = isIngredient
    ? normalizeIngredientUnit(values.unit)
    : (produceSaleConfiguration?.unit || normalizeProductUnit(values.unit));
  const saleType = isIngredient
    ? getSaleTypeForIngredientUnit(ingredientUnit)
    : (produceSaleConfiguration?.saleType || (saleMode === 'bulk' ? 'bulk' : 'unit'));
  const sourceBulkData = values.bulkData || productToEdit?.bulkData;
  const bulkData = isIngredient && saleType === 'bulk'
    ? { ...sourceBulkData, purchase: { ...sourceBulkData?.purchase, unit: ingredientUnit } }
    : { ...sourceBulkData, sale: { ...sourceBulkData?.sale, unit: ingredientUnit } };
  const supplier = String(values.supplier || '').trim();
  const metadata = { ...(productToEdit?.metadata || values.metadata || {}) };
  if (supplier) metadata.primary_supplier = supplier;
  else delete metadata.primary_supplier;
  const conversionFactor = saleMode === 'fractioned'
    ? {
      ...values.conversionFactor,
      enabled: true,
      purchaseUnit: normalizePurchaseUnit(values.conversionFactor?.purchaseUnit),
      factor: toNumber(values.conversionFactor?.factor),
      purchaseCost: toNumber(values.conversionFactor?.purchaseCost)
    }
    : {
      ...values.conversionFactor,
      enabled: false,
      purchaseUnit: normalizePurchaseUnit(values.conversionFactor?.purchaseUnit),
      factor: values.conversionFactor?.factor ?? ''
    };
  const hasVariants = values.hasVariants && values.quickVariants.some((variant) => variant.talla && variant.color);
  const unitCost = saleMode === 'fractioned'
    ? calculateFractionedUnitCost({ purchaseCost: conversionFactor.purchaseCost, factor: conversionFactor.factor })
    : toNumber(values.cost);
  const trackStock = Boolean(values.trackStock) && !(activeRubro === CANONICAL_BUSINESS_TYPES.FOOD_SERVICE && values.restaurantType === 'dish');
  const expiration = trackStock ? normalizeExpirationFields(values) : normalizeExpirationFields({ expirationMode: 'NONE' });
  const stock = isEditing ? (productToEdit.stock ?? 0) : (trackStock && !hasVariants ? toNumber(values.stock) : 0);
  const payload = {
    ...(productToEdit || {}),
    id: productToEdit?.id || values.id,
    name: String(values.name || '').trim(), barcode: String(values.barcode || '').trim(), categoryId: values.categoryId || '', description: String(values.description || '').trim(),
    image: values.image || (values.imageRemoved ? null : (productToEdit?.image || null)), imageUploadSource: values.imageUploadSource || null,
    imageRemoved: Boolean(values.imageRemoved),
    price: isIngredient ? 0 : toNumber(values.price), cost: unitCost, trackStock, stock,
    minStock: trackStock && values.minStock !== '' ? toNumber(values.minStock) : null,
    maxStock: trackStock && values.maxStock !== '' ? toNumber(values.maxStock) : null,
    saleType, unit: ingredientUnit, supplier, metadata, location: String(values.location || '').trim(),
    conversionFactor, wholesaleTiers: normalizeWholesaleTiers(values.wholesaleTiers || []),
    ...expiration,
    hasVariants: activeRubro === CANONICAL_BUSINESS_TYPES.APPAREL ? hasVariants : Boolean(productToEdit?.hasVariants),
    quickVariants: hasVariants ? values.quickVariants.filter((variant) => variant.talla && variant.color).map((variant) => ({ ...variant, stock: toNumber(variant.stock), cost: toNumber(variant.cost, toNumber(values.cost)), price: toNumber(variant.price, toNumber(values.price)) })) : [],
    rubroContext: activeRubro, productType: isIngredient ? 'ingredient' : 'sellable', restaurantType: values.restaurantType,
    recipe: values.restaurantType === 'dish' ? values.recipe : [], modifiers: values.restaurantType === 'dish' ? values.modifiers : []
  };
  if (!isIngredient || saleType === 'bulk') payload.bulkData = bulkData;
  delete payload.saleMode;
  delete payload.batchSummary;
  if (activeRubro === CANONICAL_BUSINESS_TYPES.FARMACIA) {
    // Los datos medicinales se guardan en un solo objeto, también enviado a metadata JSONB Cloud.
    const existingPharmacy = productToEdit?.metadata?.pharmacy || productToEdit?.pharmacy || {};
    const existingCommercialPresentation = existingPharmacy.commercialPresentation;
    const dosageFormCode = String(values.dosageFormCode || existingPharmacy.dosageFormCode || '').trim();
    const dosageFormLabel = getPharmacyDosageFormLabel(dosageFormCode);
    const pharmacy = {
      ...existingPharmacy,
      version: 1,
      kind: values.pharmacyKind === 'other' ? 'other' : 'medicine',
      fraction: values.pharmacyKind === 'other' ? null : (values.sanitaryFraction || null),
      status: values.pharmacyKind === 'other' || values.sanitaryFraction ? 'confirmed' : 'pending',
      antibiotic: values.pharmacyKind === 'medicine' && values.isAntibiotic === true,
      concentration: String(values.concentration || '').trim(),
      sanitaryRegistration: String(values.sanitaryRegistration || '').trim()
    };
    if (dosageFormCode) {
      pharmacy.dosageFormCode = dosageFormCode;
      pharmacy.dosageForm = dosageFormLabel || String(existingPharmacy.dosageForm || values.dosageForm || dosageFormCode).trim();
      if (!existingPharmacy.dosageFormCode && !existingPharmacy.dosageFormLegacy) {
        const previousDosageForm = String(values.dosageFormLegacy || existingPharmacy.dosageForm || '').trim();
        if (previousDosageForm && previousDosageForm !== pharmacy.dosageForm) {
          pharmacy.dosageFormLegacy = previousDosageForm;
        }
      }
    } else {
      pharmacy.dosageForm = String(values.dosageForm || existingPharmacy.dosageForm || '').trim();
    }
    if (dosageFormCode || Object.hasOwn(existingPharmacy, 'dosageFormLegacy')) {
      const legacyDosageForm = String(values.dosageFormLegacy || '').trim();
      if (legacyDosageForm) pharmacy.dosageFormLegacy = legacyDosageForm;
      else delete pharmacy.dosageFormLegacy;
    }

    const requestedCommercialPresentation = normalizePharmacyCommercialPresentation({
      version: 1,
      packageType: values.packageType,
      contentAmount: values.packageContentAmount,
      contentUnit: values.packageContentUnit
    });
    const preservedCommercialPresentation = normalizePharmacyCommercialPresentation(existingCommercialPresentation);
    if (requestedCommercialPresentation) {
      const previousDescription = String(
        values.presentationLegacy
          ?? existingCommercialPresentation?.legacyDescription
          ?? (isEditing ? productToEdit?.presentation : '')
          ?? ''
      ).trim();
      pharmacy.commercialPresentation = {
        ...requestedCommercialPresentation,
        ...(previousDescription ? { legacyDescription: previousDescription } : {})
      };
      payload.presentation = formatPharmacyCommercialPresentation(requestedCommercialPresentation);
    } else if (preservedCommercialPresentation) {
      pharmacy.commercialPresentation = existingCommercialPresentation;
      payload.presentation = formatPharmacyCommercialPresentation(preservedCommercialPresentation);
    } else if (existingCommercialPresentation && typeof existingCommercialPresentation === 'object') {
      pharmacy.commercialPresentation = existingCommercialPresentation;
      payload.presentation = String(productToEdit?.presentation ?? values.presentation ?? '').trim();
    } else {
      delete pharmacy.commercialPresentation;
      payload.presentation = values.pharmacyKind === 'medicine'
        ? String(values.presentationLegacy ?? values.presentation ?? '').trim()
        : String(values.presentation || '').trim();
    }

    const existingComposition = productToEdit?.metadata?.pharmacy?.composition
      ?? productToEdit?.pharmacy?.composition;
    const shouldClearComposition = values.compositionTouched === true
      && (!Array.isArray(values.compositionIngredients) || values.compositionIngredients.length === 0);
    const composition = Array.isArray(values.compositionIngredients) && values.compositionIngredients.length > 0
      ? normalizePharmacyComposition({ version: 1, activeIngredients: values.compositionIngredients })
      : normalizePharmacyComposition(existingComposition);
    if (shouldClearComposition) {
      pharmacy.composition = null;
      pharmacy.concentration = '';
    } else if (composition) {
      pharmacy.composition = composition;
      pharmacy.concentration = formatCompositionConcentration(composition);
    }
    const shouldRecord = !isEditing || Boolean(productToEdit?.metadata?.pharmacy || productToEdit?.pharmacy)
      || Boolean(values.sanitaryFraction || values.pharmacyKind === 'other' || values.compositionTouched);
    if (shouldRecord) {
      metadata.pharmacy = pharmacy;
      payload.pharmacy = pharmacy;
    }
    const legacy = pharmacyLegacyIndicators({ ...payload, metadata, pharmacy: shouldRecord ? pharmacy : undefined });
    Object.assign(payload, {
      activeSubstance: shouldClearComposition ? '' : (composition
        ? formatCompositionActiveSubstance(composition)
        : String(values.activeSubstance || '').trim()),
      laboratory: String(values.laboratory || '').trim(),
      presentation: values.pharmacyKind === 'medicine'
        ? payload.presentation
        : String(values.presentation || '').trim(),
      prescriptionType: legacy.prescriptionType,
      requiresPrescription: legacy.requiresPrescription,
      batchManagement: { enabled: trackStock, selectionStrategy: 'fefo' }
    });
    // No tocar el estado de productos históricos sin clasificación.
    if (!isEditing) payload.isActive = pharmacy.kind === 'other' || (pharmacy.status === 'confirmed' && !isSpecialPharmacyProduct(payload));
    else if (isSpecialPharmacyProduct(payload)) payload.isActive = false;
  }
  if (activeRubro === CANONICAL_BUSINESS_TYPES.FOOD_SERVICE) Object.assign(payload, { prepTime: values.prepTime === '' ? null : toNumber(values.prepTime), printStation: values.printStation || 'kitchen' });
  if (isEditing) payload.updatedAt = new Date().toISOString();
  return payload;
}
