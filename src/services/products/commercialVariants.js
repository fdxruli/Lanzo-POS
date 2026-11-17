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

/**
 * The POS marks an explicitly selected apparel size/color with isVariant and
 * its batchId. A batchId by itself still means an ordinary inventory lot.
 */
export const isCommercialVariantLine = (item = {}) => {
  const batchId = item.batchId ?? item.batch_id;
  return item.isVariant === true
    && batchId !== null
    && batchId !== undefined
    && String(batchId).trim() !== '';
};
