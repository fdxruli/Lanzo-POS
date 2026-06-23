export const CANONICAL_BUSINESS_TYPES = {
  FOOD_SERVICE: 'food_service',
  FARMACIA: 'farmacia',
  VERDULERIA_FRUTERIA: 'verduleria/fruteria',
  ABARROTES: 'abarrotes',
  APPAREL: 'apparel',
  HARDWARE: 'hardware',
  OTRO: 'otro'
};

const BUSINESS_TYPE_ALIASES = {
  [CANONICAL_BUSINESS_TYPES.FOOD_SERVICE]: [
    'food_service',
    'food service',
    'food-service',
    'restaurante',
    'restaurant',
    'dark-kitchen',
    'dark kitchen',
    'dark_kitchen',
    'cocina',
    'food',
    'comida',
    'alimentos',
    'cafeteria',
    'cafeteria',
    'bar'
  ],
  [CANONICAL_BUSINESS_TYPES.FARMACIA]: [
    'farmacia',
    'pharmacy',
    'drogueria',
    'drogueria',
    'botica',
    'salud'
  ],
  [CANONICAL_BUSINESS_TYPES.VERDULERIA_FRUTERIA]: [
    'verduleria/fruteria',
    'fruteria/verduleria',
    'verduleria',
    'fruteria',
    'frutas',
    'verduras',
    'frutas y verduras',
    'frutas_verduras',
    'frutas-verduras'
  ],
  [CANONICAL_BUSINESS_TYPES.ABARROTES]: [
    'abarrotes',
    'tienda',
    'minimarket',
    'mini market',
    'miscelanea',
    'grocery',
    'super',
    'supermercado',
    'retail'
  ],
  [CANONICAL_BUSINESS_TYPES.APPAREL]: [
    'apparel',
    'ropa',
    'boutique',
    'calzado',
    'moda',
    'textil'
  ],
  [CANONICAL_BUSINESS_TYPES.HARDWARE]: [
    'hardware',
    'ferreteria',
    'ferretera',
    'tlapaleria',
    'herramientas'
  ],
  [CANONICAL_BUSINESS_TYPES.OTRO]: [
    'otro',
    'otros',
    'general'
  ]
};

const normalizeAliasKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' y ')
  .replace(/\s+/g, ' ')
  .replace(/\s*\/\s*/g, '/');

const ALIAS_TO_CANONICAL = Object.entries(BUSINESS_TYPE_ALIASES).reduce((acc, [canonical, aliases]) => {
  aliases.forEach((alias) => {
    acc.set(normalizeAliasKey(alias), canonical);
  });
  return acc;
}, new Map());

const splitBusinessTypeInput = (rawBusinessType) => {
  if (Array.isArray(rawBusinessType)) return rawBusinessType;

  if (typeof rawBusinessType === 'string') {
    return rawBusinessType
      .replace(/[{}"]/g, '')
      .split(',')
      .map((item) => item.trim());
  }

  return [rawBusinessType];
};

export const normalizeBusinessType = (rawBusinessType, fallback = CANONICAL_BUSINESS_TYPES.OTRO) => {
  const firstValue = splitBusinessTypeInput(rawBusinessType).find(Boolean);
  if (!firstValue) return fallback;

  const normalized = normalizeAliasKey(firstValue);
  return ALIAS_TO_CANONICAL.get(normalized) || fallback;
};

export const normalizeBusinessTypes = (
  rawBusinessTypes,
  fallback = CANONICAL_BUSINESS_TYPES.OTRO
) => {
  const normalizedTypes = splitBusinessTypeInput(rawBusinessTypes)
    .map((type) => normalizeBusinessType(type, null))
    .filter(Boolean);

  const uniqueTypes = Array.from(new Set(normalizedTypes));
  return uniqueTypes.length > 0 ? uniqueTypes : [fallback];
};

export const isFoodBusinessType = (businessType) => {
  const normalized = normalizeBusinessType(businessType);
  return normalized === CANONICAL_BUSINESS_TYPES.FOOD_SERVICE
    || normalized === CANONICAL_BUSINESS_TYPES.VERDULERIA_FRUTERIA;
};

