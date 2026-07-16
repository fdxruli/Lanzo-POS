export const RESTAURANT_MODIFIER_UNITS = ['pza', 'kg', 'g', 'lt', 'ml'];

export const RESTAURANT_MODIFIER_SELECTION_TYPES = Object.freeze({
  SINGLE: 'single',
  MULTIPLE: 'multiple'
});

const MAX_MODIFIER_SELECTIONS = 50;
const text = (value) => String(value ?? '').trim();

const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNonNegativeNumber = (value, fallback = 0) => Math.max(0, toNumber(value, fallback));
const toNonNegativeInteger = (value, fallback = 0) => Math.max(0, Math.trunc(toNumber(value, fallback)));

const toPositiveNumberOrNull = (value) => {
  const parsed = toNumber(value, NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const slugify = (value) => text(value)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'option';

export const hasLegacyModifierQuantity = (option = {}) => (
  option?.quantity !== undefined
  && option?.quantity !== null
  && option?.ingredientQuantity === undefined
  && option?.ingredient_quantity === undefined
);

export const normalizeModifierOption = (option = {}, { optionIndex = 0 } = {}) => {
  const name = text(option.name);
  const price = toNonNegativeNumber(option.price, 0);
  const ingredientId = text(option.ingredientId ?? option.ingredient_id) || null;

  const hasExplicitIngredientQuantity = option.ingredientQuantity !== undefined
    || option.ingredient_quantity !== undefined;
  const explicitIngredientQuantity = option.ingredientQuantity ?? option.ingredient_quantity;
  const legacyQuantity = option.quantity;
  const legacyQuantityMapped = Boolean(
    ingredientId
    && !hasExplicitIngredientQuantity
    && legacyQuantity !== undefined
    && legacyQuantity !== null
    && legacyQuantity !== ''
  );

  const ingredientQuantity = toPositiveNumberOrNull(
    hasExplicitIngredientQuantity ? explicitIngredientQuantity : legacyQuantity
  );
  const ingredientUnit = ingredientId
    ? (text(option.ingredientUnit ?? option.ingredient_unit ?? option.unit ?? option.measurementUnit) || null)
    : null;
  const tracksInventory = Boolean(ingredientId && ingredientQuantity > 0);
  const isLegacyIncomplete = Boolean(ingredientId && !tracksInventory);

  return {
    ...option,
    id: text(option.id) || `modopt_${optionIndex}_${slugify(name)}`,
    name,
    price,
    ingredientId,
    ingredientQuantity,
    ingredientUnit,
    tracksInventory,
    ...(legacyQuantityMapped ? { legacyQuantityMapped: true } : {}),
    ...(isLegacyIncomplete ? { isLegacyIncomplete: true } : {})
  };
};

const resolveModifierSelectionType = (group = {}) => {
  const explicitType = text(group.selectionType ?? group.selection_type).toLowerCase();
  if (explicitType === RESTAURANT_MODIFIER_SELECTION_TYPES.MULTIPLE) {
    return RESTAURANT_MODIFIER_SELECTION_TYPES.MULTIPLE;
  }
  if (explicitType === RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE) {
    return RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE;
  }
  if (group.multiple === true) return RESTAURANT_MODIFIER_SELECTION_TYPES.MULTIPLE;
  if (group.multiple === false) return RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE;

  // Compatibilidad: históricamente el POS trataba los grupos obligatorios como
  // selección única y los opcionales como extras de selección múltiple.
  return group.required === true
    ? RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE
    : RESTAURANT_MODIFIER_SELECTION_TYPES.MULTIPLE;
};

export const normalizeModifierGroup = (group = {}, { groupIndex = 0 } = {}) => {
  const options = Array.isArray(group.options)
    ? group.options.map((option, optionIndex) => normalizeModifierOption(option, { optionIndex }))
    : [];
  const selectionType = resolveModifierSelectionType(group);
  const requestedMin = toNonNegativeInteger(
    group.minSelect ?? group.min_select ?? group.minSelections,
    group.required === true ? 1 : 0
  );
  const required = group.required === true || requestedMin > 0;
  const minSelect = required ? Math.max(1, requestedMin) : 0;
  const fallbackMax = selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE
    ? 1
    : Math.max(minSelect, options.length, 1);
  const requestedMax = toNonNegativeInteger(
    group.maxSelect ?? group.max_select ?? group.maxSelections,
    fallbackMax
  );
  const maxSelect = selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE
    ? 1
    : Math.min(MAX_MODIFIER_SELECTIONS, Math.max(minSelect, requestedMax || fallbackMax));

  return {
    ...group,
    id: text(group.id) || `modgrp_${groupIndex}_${slugify(group.name)}`,
    name: text(group.name),
    selectionType,
    multiple: selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.MULTIPLE,
    required,
    minSelect,
    maxSelect,
    options
  };
};

export const normalizeModifierGroups = (groups = []) => (
  Array.isArray(groups)
    ? groups.map((group, groupIndex) => normalizeModifierGroup(group, { groupIndex }))
    : []
);

export const getModifierOptionKind = (option = {}) => {
  const normalized = option.tracksInventory !== undefined
    ? option
    : normalizeModifierOption(option);

  if (normalized.ingredientId && !normalized.tracksInventory) return 'incomplete';
  if (normalized.price > 0 && normalized.tracksInventory) return 'priced_inventory';
  if (normalized.price > 0) return 'priced_only';
  if (normalized.tracksInventory) return 'inventory_only';
  return 'text_only';
};

export const getModifierOptionLabel = (option = {}) => {
  const labels = {
    text_only: 'Solo texto',
    priced_only: 'Cobra extra',
    inventory_only: 'Descuenta inventario',
    priced_inventory: 'Cobra + descuenta',
    incomplete: 'Incompleto'
  };
  return labels[getModifierOptionKind(option)] || labels.text_only;
};

export const validateModifierOptionForSave = (option = {}) => {
  const normalized = normalizeModifierOption(option);

  if (!normalized.name) {
    return {
      valid: false,
      reason: 'missing_name',
      message: 'La opción no tiene nombre.'
    };
  }

  if (normalized.price < 0) {
    return {
      valid: false,
      reason: 'invalid_price',
      message: 'El precio extra no puede ser negativo.'
    };
  }

  if (normalized.ingredientId && !normalized.tracksInventory) {
    return {
      valid: false,
      reason: 'missing_ingredient_quantity',
      message: 'La opción tiene un ingrediente ligado, pero no tiene una cantidad válida.'
    };
  }

  return { valid: true, reason: null, message: null };
};

export const findInvalidModifierGroupForSave = (groups = []) => (
  normalizeModifierGroups(groups).find((group) => (group.options || []).length === 0) || null
);

export const findInvalidModifierOptionForSave = (groups = []) => {
  const normalizedGroups = normalizeModifierGroups(groups);

  for (const group of normalizedGroups) {
    for (const option of group.options || []) {
      const validation = validateModifierOptionForSave(option);
      if (!validation.valid) {
        return {
          group,
          option,
          ...validation
        };
      }
    }
  }

  return null;
};

export const isModifierGroupValidForSave = (group = {}) => {
  const normalized = normalizeModifierGroup(group);
  if ((normalized.options || []).length === 0) return false;
  return !(normalized.options || []).some((option) => !validateModifierOptionForSave(option).valid);
};
