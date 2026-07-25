import {
  CANONICAL_BUSINESS_TYPES,
  normalizeBusinessTypes
} from './businessType';

export const BUSINESS_CAPABILITY_STATUS = Object.freeze({
  COMPATIBLE: 'compatible',
  REQUIRES_REVIEW: 'requires_review',
  SIMPLE_OVERRIDE: 'simple_override',
  HIDDEN_INCOMPATIBLE: 'hidden_incompatible'
});

export const BUSINESS_CAPABILITY_REASON = Object.freeze({
  RESTAURANT_MODIFIERS_NOT_SUPPORTED: 'RESTAURANT_MODIFIERS_NOT_SUPPORTED',
  WHOLESALE_NOT_SUPPORTED: 'WHOLESALE_NOT_SUPPORTED',
  BUSINESS_TYPE_UNKNOWN: 'BUSINESS_TYPE_UNKNOWN',
  BUSINESS_CAPABILITY_CHANGED: 'BUSINESS_CAPABILITY_CHANGED'
});

const EMPTY_CAPABILITIES = Object.freeze({
  supportsRestaurantModifiers: false,
  supportsWholesalePricing: false,
  supportsVariants: false,
  supportsBulkSales: false,
  supportsPrescriptionFields: false,
  supportsRecipes: false
});

const CAPABILITIES_BY_BUSINESS_TYPE = Object.freeze({
  [CANONICAL_BUSINESS_TYPES.FOOD_SERVICE]: {
    supportsRestaurantModifiers: true,
    supportsRecipes: true
  },
  [CANONICAL_BUSINESS_TYPES.FARMACIA]: {
    supportsVariants: true,
    supportsPrescriptionFields: true
  },
  [CANONICAL_BUSINESS_TYPES.VERDULERIA_FRUTERIA]: {
    supportsWholesalePricing: true,
    supportsBulkSales: true
  },
  [CANONICAL_BUSINESS_TYPES.ABARROTES]: {
    supportsWholesalePricing: true,
    supportsVariants: true,
    supportsBulkSales: true
  },
  [CANONICAL_BUSINESS_TYPES.APPAREL]: {
    supportsWholesalePricing: true,
    supportsVariants: true
  },
  [CANONICAL_BUSINESS_TYPES.HARDWARE]: {
    supportsWholesalePricing: true,
    supportsVariants: true,
    supportsBulkSales: true
  },
  [CANONICAL_BUSINESS_TYPES.OTRO]: {}
});

const hasEntries = (value) => Array.isArray(value) && value.length > 0;

export const resolveBusinessCapabilities = ({
  businessTypes,
  profile,
  product
} = {}) => {
  const authoritativeTypes = businessTypes ?? profile?.business_type ?? [];
  const normalizedBusinessTypes = normalizeBusinessTypes(authoritativeTypes, null);
  const knownBusinessTypes = normalizedBusinessTypes.filter((type) => (
    Object.prototype.hasOwnProperty.call(CAPABILITIES_BY_BUSINESS_TYPE, type)
    && type !== CANONICAL_BUSINESS_TYPES.OTRO
  ));
  const capabilities = knownBusinessTypes.reduce((result, businessType) => {
    const contribution = CAPABILITIES_BY_BUSINESS_TYPE[businessType] || {};
    Object.keys(EMPTY_CAPABILITIES).forEach((key) => {
      result[key] = result[key] || contribution[key] === true;
    });
    return result;
  }, { ...EMPTY_CAPABILITIES });

  const unknownBusinessType = knownBusinessTypes.length === 0;
  const incompatibilities = [];
  if (unknownBusinessType) {
    incompatibilities.push(BUSINESS_CAPABILITY_REASON.BUSINESS_TYPE_UNKNOWN);
  } else {
    if (
      hasEntries(product?.modifiers)
      && !capabilities.supportsRestaurantModifiers
    ) {
      incompatibilities.push(
        BUSINESS_CAPABILITY_REASON.RESTAURANT_MODIFIERS_NOT_SUPPORTED
      );
    }
    if (
      hasEntries(product?.wholesaleTiers ?? product?.wholesale_tiers)
      && !capabilities.supportsWholesalePricing
    ) {
      incompatibilities.push(BUSINESS_CAPABILITY_REASON.WHOLESALE_NOT_SUPPORTED);
    }
  }

  return {
    ...capabilities,
    businessTypes: knownBusinessTypes,
    unknownBusinessType,
    incompatibilities,
    compatible: incompatibilities.length === 0
  };
};

export const resolveEcommerceBusinessPolicy = ({
  businessTypes,
  profile,
  product,
  publicConfigurationMode
} = {}) => {
  const capabilities = resolveBusinessCapabilities({ businessTypes, profile, product });
  const requestedMode = Object.values(BUSINESS_CAPABILITY_STATUS)
    .includes(publicConfigurationMode)
    ? publicConfigurationMode
    : null;
  const modifierIncompatible = capabilities.incompatibilities.includes(
    BUSINESS_CAPABILITY_REASON.RESTAURANT_MODIFIERS_NOT_SUPPORTED
  );

  if (requestedMode === BUSINESS_CAPABILITY_STATUS.SIMPLE_OVERRIDE) {
    return {
      capabilities,
      status: BUSINESS_CAPABILITY_STATUS.SIMPLE_OVERRIDE,
      reason: modifierIncompatible
        ? BUSINESS_CAPABILITY_REASON.RESTAURANT_MODIFIERS_NOT_SUPPORTED
        : null,
      exposeConfiguration: false,
      publiclyAvailable: true
    };
  }
  if (!capabilities.compatible) {
    return {
      capabilities,
      status: BUSINESS_CAPABILITY_STATUS.REQUIRES_REVIEW,
      reason: capabilities.incompatibilities[0],
      exposeConfiguration: false,
      publiclyAvailable: false
    };
  }
  return {
    capabilities,
    status: BUSINESS_CAPABILITY_STATUS.COMPATIBLE,
    reason: null,
    exposeConfiguration: true,
    publiclyAvailable: true
  };
};

export const businessCapabilityInternals = Object.freeze({
  CAPABILITIES_BY_BUSINESS_TYPE,
  EMPTY_CAPABILITIES
});
