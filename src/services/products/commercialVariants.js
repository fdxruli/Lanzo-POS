import { CANONICAL_BUSINESS_TYPES, normalizeBusinessType } from '../../utils/businessType';

/** A physical batch owns stock/cost; only commercial variants own sale price. */
export const isCommercialVariantProduct = (product = {}) => {
  if (product.hasVariants === true) return true;

  const configuration = product.configuration || {};
  if (
    configuration.hasVariants === true
    || configuration.type === 'variant_parent'
    || product.configurationType === 'variant_parent'
    || product.configuration_type === 'variant_parent'
  ) return true;

  // Compatibility for apparel parents created before hasVariants was persisted.
  return product.rubroContext === 'apparel'
    && Array.isArray(product.activeBatches)
    && product.activeBatches.some((batch) => (
      Boolean(batch?.attributes?.talla) || Boolean(batch?.attributes?.color)
    ));
};

const hasApparelVariantAttributes = (batch = {}) => {
  const attributes = batch.attributes || {};
  return ['talla', 'color', 'modelo', 'marca'].some((key) => (
    String(attributes[key] ?? '').trim() !== ''
  ));
};

const isPersistedApparelRubro = (value) => {
  if (normalizeBusinessType(value, null) === CANONICAL_BUSINESS_TYPES.APPAREL) return true;
  const legacyLabel = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ');
  return legacyLabel === 'ropa/calzado' || legacyLabel === 'ropa y calzado';
};

/**
 * Resolve Apparel identity from the catalog product, never from cart rubro.
 * The dimension fallback keeps legacy Apparel parents without hasVariants or
 * configuration fields recognizable when their persisted batches carry size/color.
 */
export const isApparelCommercialVariantProduct = (product = {}, batches = []) => {
  const catalogProduct = product && typeof product === 'object' ? product : {};
  if (!isPersistedApparelRubro(catalogProduct.rubroContext ?? catalogProduct.rubro_context)) return false;

  if (
    catalogProduct.hasVariants === true
    || catalogProduct.configuration?.hasVariants === true
    || catalogProduct.configuration?.type === 'variant_parent'
    || catalogProduct.configurationType === 'variant_parent'
    || catalogProduct.configuration_type === 'variant_parent'
  ) return true;

  const persistedBatches = [
    ...(Array.isArray(catalogProduct.activeBatches) ? catalogProduct.activeBatches : []),
    ...(Array.isArray(batches) ? batches : [])
  ];
  return persistedBatches.some(hasApparelVariantAttributes);
};

/**
 * A commercial line needs both the selected batch and an Apparel catalog parent.
 * isVariant and batchId alone also occur in ordinary SKU/lot flows.
 */
export const isCommercialVariantLine = (item = {}, product = {}, batches = []) => {
  const batchId = item.batchId ?? item.batch_id;
  return isApparelCommercialVariantProduct(product, batches)
    && item.isVariant === true
    && batchId !== null
    && batchId !== undefined
    && String(batchId).trim() !== '';
};
