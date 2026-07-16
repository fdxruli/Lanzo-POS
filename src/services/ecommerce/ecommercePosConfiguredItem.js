const PRICE_EPSILON = 0.009;

const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);
const asText = (value) => String(value ?? '').trim();
const asNumber = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeKey = (value) => asText(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ');

const getSourceRef = (value = {}, kind = '') => asText(
  value[`source${kind}Ref`]
  ?? value[`source_${kind.toLowerCase()}_ref`]
  ?? value.sourceRef
  ?? value.source_ref
);

const getOptionPrice = (option = {}) => asNumber(
  option.price
  ?? option.priceDelta
  ?? option.price_delta
  ?? option.extraPrice
  ?? option.extra_price,
  0
);

const getIngredientQuantity = (option = {}) => asNumber(
  option.ingredientQuantity
  ?? option.ingredient_quantity
  ?? option.quantity,
  null
);

const getLocalModifierGroups = (product = {}) => asArray(product.modifiers);

const findUnique = (values = []) => values.length === 1 ? values[0] : null;

const findLocalGroup = (snapshotGroup = {}, localGroups = []) => {
  const sourceRef = getSourceRef(snapshotGroup, 'Group');
  if (sourceRef) {
    const byRef = localGroups.filter((group) => [
      group.id,
      group.groupId,
      group.group_id,
      getSourceRef(group, 'Group')
    ].map(asText).includes(sourceRef));
    if (byRef.length === 1) return byRef[0];
  }

  const nameKey = normalizeKey(snapshotGroup.name ?? snapshotGroup.publicName ?? snapshotGroup.public_name);
  if (!nameKey) return null;
  return findUnique(localGroups.filter((group) => (
    normalizeKey(group.name ?? group.publicName ?? group.public_name) === nameKey
  )));
};

const findLocalOption = (snapshotOption = {}, localOptions = []) => {
  const sourceRef = getSourceRef(snapshotOption, 'Option');
  if (sourceRef) {
    const byRef = localOptions.filter((option) => [
      option.id,
      option.optionId,
      option.option_id,
      getSourceRef(option, 'Option')
    ].map(asText).includes(sourceRef));
    if (byRef.length === 1) return byRef[0];
  }

  const nameKey = normalizeKey(snapshotOption.name ?? snapshotOption.publicName ?? snapshotOption.public_name);
  if (!nameKey) return null;
  const byName = localOptions.filter((option) => (
    normalizeKey(option.name ?? option.publicName ?? option.public_name) === nameKey
  ));
  if (byName.length === 1) return byName[0];

  const snapshotPrice = getOptionPrice(snapshotOption);
  return findUnique(byName.filter((option) => (
    Math.abs(getOptionPrice(option) - snapshotPrice) <= PRICE_EPSILON
  )));
};

const buildCanonicalModifier = (group = {}, option = {}) => {
  const ingredientId = asText(option.ingredientId ?? option.ingredient_id) || null;
  const ingredientQuantity = getIngredientQuantity(option);
  const ingredientUnit = asText(option.ingredientUnit ?? option.ingredient_unit ?? option.unit) || null;
  const tracksInventory = Boolean(
    option.tracksInventory === true
    || option.tracks_inventory === true
    || (ingredientId && ingredientQuantity > 0)
  );

  return {
    ...option,
    id: asText(option.id ?? option.optionId ?? option.option_id),
    optionId: asText(option.optionId ?? option.option_id ?? option.id),
    name: asText(option.name ?? option.publicName ?? option.public_name) || 'Opción',
    price: getOptionPrice(option),
    groupId: asText(group.id ?? group.groupId ?? group.group_id) || null,
    groupName: asText(group.name ?? group.publicName ?? group.public_name) || null,
    ingredientId: tracksInventory ? ingredientId : null,
    ingredientQuantity: tracksInventory ? ingredientQuantity : null,
    ingredientUnit: tracksInventory ? ingredientUnit : null,
    tracksInventory,
    ...(tracksInventory ? { quantity: ingredientQuantity } : {})
  };
};

const getSnapshotPricing = (item = {}) => {
  const options = asObject(item.ecommerceOptions);
  const pricing = asObject(options.pricing);
  const acceptedFinal = asNumber(
    pricing.finalUnitPrice
    ?? pricing.final_unit_price
    ?? item.ecommerceSnapshotPrice
    ?? item.price,
    0
  );
  const acceptedOptionAdjustment = asNumber(
    pricing.optionsAdjustment ?? pricing.options_adjustment,
    asArray(options.groups).reduce((sum, group) => (
      sum + asArray(group?.options).reduce((groupSum, option) => groupSum + getOptionPrice(option), 0)
    ), 0)
  );
  const acceptedVariantAdjustment = asNumber(
    pricing.variantAdjustment ?? pricing.variant_adjustment,
    getOptionPrice(asObject(options.variant))
  );
  const acceptedBase = asNumber(
    pricing.baseUnitPrice ?? pricing.base_unit_price,
    acceptedFinal - acceptedOptionAdjustment - acceptedVariantAdjustment
  );

  return {
    acceptedBase,
    acceptedFinal,
    acceptedOptionAdjustment,
    acceptedVariantAdjustment
  };
};

export const hasEcommerceConfigurationSnapshot = (item = {}) => {
  const options = asObject(item.ecommerceOptions);
  return asArray(options.groups).length > 0 || Object.keys(asObject(options.variant)).length > 0;
};

export const reconcileEcommerceConfiguredItem = ({ item = {}, product = {} } = {}) => {
  if (!hasEcommerceConfigurationSnapshot(item)) return item;

  const options = asObject(item.ecommerceOptions);
  const localGroups = getLocalModifierGroups(product);
  const selectedModifiers = [];
  const mappingErrors = [];

  asArray(options.groups).forEach((snapshotGroup) => {
    const localGroup = findLocalGroup(snapshotGroup, localGroups);
    if (!localGroup) {
      mappingErrors.push(`GROUP:${asText(snapshotGroup?.name) || asText(snapshotGroup?.id) || 'unknown'}`);
      return;
    }

    const localOptions = asArray(localGroup.options);
    asArray(snapshotGroup?.options).forEach((snapshotOption) => {
      const localOption = findLocalOption(snapshotOption, localOptions);
      if (!localOption) {
        mappingErrors.push(`OPTION:${asText(snapshotOption?.name) || asText(snapshotOption?.id) || 'unknown'}`);
        return;
      }
      selectedModifiers.push(buildCanonicalModifier(localGroup, localOption));
    });
  });

  const pricing = getSnapshotPricing(item);
  const currentBase = asNumber(product.price, 0);
  const currentModifierAdjustment = selectedModifiers.reduce((sum, modifier) => (
    sum + getOptionPrice(modifier)
  ), 0);
  const currentConfiguredPrice = currentBase
    + currentModifierAdjustment
    + pricing.acceptedVariantAdjustment;
  const acceptedCompositionMatches = Math.abs(
    (pricing.acceptedBase + pricing.acceptedOptionAdjustment + pricing.acceptedVariantAdjustment)
    - pricing.acceptedFinal
  ) <= PRICE_EPSILON;
  const status = mappingErrors.length === 0 && acceptedCompositionMatches
    ? 'resolved'
    : 'conflict';

  return {
    ...item,
    selectedModifiers: status === 'resolved' ? selectedModifiers : [],
    ecommerceAcceptedBasePrice: pricing.acceptedBase,
    ecommerceCurrentBasePosPrice: currentBase,
    ecommerceCurrentConfiguredPrice: currentConfiguredPrice,
    currentPosPrice: currentConfiguredPrice,
    ecommerceConfiguredModifierMappingStatus: status,
    ecommerceConfiguredModifierMappingErrors: mappingErrors,
    ecommerceConfiguredPriceCompositionValid: acceptedCompositionMatches
  };
};

export const reconcileEcommerceConfiguredItems = ({ items = [], products = [] } = {}) => {
  const productMap = new Map(asArray(products).map((product) => [asText(product?.id), product]));
  let changed = false;
  const nextItems = asArray(items).map((item) => {
    const productId = asText(item?.parentId ?? item?.id);
    const product = productMap.get(productId) || item;
    const next = reconcileEcommerceConfiguredItem({ item, product });
    if (JSON.stringify(next) !== JSON.stringify(item)) changed = true;
    return next;
  });
  return { items: nextItems, changed };
};

export const ecommercePosConfiguredItemInternals = Object.freeze({
  PRICE_EPSILON,
  normalizeKey,
  findLocalGroup,
  findLocalOption,
  getSnapshotPricing,
  buildCanonicalModifier
});
