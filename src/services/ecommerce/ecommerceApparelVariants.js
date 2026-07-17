import {
  getAvailableBatchStock,
  getBatchExpiryValue,
  getBatchId,
  isBatchActiveForFefo,
  sortBatchesByFefo
} from '../products/fefoUtils';
import { getBatchExpiryStatus } from '../../utils/dateUtils';

export const ECOMMERCE_APPAREL_VARIANT_ATTRIBUTE_KEYS = Object.freeze([
  'color',
  'talla',
  'modelo',
  'marca'
]);

export const ECOMMERCE_APPAREL_UNAVAILABLE_REASON = 'APPAREL_VARIANTS_UNAVAILABLE';
export const ECOMMERCE_APPAREL_PROJECTION_STATE_KEY = '__ecommerceApparelProjection';

const PRICE_EPSILON = 0.009;
const BLOCKED_BATCH_STATUSES = new Set([
  'inactive', 'blocked', 'quarantined', 'deleted', 'removed', 'archived'
]);
const EXPIRY_REQUIRED_MODES = new Set(['STRICT', 'SHELF_LIFE', 'BATCH']);
const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(asObject(value), key);
const asText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const normalizeComparableText = (value) => asText(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();
const normalizeSku = (value) => asText(value).toUpperCase();
const asMoney = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Number(number.toFixed(2))
    : fallback;
};
const getProductId = (product = {}) => asText(product.id ?? product.productId ?? product.product_id);
const getBatchProductId = (batch = {}) => asText(batch.productId ?? batch.product_id);
const getBatchSku = (batch = {}) => normalizeSku(
  batch.sku ?? batch.batchSku ?? batch.batch_sku
);
const getBatchPrice = (batch = {}, product = {}) => asMoney(
  batch.price,
  asMoney(product.price, 0)
);
const getPublicImage = (value) => {
  const text = asText(value);
  return /^https?:\/\//i.test(text) ? text : null;
};

const stableHash = (value) => {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
};

const displayAttributeValue = (key, value) => {
  const text = asText(value);
  if (!text) return '';
  if (key === 'talla') return text.toUpperCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const normalizeEcommerceApparelVariantAttributes = (attributes = {}) => {
  const source = asObject(attributes);
  return ECOMMERCE_APPAREL_VARIANT_ATTRIBUTE_KEYS.reduce((result, key) => {
    const displayValue = displayAttributeValue(key, source[key]);
    if (displayValue) result[key] = displayValue;
    return result;
  }, {});
};

export const getEcommerceApparelVariantAttributeKey = (attributes = {}) => (
  ECOMMERCE_APPAREL_VARIANT_ATTRIBUTE_KEYS
    .map((key) => {
      const value = normalizeComparableText(asObject(attributes)[key]);
      return value ? `${key}:${value}` : null;
    })
    .filter(Boolean)
    .join('|')
);

export const hasEcommerceApparelVariantAttributes = (batch = {}) => (
  Boolean(getEcommerceApparelVariantAttributeKey(batch.attributes))
);

export const hasEcommerceApparelVariantSchema = (batch = {}) => {
  const attributes = asObject(batch.attributes);
  return ECOMMERCE_APPAREL_VARIANT_ATTRIBUTE_KEYS.some((key) => hasOwn(attributes, key));
};

const productDeclaresApparel = (product = {}) => {
  const metadata = asObject(product.metadata);
  return product.ecommerceApparel === true
    || product.ecommerce_apparel === true
    || product.apparelVariantModel === true
    || product.apparel_variant_model === true
    || metadata.ecommerceApparel === true
    || metadata.ecommerce_apparel === true
    || asArray(product.variants).some((variant) => (
      ECOMMERCE_APPAREL_VARIANT_ATTRIBUTE_KEYS.some((key) => (
        hasOwn(variant?.optionValues, key)
        || hasOwn(variant?.option_values, key)
        || hasOwn(variant?.attributes, key)
      ))
    ));
};

export const isEcommerceApparelProduct = ({ product = {}, batches = [] } = {}) => {
  const productId = getProductId(product);
  if (!productId) return false;
  if (productDeclaresApparel(product)) return true;
  return asArray(batches).some((batch) => (
    getBatchProductId(batch) === productId
    && hasEcommerceApparelVariantSchema(batch)
  ));
};

const isBatchLifecycleEligible = ({ batch = {}, product = {}, now = new Date() } = {}) => {
  if (!isBatchActiveForFefo(batch)) return false;
  const status = normalizeComparableText(batch.status);
  if (
    batch.isBlocked === true
    || batch.is_blocked === true
    || batch.blocked === true
    || BLOCKED_BATCH_STATUSES.has(status)
  ) {
    return false;
  }

  const expirationMode = asText(
    product.expirationMode ?? product.expiration_mode ?? 'NONE'
  ).toUpperCase();
  if (!EXPIRY_REQUIRED_MODES.has(expirationMode)) return true;
  const expiryStatus = getBatchExpiryStatus({
    expiryDate: getBatchExpiryValue(batch)
  }, now);
  return expiryStatus === 'valid' || expiryStatus === 'expires_today';
};

const isBatchEligibleForProjection = ({ batch, product, now }) => {
  const productId = getProductId(product);
  return Boolean(
    productId
    && getBatchProductId(batch) === productId
    && isBatchLifecycleEligible({ batch, product, now })
    && hasEcommerceApparelVariantAttributes(batch)
  );
};

const createProjectionError = (code, details = {}) => {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  error.retryable = false;
  return error;
};

const getCommercialIdentity = ({ productId, sku, attributeKey }) => {
  if (sku) return `sku:${sku}`;
  if (!productId || !attributeKey) return null;
  return `attributes:${productId}:${stableHash(attributeKey)}`;
};

const getVariantPublicName = (attributes = {}) => (
  ECOMMERCE_APPAREL_VARIANT_ATTRIBUTE_KEYS
    .map((key) => asText(attributes[key]))
    .filter(Boolean)
    .join(' / ')
);

const sortProjectionRecords = (records = []) => [...records].sort((left, right) => {
  const leftKey = [
    left.sku,
    left.attributeKey,
    left.price,
    getBatchExpiryValue(left.batch),
    getBatchId(left.batch)
  ].map(asText).join('|');
  const rightKey = [
    right.sku,
    right.attributeKey,
    right.price,
    getBatchExpiryValue(right.batch),
    getBatchId(right.batch)
  ].map(asText).join('|');
  return leftKey.localeCompare(rightKey, 'es-MX');
});

const resolveGroupAttributes = (records = []) => {
  const candidates = records
    .map((record) => record.attributes)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'es-MX'));
  return candidates[0] || {};
};

const getVariantImage = ({ records, product }) => {
  const specific = records
    .map(({ batch }) => getPublicImage(batch.imageUrl ?? batch.image_url ?? batch.image))
    .filter(Boolean)
    .sort()[0];
  return specific || getPublicImage(product.imageUrl ?? product.image_url ?? product.image);
};

export const projectProductBatchesToEcommerceVariants = ({
  product = {},
  batches = [],
  now = new Date(),
  stockMode = 'exact'
} = {}) => {
  const productId = getProductId(product);
  const recognizedAsApparel = isEcommerceApparelProduct({ product, batches });
  if (!productId) {
    return {
      recognizedAsApparel: false,
      variants: [],
      conflicts: [],
      availabilityReasonCode: null,
      sourceAvailable: null,
      stockSnapshot: null
    };
  }

  const records = sortProjectionRecords(asArray(batches)
    .filter((batch) => isBatchEligibleForProjection({ batch, product, now }))
    .map((batch) => {
      const attributes = normalizeEcommerceApparelVariantAttributes(batch.attributes);
      const attributeKey = getEcommerceApparelVariantAttributeKey(attributes);
      const sku = getBatchSku(batch);
      return {
        batch,
        attributes,
        attributeKey,
        sku,
        identity: getCommercialIdentity({ productId, sku, attributeKey }),
        price: getBatchPrice(batch, product),
        available: Math.max(0, Number(getAvailableBatchStock(batch)) || 0)
      };
    })
    .filter((record) => record.identity));

  const groups = new Map();
  records.forEach((record) => {
    const current = groups.get(record.identity) || [];
    current.push(record);
    groups.set(record.identity, current);
  });

  const variants = [];
  const conflicts = [];
  for (const [identity, groupRecords] of groups.entries()) {
    const attributeKeys = new Set(groupRecords.map((record) => record.attributeKey));
    if (groupRecords[0]?.sku && attributeKeys.size > 1) {
      conflicts.push({
        code: 'ECOMMERCE_APPAREL_VARIANT_ATTRIBUTE_CONFLICT',
        identity,
        sku: groupRecords[0].sku
      });
      continue;
    }

    const prices = Array.from(new Set(groupRecords.map((record) => record.price)));
    if (prices.length !== 1 || prices[0] === null) {
      conflicts.push({
        code: 'ECOMMERCE_APPAREL_VARIANT_PRICE_CONFLICT',
        identity,
        sku: groupRecords[0]?.sku || null
      });
      continue;
    }

    const attributes = resolveGroupAttributes(groupRecords);
    const publicName = getVariantPublicName(attributes);
    if (!publicName) continue;
    const availableStock = Number(groupRecords.reduce(
      (sum, record) => sum + record.available,
      0
    ).toFixed(3));
    const parentPrice = asMoney(product.price, 0);
    const variantPrice = prices[0];
    const priceDiffers = Math.abs(variantPrice - parentPrice) > PRICE_EPSILON;

    variants.push({
      sourceVariantRef: identity,
      sourceProductId: null,
      localProductRef: productId,
      sku: groupRecords[0]?.sku || null,
      publicName,
      optionValues: attributes,
      priceMode: priceDiffers ? 'absolute' : 'base',
      priceValue: priceDiffers ? variantPrice : 0,
      imageUrl: getVariantImage({ records: groupRecords, product }),
      trackStock: true,
      stockMode,
      stockSnapshot: availableStock,
      sourceAvailable: availableStock > 0,
      manualAvailable: true,
      isAvailable: availableStock > 0,
      metadata: {
        source: 'product_batches',
        identityKind: groupRecords[0]?.sku ? 'sku' : 'attributes'
      }
    });
  }

  if (conflicts.length > 0) {
    throw createProjectionError(conflicts[0].code, { conflicts });
  }

  variants.sort((left, right) => (
    left.publicName.localeCompare(right.publicName, 'es-MX')
    || left.sourceVariantRef.localeCompare(right.sourceVariantRef)
  ));

  const orderedVariants = variants.map((variant, displayOrder) => ({
    ...variant,
    displayOrder
  }));
  const stockSnapshot = recognizedAsApparel
    ? Number(orderedVariants.reduce(
        (sum, variant) => sum + Math.max(0, Number(variant.stockSnapshot) || 0),
        0
      ).toFixed(3))
    : null;
  const sourceAvailable = recognizedAsApparel
    ? orderedVariants.some((variant) => variant.sourceAvailable === true)
    : null;

  return {
    recognizedAsApparel,
    variants: orderedVariants,
    conflicts: [],
    availabilityReasonCode: recognizedAsApparel && orderedVariants.length === 0
      ? ECOMMERCE_APPAREL_UNAVAILABLE_REASON
      : null,
    sourceAvailable,
    stockSnapshot
  };
};

export const decorateProductWithEcommerceApparelProjection = ({
  product = {},
  projection
} = {}) => {
  const resolvedProjection = projection || projectProductBatchesToEcommerceVariants({ product });
  if (resolvedProjection.recognizedAsApparel !== true) return product;
  return {
    ...product,
    variants: resolvedProjection.variants,
    [ECOMMERCE_APPAREL_PROJECTION_STATE_KEY]: {
      recognizedAsApparel: true,
      availabilityReasonCode: resolvedProjection.availabilityReasonCode,
      sourceAvailable: resolvedProjection.sourceAvailable === true,
      stockSnapshot: Math.max(0, Number(resolvedProjection.stockSnapshot) || 0)
    }
  };
};

export const getEcommerceApparelProjectionState = (product = {}) => {
  const state = asObject(product[ECOMMERCE_APPAREL_PROJECTION_STATE_KEY]);
  if (state.recognizedAsApparel !== true) return null;
  return {
    recognizedAsApparel: true,
    availabilityReasonCode: asText(state.availabilityReasonCode) || null,
    sourceAvailable: state.sourceAvailable === true,
    stockSnapshot: Math.max(0, Number(state.stockSnapshot) || 0)
  };
};

export const getEcommerceVariantSelection = (item = {}) => {
  const options = asObject(item.ecommerceOptions ?? item.options);
  const variant = asObject(options.variant ?? item.configurationSnapshot?.variant);
  const sku = normalizeSku(variant.sku ?? item.sku);
  const sourceVariantRef = asText(
    variant.sourceVariantRef
    ?? variant.source_variant_ref
    ?? item.sourceVariantRef
    ?? item.source_variant_ref
  );
  const optionValues = normalizeEcommerceApparelVariantAttributes(
    variant.optionValues ?? variant.option_values ?? item.variantAttributes
  );
  const attributeKey = getEcommerceApparelVariantAttributeKey(optionValues);
  const selected = Boolean(sku || sourceVariantRef || attributeKey);
  return {
    selected,
    sku: sku || null,
    sourceVariantRef: sourceVariantRef || null,
    optionValues,
    attributeKey: attributeKey || null,
    publicName: asText(variant.name ?? variant.publicName ?? variant.public_name) || null
  };
};

const getDistinctAttributeKeys = (batches = []) => new Set(
  batches.map((batch) => getEcommerceApparelVariantAttributeKey(
    normalizeEcommerceApparelVariantAttributes(batch.attributes)
  )).filter(Boolean)
);

export const resolveEcommerceVariantBatchCandidates = ({
  item = {},
  product = {},
  batches = [],
  now = new Date()
} = {}) => {
  const selection = getEcommerceVariantSelection(item);
  if (!selection.selected) return { matched: false, selection, candidates: [] };

  const eligible = asArray(batches).filter((batch) => isBatchEligibleForProjection({
    batch,
    product,
    now
  }));
  let candidates = [];

  if (selection.sku) {
    candidates = eligible.filter((batch) => getBatchSku(batch) === selection.sku);
    if (candidates.length > 0 && getDistinctAttributeKeys(candidates).size > 1) {
      return {
        matched: true,
        selection,
        candidates: [],
        code: 'ECOMMERCE_VARIANT_LOCAL_MAPPING_AMBIGUOUS'
      };
    }
    if (
      candidates.length > 0
      && selection.attributeKey
      && !candidates.every((batch) => (
        getEcommerceApparelVariantAttributeKey(
          normalizeEcommerceApparelVariantAttributes(batch.attributes)
        ) === selection.attributeKey
      ))
    ) {
      return {
        matched: true,
        selection,
        candidates: [],
        code: 'ECOMMERCE_VARIANT_SELECTION_STALE'
      };
    }
  } else if (selection.attributeKey) {
    candidates = eligible.filter((batch) => (
      !getBatchSku(batch)
      && getEcommerceApparelVariantAttributeKey(
        normalizeEcommerceApparelVariantAttributes(batch.attributes)
      ) === selection.attributeKey
    ));
  }

  if (candidates.length === 0) {
    return {
      matched: true,
      selection,
      candidates: [],
      code: 'ECOMMERCE_VARIANT_LOCAL_MAPPING_MISSING'
    };
  }

  return {
    matched: true,
    selection,
    candidates: sortBatchesByFefo(candidates),
    code: null
  };
};

export const selectEcommerceVariantBatch = ({
  item = {},
  product = {},
  batches = [],
  requiredQuantity = Number(item.quantity) || 0,
  now = new Date()
} = {}) => {
  const resolved = resolveEcommerceVariantBatchCandidates({ item, product, batches, now });
  if (!resolved.matched || resolved.code) return resolved;
  const required = Number(requiredQuantity);
  if (!Number.isFinite(required) || required <= 0) {
    return { ...resolved, candidates: [], code: 'ECOMMERCE_VARIANT_SELECTION_STALE' };
  }
  const selectedBatch = resolved.candidates.find((batch) => (
    getAvailableBatchStock(batch) + 0.0001 >= required
  ));
  if (!selectedBatch) {
    return {
      ...resolved,
      selectedBatch: null,
      availableStock: resolved.candidates.reduce(
        (sum, batch) => sum + getAvailableBatchStock(batch),
        0
      ),
      code: 'ECOMMERCE_VARIANT_STOCK_INSUFFICIENT'
    };
  }
  return {
    ...resolved,
    selectedBatch,
    availableStock: getAvailableBatchStock(selectedBatch),
    code: null
  };
};

export const ecommerceApparelVariantInternals = Object.freeze({
  PRICE_EPSILON,
  BLOCKED_BATCH_STATUSES,
  EXPIRY_REQUIRED_MODES,
  normalizeComparableText,
  normalizeSku,
  stableHash,
  getCommercialIdentity,
  isBatchLifecycleEligible,
  isBatchEligibleForProjection,
  getVariantPublicName,
  sortProjectionRecords,
  productDeclaresApparel
});
