export const INGREDIENT_UNITS = [
  { value: 'pza', label: 'Pieza / unidad' },
  { value: 'kg', label: 'Kilogramo (kg)' },
  { value: 'g', label: 'Gramo (g)' },
  { value: 'lt', label: 'Litro (L)' },
  { value: 'ml', label: 'Mililitro (ml)' }
];

const LEGACY_INGREDIENT_UNITS = {
  pza: 'pza', pieza: 'pza', piezas: 'pza', unidad: 'pza', unidades: 'pza',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg',
  g: 'g', gr: 'g', gramo: 'g', gramos: 'g',
  l: 'lt', lt: 'lt', litro: 'lt', litros: 'lt',
  ml: 'ml', mililitro: 'ml', mililitros: 'ml'
};

const normalizeUnitKey = (value) => String(value ?? '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

export const normalizeIngredientUnit = (value) => {
  const key = normalizeUnitKey(value);
  if (!key) return 'pza';
  return LEGACY_INGREDIENT_UNITS[key] || String(value).trim();
};

export const getSaleTypeForIngredientUnit = (unit) => (
  normalizeIngredientUnit(unit) === 'pza' ? 'unit' : 'bulk'
);

export const getRecipeIngredientId = (item) => (
  item?.ingredientId || item?.productId || null
);

export const getIngredientDefaultUnit = (ingredient) => {
  const unit = [
    ingredient?.unit,
    ingredient?.bulkData?.purchase?.unit,
    ingredient?.bulkData?.unit,
    ingredient?.measurementUnit,
    ingredient?.saleUnit
  ].find((value) => String(value ?? '').trim());

  return normalizeIngredientUnit(unit || (ingredient?.saleType === 'unit' ? 'pza' : 'kg'));
};
