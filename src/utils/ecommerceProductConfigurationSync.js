import {
  createStableConfigurationId,
  normalizeEcommerceProductConfiguration,
  validateEcommerceProductConfiguration
} from './ecommerceProductConfiguration';

export const ECOMMERCE_CONFIGURATION_SYNC_KEYS = Object.freeze([
  'type',
  'version',
  'hasRecipe',
  'variants',
  'optionGroups',
  'availabilitySource',
  'availabilityReasonCode',
  'limitingSource'
]);

export const ECOMMERCE_VARIANT_SYNC_KEYS = Object.freeze([
  'sourceVariantRef',
  'sourceProductId',
  'localProductRef',
  'sku',
  'publicName',
  'optionValues',
  'priceMode',
  'priceValue',
  'imageUrl',
  'imageRef',
  'trackStock',
  'stockMode',
  'stockSnapshot',
  'sourceAvailable',
  'manualAvailable',
  'displayOrder',
  'sourceRevision',
  'metadata'
]);

export const ECOMMERCE_OPTION_GROUP_SYNC_KEYS = Object.freeze([
  'sourceGroupRef',
  'publicName',
  'selectionType',
  'required',
  'minSelect',
  'maxSelect',
  'displayOrder',
  'options',
  'metadata'
]);

export const ECOMMERCE_OPTION_SYNC_KEYS = Object.freeze([
  'sourceOptionRef',
  'publicName',
  'priceDelta',
  'sourceIngredientId',
  'ingredientQuantity',
  'ingredientUnit',
  'tracksInventory',
  'manualAvailable',
  'sourceAvailable',
  'displayOrder',
  'metadata'
]);

export const ECOMMERCE_AVAILABILITY_SOURCES = Object.freeze({
  DIRECT: 'direct',
  RECIPE: 'recipe',
  VARIANT_AGGREGATE: 'variant_aggregate',
  NOT_TRACKED: 'not_tracked',
  MANUAL: 'manual',
  UNVERIFIED: 'unverified'
});

const OFFICIAL_AVAILABILITY_SOURCES = new Set(
  Object.values(ECOMMERCE_AVAILABILITY_SOURCES)
);
const PRIVATE_METADATA_KEY = /(cost|license|device|staff|token|session|secret|password|security|fingerprint|supplier|provider)/i;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_KEYS = 40;
const MAX_METADATA_TEXT = 500;

const asRecord = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);
const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value, maxLength = 240) => (
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maxLength)
    : ''
);
const asFiniteOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const stableObject = (value) => Object.keys(asRecord(value))
  .sort()
  .reduce((result, key) => {
    result[key] = value[key];
    return result;
  }, {});

export const isEcommerceAvailabilitySource = (value) => (
  OFFICIAL_AVAILABILITY_SOURCES.has(asText(value, 40))
);

export const resolveEcommerceAvailabilitySource = ({
  configurationType,
  hasRecipe = false,
  hasVariants = false,
  trackStock = true
} = {}) => {
  if (hasVariants === true || configurationType === 'variant_parent') {
    return ECOMMERCE_AVAILABILITY_SOURCES.VARIANT_AGGREGATE;
  }
  if (hasRecipe === true || configurationType === 'recipe') {
    return ECOMMERCE_AVAILABILITY_SOURCES.RECIPE;
  }
  if (trackStock === false) {
    return ECOMMERCE_AVAILABILITY_SOURCES.NOT_TRACKED;
  }
  return ECOMMERCE_AVAILABILITY_SOURCES.DIRECT;
};

const sanitizeJsonValue = (value, depth = 0) => {
  if (depth > MAX_METADATA_DEPTH || value === undefined || typeof value === 'function') {
    return undefined;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, MAX_METADATA_TEXT);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_METADATA_KEYS)
      .map((item) => sanitizeJsonValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value !== 'object') return undefined;

  return Object.keys(value)
    .filter((key) => !PRIVATE_METADATA_KEY.test(key))
    .sort()
    .slice(0, MAX_METADATA_KEYS)
    .reduce((result, key) => {
      const normalized = sanitizeJsonValue(value[key], depth + 1);
      if (normalized !== undefined) result[key] = normalized;
      return result;
    }, {});
};

export const sanitizeEcommerceConfigurationMetadata = (value) => (
  asRecord(sanitizeJsonValue(asRecord(value)))
);

const deriveVariantRef = (variant) => {
  const explicit = asText(variant.sourceVariantRef, 160);
  if (explicit) return explicit;
  const sourceProductId = asText(variant.sourceProductId, 160);
  if (sourceProductId) return sourceProductId;
  const sku = asText(variant.sku, 120).toUpperCase();
  if (sku) return `sku:${sku}`;
  const optionValues = stableObject(variant.optionValues);
  if (Object.keys(optionValues).length > 0) {
    return createStableConfigurationId('variant-ref', optionValues);
  }
  throw new Error('ECOMMERCE_VARIANT_SOURCE_REF_REQUIRED');
};

const deriveGroupRef = (group) => {
  const explicit = asText(group.sourceGroupRef, 160);
  if (explicit) return explicit;
  const name = asText(group.publicName, 160);
  if (!name) throw new Error('ECOMMERCE_OPTION_GROUP_SOURCE_REF_REQUIRED');
  return createStableConfigurationId('group-ref', name);
};

const deriveOptionRef = (option) => {
  const explicit = asText(option.sourceOptionRef, 160);
  if (explicit) return explicit;
  const name = asText(option.publicName, 160);
  if (!name) throw new Error('ECOMMERCE_OPTION_SOURCE_REF_REQUIRED');
  return createStableConfigurationId(
    'option-ref',
    name,
    asText(option.sourceIngredientId, 160)
  );
};

const serializeVariant = (variant = {}) => ({
  sourceVariantRef: deriveVariantRef(variant),
  sourceProductId: asText(variant.sourceProductId, 160) || null,
  localProductRef: asText(variant.localProductRef, 160) || null,
  sku: asText(variant.sku, 120).toUpperCase() || null,
  publicName: asText(variant.publicName, 160) || null,
  optionValues: stableObject(variant.optionValues),
  priceMode: ['base', 'delta', 'absolute'].includes(variant.priceMode)
    ? variant.priceMode
    : 'base',
  priceValue: Math.max(0, asFiniteOrNull(variant.priceValue) ?? 0),
  imageUrl: asText(variant.imageUrl, 2_000) || null,
  imageRef: asText(variant.imageRef, 500) || null,
  trackStock: variant.trackStock !== false,
  stockMode: ['hidden', 'status', 'exact'].includes(variant.stockMode)
    ? variant.stockMode
    : 'hidden',
  stockSnapshot: asFiniteOrNull(variant.stockSnapshot) === null
    ? null
    : Math.max(0, asFiniteOrNull(variant.stockSnapshot)),
  sourceAvailable: variant.sourceAvailable !== false,
  manualAvailable: variant.manualAvailable !== false,
  displayOrder: Math.max(0, Math.trunc(asFiniteOrNull(variant.displayOrder) ?? 0)),
  sourceRevision: asText(variant.sourceRevision, 200) || null,
  metadata: sanitizeEcommerceConfigurationMetadata(variant.metadata)
});

const serializeOption = (option = {}) => {
  const tracksInventory = option.tracksInventory === true;
  return {
    sourceOptionRef: deriveOptionRef(option),
    publicName: asText(option.publicName, 160),
    priceDelta: Math.max(0, asFiniteOrNull(option.priceDelta) ?? 0),
    sourceIngredientId: tracksInventory
      ? (asText(option.sourceIngredientId, 160) || null)
      : null,
    ingredientQuantity: tracksInventory
      ? asFiniteOrNull(option.ingredientQuantity)
      : null,
    ingredientUnit: tracksInventory
      ? (asText(option.ingredientUnit, 20) || null)
      : null,
    tracksInventory,
    manualAvailable: option.manualAvailable !== false,
    sourceAvailable: option.sourceAvailable !== false,
    displayOrder: Math.max(0, Math.trunc(asFiniteOrNull(option.displayOrder) ?? 0)),
    metadata: sanitizeEcommerceConfigurationMetadata(option.metadata)
  };
};

const serializeGroup = (group = {}) => ({
  sourceGroupRef: deriveGroupRef(group),
  publicName: asText(group.publicName, 160),
  selectionType: group.selectionType === 'multiple' ? 'multiple' : 'single',
  required: group.required === true,
  minSelect: Math.max(0, Math.trunc(asFiniteOrNull(group.minSelect) ?? 0)),
  maxSelect: Math.max(0, Math.trunc(asFiniteOrNull(group.maxSelect) ?? 1)),
  displayOrder: Math.max(0, Math.trunc(asFiniteOrNull(group.displayOrder) ?? 0)),
  options: asArray(group.options).map(serializeOption),
  metadata: sanitizeEcommerceConfigurationMetadata(group.metadata)
});

export const serializeEcommerceProductConfigurationForSync = (configuration = {}) => {
  const validation = validateEcommerceProductConfiguration(configuration);
  const providedAvailabilitySource = asText(configuration.availabilitySource, 40);
  const availabilitySource = providedAvailabilitySource || resolveEcommerceAvailabilitySource({
    configurationType: configuration.type,
    hasRecipe: configuration.hasRecipe === true,
    hasVariants: asArray(configuration.variants).length > 0,
    trackStock: configuration.trackStock
  });
  if (!validation.valid) {
    const code = validation.errors[0] || 'ECOMMERCE_CONFIGURATION_INVALID';
    const error = new Error(code);
    error.code = code;
    error.details = validation.errors;
    throw error;
  }
  if (providedAvailabilitySource && !isEcommerceAvailabilitySource(providedAvailabilitySource)) {
    const error = new Error('ECOMMERCE_CONFIGURATION_INVALID');
    error.code = 'ECOMMERCE_CONFIGURATION_INVALID';
    error.details = ['ECOMMERCE_CONFIGURATION_AVAILABILITY_SOURCE_INVALID'];
    throw error;
  }

  const limitingSource = asRecord(configuration.limitingSource);
  return {
    type: configuration.type,
    version: Number(configuration.version),
    hasRecipe: configuration.hasRecipe === true,
    variants: asArray(configuration.variants).map(serializeVariant),
    optionGroups: asArray(configuration.optionGroups).map(serializeGroup),
    availabilitySource,
    availabilityReasonCode: asText(configuration.availabilityReasonCode, 120) || null,
    limitingSource: {
      productId: asText(limitingSource.productId, 160) || null,
      name: asText(limitingSource.name, 160) || null
    }
  };
};

const enrichTransportFields = (normalized, product, overrides) => {
  const rawVariants = asArray(overrides.variants ?? product.variants);
  const rawGroups = asArray(
    overrides.optionGroups
      ?? overrides.option_groups
      ?? overrides.modifiers
      ?? product.modifiers
  );

  return {
    ...normalized,
    variants: normalized.variants.map((variant, index) => {
      const raw = asRecord(rawVariants[index]);
      return {
        ...variant,
        stockMode: raw.stockMode ?? raw.stock_mode,
        stockSnapshot: raw.stockSnapshot ?? raw.stock_snapshot,
        sourceAvailable: raw.sourceAvailable ?? raw.source_available,
        sourceRevision: raw.sourceRevision ?? raw.source_revision
      };
    }),
    optionGroups: normalized.optionGroups.map((group, groupIndex) => {
      const rawGroup = asRecord(rawGroups[groupIndex]);
      const rawOptions = asArray(rawGroup.options);
      return {
        ...group,
        options: group.options.map((option, optionIndex) => {
          const rawOption = asRecord(rawOptions[optionIndex]);
          return {
            ...option,
            sourceAvailable: rawOption.sourceAvailable ?? rawOption.source_available
          };
        })
      };
    })
  };
};

export const buildEcommerceProductConfigurationSyncPayload = (
  product = {},
  overrides = {}
) => {
  const normalized = enrichTransportFields(
    normalizeEcommerceProductConfiguration(product, overrides),
    product,
    overrides
  );
  const availabilitySource = overrides.availabilitySource === undefined
    ? resolveEcommerceAvailabilitySource({
        configurationType: normalized.type,
        hasRecipe: normalized.hasRecipe,
        hasVariants: normalized.hasVariants,
        trackStock: product.trackStock ?? product.track_stock
      })
    : overrides.availabilitySource;

  return serializeEcommerceProductConfigurationForSync({
    ...normalized,
    availabilitySource,
    availabilityReasonCode: overrides.availabilityReasonCode,
    limitingSource: overrides.limitingSource
  });
};

export const getEcommerceConfigurationSourceRevision = (product = {}) => {
  const version = product.serverVersion
    ?? product.server_version
    ?? product.syncVersion
    ?? product.sync_version;
  if (version !== null && version !== undefined && String(version).trim()) {
    return `version:${String(version).trim()}`;
  }
  const timestamp = product.updatedAt
    ?? product.updated_at
    ?? product.lastModified
    ?? product.last_modified;
  const parsed = Date.parse(String(timestamp || ''));
  if (Number.isFinite(parsed)) return `timestamp:${parsed}`;
  return null;
};
