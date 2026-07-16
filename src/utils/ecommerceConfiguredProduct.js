const CONFIGURED_LINE_PREFIX = 'cfg:v1:';
const CONFIGURATION_REVISION_PATTERN = /^[a-f0-9]{64}$/;

const asObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);
const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const asMoney = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Number(number.toFixed(2))) : 0;
};
const normalizeConfigurationRevision = (value) => {
  const revision = asText(value).toLowerCase();
  return CONFIGURATION_REVISION_PATTERN.test(revision) ? revision : '';
};
const uniqueSorted = (values) => Array.from(new Set(values.filter(Boolean)))
  .sort((left, right) => left.localeCompare(right, 'es-MX'));

export function canonicalizeEcommerceSelections(selections = []) {
  return asArray(selections)
    .map((selection) => ({
      groupId: asText(selection?.groupId),
      optionIds: uniqueSorted(asArray(selection?.optionIds).map(asText))
    }))
    .filter((selection) => selection.groupId)
    .sort((left, right) => left.groupId.localeCompare(right.groupId));
}

export function buildEcommerceConfiguredLineKey({
  productId,
  variantId = null,
  selections = []
} = {}) {
  const payload = {
    productId: asText(productId),
    variantId: asText(variantId) || null,
    selections: canonicalizeEcommerceSelections(selections)
  };
  if (!payload.productId) return '';
  return `${CONFIGURED_LINE_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
}

export function decodeEcommerceConfiguredLineKey(lineKey) {
  const value = asText(lineKey);
  if (!value.startsWith(CONFIGURED_LINE_PREFIX)) return null;
  try {
    const decoded = JSON.parse(decodeURIComponent(value.slice(CONFIGURED_LINE_PREFIX.length)));
    const productId = asText(decoded?.productId);
    if (!productId) return null;
    return {
      productId,
      variantId: asText(decoded?.variantId) || null,
      selections: canonicalizeEcommerceSelections(decoded?.selections)
    };
  } catch {
    return null;
  }
}

export function normalizePublicProductConfiguration(rawDetail) {
  const source = asObject(rawDetail);
  const rawProduct = asObject(source.product);
  const product = {
    id: asText(rawProduct.id),
    name: asText(rawProduct.name) || 'Producto',
    description: asText(rawProduct.description),
    imageUrl: asText(rawProduct.imageUrl),
    currency: (asText(rawProduct.currency) || 'MXN').toUpperCase(),
    configurationType: asText(rawProduct.configurationType) || 'simple',
    configurationVersion: Math.max(1, Math.floor(Number(rawProduct.configurationVersion) || 1)),
    configurationRevision: normalizeConfigurationRevision(rawProduct.configurationRevision),
    requiresConfiguration: rawProduct.requiresConfiguration === true,
    hasVariants: rawProduct.hasVariants === true,
    hasOptionGroups: rawProduct.hasOptionGroups === true,
    basePrice: asMoney(rawProduct.basePrice),
    isAvailable: rawProduct.isAvailable === true,
    availability: {
      source: asText(rawProduct.availability?.source),
      status: asText(rawProduct.availability?.status),
      message: asText(rawProduct.availability?.message)
    }
  };

  const variants = asArray(source.variants).map((rawVariant) => {
    const variant = asObject(rawVariant);
    const optionValues = Object.entries(asObject(variant.optionValues)).reduce((result, [key, value]) => {
      const normalizedKey = asText(key);
      const normalizedValue = asText(value);
      if (normalizedKey && normalizedValue) result[normalizedKey] = normalizedValue;
      return result;
    }, {});
    const stock = asObject(variant.stock);
    return {
      id: asText(variant.id),
      publicName: asText(variant.publicName),
      optionValues,
      priceMode: ['base', 'delta', 'absolute'].includes(variant.priceMode)
        ? variant.priceMode
        : 'base',
      priceValue: asMoney(variant.priceValue),
      imageUrl: asText(variant.imageUrl),
      stock: {
        mode: ['hidden', 'status', 'exact'].includes(stock.mode) ? stock.mode : 'hidden',
        status: ['available', 'out_of_stock'].includes(stock.status) ? stock.status : null,
        quantity: stock.mode === 'exact' && Number.isFinite(Number(stock.quantity))
          ? Math.max(0, Math.floor(Number(stock.quantity)))
          : null
      },
      isAvailable: variant.isAvailable === true,
      displayOrder: Number.isFinite(Number(variant.displayOrder))
        ? Number(variant.displayOrder)
        : 0
    };
  }).filter((variant) => variant.id);

  const groups = asArray(source.groups).map((rawGroup) => {
    const group = asObject(rawGroup);
    const selectionType = group.selectionType === 'multiple' ? 'multiple' : 'single';
    const minSelect = Math.max(0, Math.floor(Number(group.minSelect) || 0));
    const maxSelect = Math.max(
      minSelect,
      Math.floor(Number(group.maxSelect) || (selectionType === 'single' ? 1 : minSelect))
    );
    return {
      id: asText(group.id),
      publicName: asText(group.publicName) || 'Opciones',
      selectionType,
      required: group.required === true,
      minSelect,
      maxSelect: selectionType === 'single' ? Math.min(1, maxSelect) : maxSelect,
      displayOrder: Number.isFinite(Number(group.displayOrder)) ? Number(group.displayOrder) : 0,
      options: asArray(group.options).map((rawOption) => ({
        id: asText(rawOption?.id),
        publicName: asText(rawOption?.publicName) || 'Opción',
        priceDelta: asMoney(rawOption?.priceDelta),
        isAvailable: rawOption?.isAvailable === true,
        displayOrder: Number.isFinite(Number(rawOption?.displayOrder))
          ? Number(rawOption.displayOrder)
          : 0
      })).filter((option) => option.id)
    };
  }).filter((group) => group.id);

  return {
    success: source.success === true,
    catalogRevision: Number.isSafeInteger(Number(source.catalogRevision))
      ? Number(source.catalogRevision)
      : null,
    product,
    variants: variants.sort((a, b) => (
      a.displayOrder - b.displayOrder || a.publicName.localeCompare(b.publicName, 'es-MX')
    )),
    groups: groups.sort((a, b) => (
      a.displayOrder - b.displayOrder || a.publicName.localeCompare(b.publicName, 'es-MX')
    ))
  };
}

export function getEcommerceVariantAxes(detail) {
  const axes = new Map();
  asArray(detail?.variants).forEach((variant) => {
    Object.entries(asObject(variant.optionValues)).forEach(([attribute, value]) => {
      if (!axes.has(attribute)) axes.set(attribute, new Set());
      axes.get(attribute).add(value);
    });
  });
  return Array.from(axes.entries())
    .map(([attribute, values]) => ({
      attribute,
      values: Array.from(values).sort((a, b) => a.localeCompare(b, 'es-MX'))
    }))
    .sort((a, b) => a.attribute.localeCompare(b.attribute, 'es-MX'));
}

const variantMatches = (variant, attributes, ignoredAttribute = null) => (
  Object.entries(asObject(attributes)).every(([attribute, value]) => (
    attribute === ignoredAttribute
    || !value
    || variant.optionValues?.[attribute] === value
  ))
);

export function isEcommerceVariantValueAvailable(
  detail,
  selectedAttributes,
  attribute,
  value
) {
  return asArray(detail?.variants).some((variant) => (
    variant.isAvailable === true
    && variant.optionValues?.[attribute] === value
    && variantMatches(variant, selectedAttributes, attribute)
  ));
}

export function findEcommerceVariant(detail, selectedAttributes) {
  const axes = getEcommerceVariantAxes(detail);
  if (axes.length === 0) return null;
  const complete = axes.every(({ attribute }) => asText(selectedAttributes?.[attribute]));
  if (!complete) return null;
  return asArray(detail?.variants).find((variant) => (
    variant.isAvailable === true
    && axes.every(({ attribute }) => (
      variant.optionValues?.[attribute] === selectedAttributes?.[attribute]
    ))
  )) || null;
}

export function reconcileEcommerceVariantAttributes(detail, attributes, changedAttribute) {
  const next = { ...asObject(attributes) };
  const axes = getEcommerceVariantAxes(detail);
  axes.forEach(({ attribute }) => {
    if (attribute === changedAttribute || !next[attribute]) return;
    const hasMatch = asArray(detail?.variants).some((variant) => (
      variant.isAvailable === true
      && variantMatches(variant, next)
    ));
    if (!hasMatch) delete next[attribute];
  });
  return next;
}

export function validateEcommerceConfiguration(detail, {
  variantId = null,
  selections = []
} = {}) {
  const errors = {};
  const product = asObject(detail?.product);
  const variants = asArray(detail?.variants);
  const groups = asArray(detail?.groups);
  const canonicalSelections = canonicalizeEcommerceSelections(selections);
  const selectionMap = new Map(canonicalSelections.map((selection) => [
    selection.groupId,
    selection.optionIds
  ]));

  if (product.hasVariants || product.configurationType === 'variant_parent') {
    const variant = variants.find((candidate) => candidate.id === variantId);
    if (!variant) errors.variant = 'Selecciona una variante.';
    else if (!variant.isAvailable) errors.variant = 'Esta variante ya no está disponible.';
  }

  groups.forEach((group) => {
    const optionIds = selectionMap.get(group.id) || [];
    const availableIds = new Set(
      group.options.filter((option) => option.isAvailable).map((option) => option.id)
    );
    if (optionIds.some((optionId) => !availableIds.has(optionId))) {
      errors[group.id] = 'Esta opción ya no está disponible.';
      return;
    }
    if (group.selectionType === 'single' && optionIds.length > 1) {
      errors[group.id] = 'Selecciona una sola opción.';
      return;
    }
    if (optionIds.length < group.minSelect) {
      errors[group.id] = group.minSelect === 1
        ? 'Selecciona una opción.'
        : `Selecciona al menos ${group.minSelect}.`;
      return;
    }
    if (optionIds.length > group.maxSelect) {
      errors[group.id] = `Puedes elegir hasta ${group.maxSelect}.`;
    }
  });

  if (
    product.requiresConfiguration
    && !variantId
    && canonicalSelections.every((selection) => selection.optionIds.length === 0)
  ) {
    errors.configuration = 'Selecciona las opciones requeridas.';
  }

  if (
    (product.hasVariants || product.hasOptionGroups || product.requiresConfiguration)
    && !product.configurationRevision
  ) {
    errors.configuration = 'La configuración cambió. Vuelve a cargar las opciones.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    selections: canonicalSelections
  };
}

export function calculateEcommerceConfiguredPrice(detail, {
  variantId = null,
  selections = []
} = {}) {
  const product = asObject(detail?.product);
  const baseUnitPrice = asMoney(product.basePrice);
  const variant = asArray(detail?.variants).find((candidate) => candidate.id === variantId) || null;
  let variantAdjustment = 0;
  let variantUnitPrice = baseUnitPrice;

  if (variant?.priceMode === 'absolute') {
    variantUnitPrice = asMoney(variant.priceValue);
    variantAdjustment = Number((variantUnitPrice - baseUnitPrice).toFixed(2));
  } else if (variant?.priceMode === 'delta') {
    variantAdjustment = asMoney(variant.priceValue);
    variantUnitPrice = Number((baseUnitPrice + variantAdjustment).toFixed(2));
  }

  const optionMap = new Map(
    asArray(detail?.groups).flatMap((group) => group.options.map((option) => [option.id, option]))
  );
  const selectedOptionIds = canonicalizeEcommerceSelections(selections)
    .flatMap((selection) => selection.optionIds);
  const optionsAdjustment = Number(selectedOptionIds.reduce(
    (total, optionId) => total + asMoney(optionMap.get(optionId)?.priceDelta),
    0
  ).toFixed(2));
  const finalUnitPrice = Math.max(0, Number((variantUnitPrice + optionsAdjustment).toFixed(2)));

  return {
    baseUnitPrice,
    variantAdjustment,
    optionsAdjustment,
    finalUnitPrice
  };
}

export function getConfiguredLineMaximum(detail, variantId, portalMaximum = 99) {
  const safePortalMaximum = Math.max(1, Math.floor(Number(portalMaximum) || 99));
  const variant = asArray(detail?.variants).find((candidate) => candidate.id === variantId);
  if (variant?.stock?.mode === 'exact' && Number.isFinite(Number(variant.stock.quantity))) {
    return Math.max(0, Math.min(
      safePortalMaximum,
      Math.floor(Number(variant.stock.quantity))
    ));
  }
  return safePortalMaximum;
}

export function buildEcommerceConfiguredCartLine(detail, {
  variantId = null,
  selections = [],
  quantity = 1,
  maxItemQuantity = 99
} = {}) {
  const validation = validateEcommerceConfiguration(detail, { variantId, selections });
  if (!validation.valid) return { success: false, ...validation };

  const product = detail.product;
  const variant = detail.variants.find((candidate) => candidate.id === variantId) || null;
  const pricing = calculateEcommerceConfiguredPrice(detail, {
    variantId,
    selections: validation.selections
  });
  const groupMap = new Map(detail.groups.map((group) => [group.id, group]));
  const selectedGroups = validation.selections.map((selection) => {
    const group = groupMap.get(selection.groupId);
    if (!group) return null;
    const optionMap = new Map(group.options.map((option) => [option.id, option]));
    return {
      id: group.id,
      name: group.publicName,
      selectionType: group.selectionType,
      options: selection.optionIds.map((optionId) => optionMap.get(optionId))
        .filter(Boolean)
        .map((option) => ({
          id: option.id,
          name: option.publicName,
          priceDelta: option.priceDelta
        }))
    };
  }).filter(Boolean);
  const lineKey = buildEcommerceConfiguredLineKey({
    productId: product.id,
    variantId,
    selections: validation.selections
  });
  const maxQuantity = getConfiguredLineMaximum(detail, variantId, maxItemQuantity);
  const safeQuantity = Math.max(
    1,
    Math.min(maxQuantity || 1, Math.floor(Number(quantity) || 1))
  );

  return {
    success: true,
    lineKey,
    productId: product.id,
    quantity: safeQuantity,
    maxQuantity,
    variantId,
    selections: validation.selections,
    configurationVersion: product.configurationVersion,
    configurationRevision: product.configurationRevision,
    estimatedUnitPrice: pricing.finalUnitPrice,
    configurationSnapshot: {
      version: 1,
      configurationVersion: product.configurationVersion,
      configurationRevision: product.configurationRevision,
      configurationType: product.configurationType,
      variant: variant ? {
        id: variant.id,
        name: variant.publicName,
        optionValues: variant.optionValues,
        imageUrl: variant.imageUrl
      } : null,
      groups: selectedGroups,
      pricing
    },
    display: {
      variantName: variant?.publicName || '',
      groups: selectedGroups.map((group) => ({
        name: group.name,
        options: group.options.map((option) => option.name)
      }))
    }
  };
}

export function buildMinimalConfiguredOrderItem(item) {
  const configurationLine = asObject(item?.configurationLine || item?.product?.configurationLine);
  const source = Object.keys(configurationLine).length > 0 ? configurationLine : asObject(item);
  const decoded = decodeEcommerceConfiguredLineKey(
    source.lineKey || item?.lineKey || item?.productId || item?.product?.id
  );
  if (!decoded) {
    return {
      productId: asText(item?.productId || item?.product?.id),
      quantity: Number(item?.quantity)
    };
  }

  const configurationRevision = normalizeConfigurationRevision(
    source.configurationRevision || source.configurationSnapshot?.configurationRevision
  );
  return {
    productId: decoded.productId,
    quantity: Number(item?.quantity ?? source.quantity),
    variantId: decoded.variantId,
    selections: decoded.selections,
    configurationVersion: Math.max(1, Math.floor(Number(
      source.configurationVersion || source.configurationSnapshot?.configurationVersion
    ) || 1)),
    configurationRevision
  };
}

export const ecommerceConfiguredProductInternals = Object.freeze({
  CONFIGURED_LINE_PREFIX,
  CONFIGURATION_REVISION_PATTERN,
  asMoney,
  normalizeConfigurationRevision,
  variantMatches
});
