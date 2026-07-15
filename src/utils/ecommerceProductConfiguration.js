const MODEL_VERSION = 1;
const MAX_VARIANTS = 100;
const MAX_OPTION_GROUPS = 20;
const MAX_OPTIONS = 100;
const MAX_ATTRIBUTE_LENGTH = 50;

export const ECOMMERCE_CONFIGURATION_TYPES = Object.freeze({
  SIMPLE: 'simple',
  RECIPE: 'recipe',
  VARIANT_PARENT: 'variant_parent',
  CONFIGURABLE: 'configurable'
});

export const ECOMMERCE_SELECTION_TYPES = Object.freeze({
  SINGLE: 'single',
  MULTIPLE: 'multiple'
});

const UNIT_ALIASES = new Map([
  ['pza', 'pza'], ['pzas', 'pza'], ['pieza', 'pza'], ['piezas', 'pza'],
  ['unidad', 'pza'], ['unidades', 'pza'], ['unit', 'pza'], ['units', 'pza'],
  ['kg', 'kg'], ['kgs', 'kg'], ['kilo', 'kg'], ['kilos', 'kg'],
  ['kilogramo', 'kg'], ['kilogramos', 'kg'],
  ['g', 'g'], ['gr', 'g'], ['grs', 'g'], ['gramo', 'g'], ['gramos', 'g'],
  ['l', 'lt'], ['lt', 'lt'], ['lts', 'lt'], ['litro', 'lt'], ['litros', 'lt'],
  ['ml', 'ml'], ['mililitro', 'ml'], ['mililitros', 'ml']
]);

const asRecord = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);
const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value, maxLength = 240) => (
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maxLength)
    : ''
);
const asBoolean = (value, fallback = false) => (
  typeof value === 'boolean' ? value : fallback
);
const asFinite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const slug = (value) => asText(value, 160)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const stableHash = (value) => {
  const source = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
};

export const createStableConfigurationId = (prefix, ...parts) => {
  const normalizedPrefix = slug(prefix) || 'ecom';
  const identity = parts.map((part) => {
    if (part && typeof part === 'object') {
      return JSON.stringify(
        Object.keys(part).sort().reduce((result, key) => {
          result[key] = part[key];
          return result;
        }, {})
      );
    }
    return asText(part, 500);
  }).join('|');
  return `${normalizedPrefix}_${stableHash(identity)}`;
};

export const normalizeInventoryUnit = (value) => (
  UNIT_ALIASES.get(asText(value, 40).toLowerCase()) || null
);

export const getInventoryUnitFamily = (value) => {
  const unit = normalizeInventoryUnit(value);
  if (unit === 'pza') return 'count';
  if (unit === 'kg' || unit === 'g') return 'mass';
  if (unit === 'lt' || unit === 'ml') return 'volume';
  return null;
};

export const convertInventoryQuantity = (quantity, fromUnit, toUnit) => {
  const amount = Number(quantity);
  const from = normalizeInventoryUnit(fromUnit);
  const to = normalizeInventoryUnit(toUnit);
  if (!Number.isFinite(amount) || !from || !to) return null;
  if (getInventoryUnitFamily(from) !== getInventoryUnitFamily(to)) return null;
  if (from === to) return amount;

  const toBase = {
    pza: (value) => value,
    kg: (value) => value * 1000,
    g: (value) => value,
    lt: (value) => value * 1000,
    ml: (value) => value
  };
  const fromBase = {
    pza: (value) => value,
    kg: (value) => value / 1000,
    g: (value) => value,
    lt: (value) => value / 1000,
    ml: (value) => value
  };
  return fromBase[to](toBase[from](amount));
};

const normalizeOptionValues = (value) => {
  const record = asRecord(value);
  return Object.keys(record)
    .sort()
    .reduce((result, key) => {
      const normalizedKey = asText(key, MAX_ATTRIBUTE_LENGTH);
      const normalizedValue = asText(record[key], MAX_ATTRIBUTE_LENGTH);
      if (normalizedKey && normalizedValue) result[normalizedKey] = normalizedValue;
      return result;
    }, {});
};

export const normalizeEcommerceVariant = (variant, {
  productRef = '',
  variantIndex = 0
} = {}) => {
  const source = asRecord(variant);
  const optionValues = normalizeOptionValues(
    source.optionValues ?? source.option_values ?? source.attributes
  );
  const sourceProductId = asText(
    source.sourceProductId ?? source.source_product_id ?? source.productId,
    160
  );
  const localProductRef = asText(
    source.localProductRef ?? source.local_product_ref ?? sourceProductId,
    160
  );
  const sku = asText(source.sku, 120).toUpperCase();
  const publicName = asText(
    source.publicName ?? source.public_name ?? source.name,
    160
  );
  const priceMode = ['base', 'delta', 'absolute'].includes(source.priceMode)
    ? source.priceMode
    : 'base';
  const priceValue = Math.max(0, asFinite(
    source.priceValue ?? source.price_value ?? source.priceDelta ?? source.price,
    0
  ));
  const identity = source.id || source.sourceVariantRef || source.source_variant_ref
    || sourceProductId || sku || optionValues || variantIndex;

  return {
    id: asText(source.id, 160)
      || createStableConfigurationId('evariant', productRef, identity),
    sourceVariantRef: asText(
      source.sourceVariantRef ?? source.source_variant_ref ?? source.id,
      160
    ) || null,
    sourceProductId: sourceProductId || null,
    localProductRef: localProductRef || null,
    sku: sku || null,
    publicName: publicName || null,
    optionValues,
    priceMode,
    priceValue,
    imageUrl: asText(source.imageUrl ?? source.image_url, 2_000) || null,
    imageRef: asText(source.imageRef ?? source.image_ref, 500) || null,
    trackStock: asBoolean(source.trackStock ?? source.track_stock, true),
    manualAvailable: asBoolean(
      source.manualAvailable ?? source.manual_available,
      true
    ),
    displayOrder: Math.max(0, Math.floor(asFinite(
      source.displayOrder ?? source.display_order,
      variantIndex
    ))),
    metadata: asRecord(source.metadata)
  };
};

export const normalizeEcommerceOption = (option, {
  productRef = '',
  groupRef = '',
  optionIndex = 0
} = {}) => {
  const source = asRecord(option);
  const sourceOptionRef = asText(
    source.sourceOptionRef ?? source.source_option_ref ?? source.id,
    160
  );
  const publicName = asText(
    source.publicName ?? source.public_name ?? source.name ?? source.label,
    160
  );
  const ingredientId = asText(
    source.sourceIngredientId
      ?? source.source_ingredient_id
      ?? source.ingredientId
      ?? source.ingredient_id,
    160
  );
  const ingredientQuantity = asFinite(
    source.ingredientQuantity
      ?? source.ingredient_quantity
      ?? source.quantity,
    0
  );
  const ingredientUnit = normalizeInventoryUnit(
    source.ingredientUnit ?? source.ingredient_unit ?? source.unit
  );
  const tracksInventory = asBoolean(
    source.tracksInventory ?? source.tracks_inventory,
    Boolean(ingredientId && ingredientQuantity > 0)
  );

  return {
    id: asText(source.id, 160)
      || createStableConfigurationId(
        'eoption',
        productRef,
        groupRef,
        sourceOptionRef || publicName || optionIndex
      ),
    sourceOptionRef: sourceOptionRef || null,
    publicName,
    priceDelta: Math.max(0, asFinite(
      source.priceDelta ?? source.price_delta ?? source.price,
      0
    )),
    sourceIngredientId: ingredientId || null,
    ingredientQuantity: tracksInventory ? ingredientQuantity : null,
    ingredientUnit: tracksInventory ? ingredientUnit : null,
    tracksInventory,
    manualAvailable: asBoolean(
      source.manualAvailable ?? source.manual_available,
      true
    ),
    displayOrder: Math.max(0, Math.floor(asFinite(
      source.displayOrder ?? source.display_order,
      optionIndex
    ))),
    metadata: asRecord(source.metadata)
  };
};

export const normalizeEcommerceOptionGroup = (group, {
  productRef = '',
  groupIndex = 0
} = {}) => {
  const source = asRecord(group);
  const sourceGroupRef = asText(
    source.sourceGroupRef ?? source.source_group_ref ?? source.id,
    160
  );
  const publicName = asText(
    source.publicName ?? source.public_name ?? source.name,
    160
  );
  const selectionType = source.selectionType === 'multiple' || source.multiple === true
    ? ECOMMERCE_SELECTION_TYPES.MULTIPLE
    : ECOMMERCE_SELECTION_TYPES.SINGLE;
  const required = asBoolean(source.required, false);
  const minSelect = Math.max(0, Math.floor(asFinite(
    source.minSelect ?? source.min_select ?? source.minSelections,
    required ? 1 : 0
  )));
  const requestedMax = Math.max(minSelect, Math.floor(asFinite(
    source.maxSelect ?? source.max_select ?? source.maxSelections,
    selectionType === ECOMMERCE_SELECTION_TYPES.SINGLE ? 1 : Math.max(1, minSelect)
  )));
  const maxSelect = selectionType === ECOMMERCE_SELECTION_TYPES.SINGLE
    ? Math.min(1, requestedMax)
    : requestedMax;
  const id = asText(source.id, 160)
    || createStableConfigurationId(
      'egroup',
      productRef,
      sourceGroupRef || publicName || groupIndex
    );
  const options = asArray(source.options)
    .slice(0, MAX_OPTIONS)
    .map((option, optionIndex) => normalizeEcommerceOption(option, {
      productRef,
      groupRef: id,
      optionIndex
    }));

  return {
    id,
    sourceGroupRef: sourceGroupRef || null,
    publicName,
    selectionType,
    required,
    minSelect: required ? Math.max(1, minSelect) : minSelect,
    maxSelect,
    displayOrder: Math.max(0, Math.floor(asFinite(
      source.displayOrder ?? source.display_order,
      groupIndex
    ))),
    options,
    metadata: asRecord(source.metadata)
  };
};

export const detectEcommerceProductConfiguration = (product = {}, input = {}) => {
  const source = asRecord(input);
  const recipe = asArray(source.recipe ?? product.recipe);
  const variants = asArray(source.variants ?? product.variants);
  const optionGroups = asArray(
    source.optionGroups
      ?? source.option_groups
      ?? source.modifiers
      ?? product.modifiers
  );
  const hasRecipe = recipe.length > 0;
  const hasVariants = variants.length > 0;
  const hasOptionGroups = optionGroups.length > 0;
  const requiredGroup = optionGroups.some((group) => (
    group?.required === true
    || Number(group?.minSelect ?? group?.min_select ?? group?.minSelections) > 0
  ));

  let type = ECOMMERCE_CONFIGURATION_TYPES.SIMPLE;
  if (hasVariants) type = ECOMMERCE_CONFIGURATION_TYPES.VARIANT_PARENT;
  else if (hasOptionGroups) type = ECOMMERCE_CONFIGURATION_TYPES.CONFIGURABLE;
  else if (hasRecipe) type = ECOMMERCE_CONFIGURATION_TYPES.RECIPE;

  return {
    type,
    version: MODEL_VERSION,
    hasRecipe,
    hasVariants,
    hasOptionGroups,
    requiresConfiguration: hasVariants || requiredGroup,
    tracksDerivedStock: hasRecipe || hasVariants
  };
};

export const normalizeEcommerceProductConfiguration = (product = {}, input = {}) => {
  const source = asRecord(input);
  const productRef = asText(
    source.productRef ?? product.id ?? product.localProductRef,
    160
  );
  const variants = asArray(source.variants ?? product.variants)
    .slice(0, MAX_VARIANTS)
    .map((variant, variantIndex) => normalizeEcommerceVariant(variant, {
      productRef,
      variantIndex
    }));
  const optionGroups = asArray(
    source.optionGroups
      ?? source.option_groups
      ?? source.modifiers
      ?? product.modifiers
  )
    .slice(0, MAX_OPTION_GROUPS)
    .map((group, groupIndex) => normalizeEcommerceOptionGroup(group, {
      productRef,
      groupIndex
    }));
  const optionCount = optionGroups.reduce(
    (sum, group) => sum + group.options.length,
    0
  );
  if (optionCount > MAX_OPTIONS) {
    throw new Error('ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED');
  }

  const detected = detectEcommerceProductConfiguration(product, {
    ...source,
    variants,
    optionGroups
  });

  return {
    ...detected,
    variants,
    optionGroups
  };
};

export const validateEcommerceProductConfiguration = (configuration = {}) => {
  const config = asRecord(configuration);
  const errors = [];
  if (!Object.values(ECOMMERCE_CONFIGURATION_TYPES).includes(config.type)) {
    errors.push('ECOMMERCE_CONFIGURATION_TYPE_INVALID');
  }
  if (Number(config.version) !== MODEL_VERSION) {
    errors.push('ECOMMERCE_CONFIGURATION_VERSION_INVALID');
  }
  if (asArray(config.variants).length > MAX_VARIANTS) {
    errors.push('ECOMMERCE_CONFIGURATION_VARIANT_LIMIT_EXCEEDED');
  }
  if (asArray(config.optionGroups).length > MAX_OPTION_GROUPS) {
    errors.push('ECOMMERCE_CONFIGURATION_GROUP_LIMIT_EXCEEDED');
  }

  const optionCount = asArray(config.optionGroups).reduce(
    (sum, group) => sum + asArray(group?.options).length,
    0
  );
  if (optionCount > MAX_OPTIONS) {
    errors.push('ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED');
  }

  asArray(config.variants).forEach((variant) => {
    if (Object.keys(asRecord(variant.optionValues)).length === 0) {
      errors.push('ECOMMERCE_VARIANT_OPTION_VALUES_REQUIRED');
    }
    if (!variant.sourceProductId && !variant.localProductRef) {
      errors.push('ECOMMERCE_VARIANT_SOURCE_REQUIRED');
    }
  });

  asArray(config.optionGroups).forEach((group) => {
    const min = Number(group.minSelect);
    const max = Number(group.maxSelect);
    if (!Number.isInteger(min) || min < 0 || !Number.isInteger(max) || max < min) {
      errors.push('ECOMMERCE_OPTION_GROUP_SELECTION_INVALID');
    }
    if (group.selectionType === 'single' && max > 1) {
      errors.push('ECOMMERCE_OPTION_GROUP_SINGLE_MAX_INVALID');
    }
    if (group.required === true && min < 1) {
      errors.push('ECOMMERCE_OPTION_GROUP_REQUIRED_MIN_INVALID');
    }
    asArray(group.options).forEach((option) => {
      if (Number(option.priceDelta) < 0) {
        errors.push('ECOMMERCE_OPTION_PRICE_INVALID');
      }
      if (
        option.tracksInventory === true
        && (
          !option.sourceIngredientId
          || !Number.isFinite(Number(option.ingredientQuantity))
          || Number(option.ingredientQuantity) <= 0
          || !normalizeInventoryUnit(option.ingredientUnit)
        )
      ) {
        errors.push('ECOMMERCE_OPTION_INVENTORY_INVALID');
      }
    });
  });

  return { valid: errors.length === 0, errors: Array.from(new Set(errors)) };
};

export const ecommerceProductConfigurationInternals = Object.freeze({
  MODEL_VERSION,
  MAX_VARIANTS,
  MAX_OPTION_GROUPS,
  MAX_OPTIONS,
  MAX_ATTRIBUTE_LENGTH,
  stableHash,
  normalizeOptionValues
});
