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
