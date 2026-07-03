const toText = (value) => String(value ?? '').trim();

const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getModifierName = (modifier = {}) => {
  if (typeof modifier === 'string') return toText(modifier);
  return toText(
    modifier?.name
      ?? modifier?.label
      ?? modifier?.modifierName
      ?? modifier?.modifier_name
      ?? modifier?.optionName
      ?? modifier?.option_name
  );
};

const getModifierPrice = (modifier = {}) => {
  if (!modifier || typeof modifier === 'string') return 0;
  return Math.max(0, toNumber(
    modifier.price
      ?? modifier.extraPrice
      ?? modifier.extra_price
      ?? modifier.modifierPrice
      ?? modifier.modifier_price,
    0
  ));
};

const getInventoryQuantity = (modifier = {}) => {
  if (!modifier || typeof modifier === 'string') return 0;
  return Math.max(0, toNumber(
    modifier.ingredientQuantity
      ?? modifier.ingredient_quantity
      ?? modifier.quantity,
    0
  ));
};

const getInventoryUnit = (modifier = {}) => {
  if (!modifier || typeof modifier === 'string') return '';
  return toText(
    modifier.ingredientUnit
      ?? modifier.ingredient_unit
      ?? modifier.unit
      ?? modifier.measurementUnit
  );
};

const formatCompactMoney = (value) => {
  const amount = getModifierPrice({ price: value });
  if (amount <= 0) return '';

  return amount.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2
  }).replace(/\s?MXN$/i, '');
};

export const formatSelectedModifierLabel = (modifier = {}, options = {}) => {
  const {
    showPrice = true,
    showInventoryDetail = false
  } = options;

  const name = getModifierName(modifier);
  if (!name) return '';

  const price = getModifierPrice(modifier);
  const priceLabel = showPrice && price > 0 ? ` +${formatCompactMoney(price)}` : '';

  if (!showInventoryDetail) {
    return `${name}${priceLabel}`;
  }

  const quantity = getInventoryQuantity(modifier);
  const unit = getInventoryUnit(modifier);
  const inventoryLabel = quantity > 0
    ? ` (${quantity}${unit ? ` ${unit}` : ''})`
    : '';

  return `${name}${priceLabel}${inventoryLabel}`;
};

export const formatSelectedModifiersForDisplay = (selectedModifiers = [], options = {}) => (
  Array.isArray(selectedModifiers)
    ? selectedModifiers.map((modifier) => formatSelectedModifierLabel(modifier, options)).filter(Boolean)
    : []
);

export const getSelectedModifiersTotal = (selectedModifiers = []) => (
  Array.isArray(selectedModifiers)
    ? selectedModifiers.reduce((total, modifier) => total + getModifierPrice(modifier), 0)
    : 0
);

export const hasInventoryTrackedModifiers = (selectedModifiers = []) => (
  Array.isArray(selectedModifiers)
    && selectedModifiers.some((modifier) => {
      if (!modifier || typeof modifier === 'string') return false;
      return Boolean(
        modifier.tracksInventory === true
          || modifier.tracks_inventory === true
          || (toText(modifier.ingredientId ?? modifier.ingredient_id) && getInventoryQuantity(modifier) > 0)
      );
    })
);

export default {
  formatSelectedModifierLabel,
  formatSelectedModifiersForDisplay,
  getSelectedModifiersTotal,
  hasInventoryTrackedModifiers
};
