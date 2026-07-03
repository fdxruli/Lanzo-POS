const toText = (value) => String(value ?? '').trim();

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const toNumber = (value, fallback = 0) => {
  if (!hasValue(value)) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNonNegativeNumber = (value, fallback = 0) => Math.max(0, toNumber(value, fallback));

const toPositiveNumberOrNull = (value) => {
  const parsed = toNumber(value, NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeQuantity = (value) => toNonNegativeNumber(value, 0);

const hasLegacyQuantity = (modifier = {}) => (
  modifier?.quantity !== undefined
  && modifier?.quantity !== null
  && modifier?.quantity !== ''
);

const getModifierName = (modifier = {}) => toText(
  modifier.name
    ?? modifier.label
    ?? modifier.modifierName
    ?? modifier.modifier_name
    ?? modifier.optionName
    ?? modifier.option_name
);

const getModifierId = (modifier = {}) => toText(
  modifier.id
    ?? modifier.modifierId
    ?? modifier.modifier_id
    ?? modifier.optionId
    ?? modifier.option_id
    ?? modifier.modifierOptionId
    ?? modifier.modifier_option_id
) || null;

const getModifierOptionId = (modifier = {}) => toText(
  modifier.optionId
    ?? modifier.option_id
    ?? modifier.modifierOptionId
    ?? modifier.modifier_option_id
) || null;

const getModifierPrice = (modifier = {}) => toNonNegativeNumber(
  modifier.price
    ?? modifier.extraPrice
    ?? modifier.extra_price
    ?? modifier.modifierPrice
    ?? modifier.modifier_price,
  0
);

const getIngredientId = (modifier = {}) => toText(
  modifier.ingredientId
    ?? modifier.ingredient_id
) || null;

const getIngredientQuantity = (modifier = {}) => {
  const hasExplicitQuantity = modifier.ingredientQuantity !== undefined
    || modifier.ingredient_quantity !== undefined;
  const explicitQuantity = modifier.ingredientQuantity ?? modifier.ingredient_quantity;
  const legacyQuantity = modifier.quantity;

  return toPositiveNumberOrNull(hasExplicitQuantity ? explicitQuantity : legacyQuantity);
};

const getIngredientUnit = (modifier = {}) => toText(
  modifier.ingredientUnit
    ?? modifier.ingredient_unit
    ?? modifier.unit
    ?? modifier.measurementUnit
    ?? modifier.measurement_unit
) || null;

const getTracksInventory = ({ modifier = {}, ingredientId, ingredientQuantity }) => {
  if (modifier.tracksInventory !== undefined || modifier.tracks_inventory !== undefined) {
    return Boolean(modifier.tracksInventory ?? modifier.tracks_inventory);
  }

  return Boolean(ingredientId && ingredientQuantity > 0);
};

export const normalizeRestaurantModifierIdentity = (modifier = {}) => {
  if (typeof modifier === 'string') {
    return {
      id: null,
      optionId: null,
      name: toText(modifier),
      price: 0,
      ingredientId: null,
      ingredientQuantity: null,
      ingredientUnit: null,
      tracksInventory: false
    };
  }

  if (!modifier || typeof modifier !== 'object') {
    return {
      id: null,
      optionId: null,
      name: '',
      price: 0,
      ingredientId: null,
      ingredientQuantity: null,
      ingredientUnit: null,
      tracksInventory: false
    };
  }

  const id = getModifierId(modifier);
  const optionId = getModifierOptionId(modifier);
  const name = getModifierName(modifier);
  const price = getModifierPrice(modifier);
  const ingredientId = getIngredientId(modifier);
  const ingredientQuantity = getIngredientQuantity(modifier);
  const ingredientUnit = ingredientId ? getIngredientUnit(modifier) : null;
  const tracksInventory = getTracksInventory({ modifier, ingredientId, ingredientQuantity });

  return {
    ...modifier,
    id,
    optionId,
    name,
    price,
    ingredientId,
    ingredientQuantity,
    ingredientUnit,
    tracksInventory,
    ...(hasLegacyQuantity(modifier) ? { quantity: normalizeQuantity(modifier.quantity) } : {})
  };
};

export const normalizeSelectedModifiersForPersistence = (selectedModifiers = []) => (
  Array.isArray(selectedModifiers)
    ? selectedModifiers.map(normalizeRestaurantModifierIdentity).filter((modifier) => modifier.name)
    : []
);

export const normalizeRestaurantModifierForSnapshot = (modifier = {}) => {
  const normalized = normalizeRestaurantModifierIdentity(modifier);

  return {
    id: normalized.id,
    optionId: normalized.optionId,
    name: normalized.name,
    price: normalized.price,
    ingredientId: normalized.ingredientId,
    ingredientQuantity: normalized.ingredientQuantity,
    ingredientUnit: normalized.ingredientUnit,
    tracksInventory: Boolean(normalized.tracksInventory),
    quantity: hasLegacyQuantity(normalized) ? normalizeQuantity(normalized.quantity) : null,
    unit: hasLegacyQuantity(normalized)
      ? toText(normalized.unit ?? normalized.ingredientUnit ?? normalized.ingredient_unit) || null
      : null
  };
};

export const buildRestaurantModifierIdentityKey = (modifier = {}) => {
  const normalized = normalizeRestaurantModifierForSnapshot(modifier);
  return [
    normalized.id || '',
    normalized.optionId || '',
    normalized.name || '',
    String(normalized.price ?? 0),
    normalized.ingredientId || '',
    String(normalized.ingredientQuantity ?? ''),
    normalized.ingredientUnit || '',
    normalized.tracksInventory ? '1' : '0',
    String(normalized.quantity ?? ''),
    normalized.unit || ''
  ].join('|');
};

export const normalizeSelectedModifiersForSnapshot = (selectedModifiers = []) => (
  Array.isArray(selectedModifiers)
    ? selectedModifiers
      .map(normalizeRestaurantModifierForSnapshot)
      .filter((modifier) => modifier.name)
      .sort((left, right) => (
        buildRestaurantModifierIdentityKey(left).localeCompare(buildRestaurantModifierIdentityKey(right))
      ))
    : []
);

export default {
  normalizeRestaurantModifierIdentity,
  normalizeSelectedModifiersForPersistence,
  normalizeRestaurantModifierForSnapshot,
  normalizeSelectedModifiersForSnapshot,
  buildRestaurantModifierIdentityKey
};
