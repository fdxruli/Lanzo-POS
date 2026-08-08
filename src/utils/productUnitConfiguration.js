export const PRODUCT_SALE_UNITS = Object.freeze([
  { value: 'pza', label: 'Pieza / unidad' },
  { value: 'kg', label: 'Kilogramo (kg)' },
  { value: 'g', label: 'Gramo (g)' },
  { value: 'lt', label: 'Litro (L)' },
  { value: 'ml', label: 'Mililitro (ml)' },
  { value: 'mt', label: 'Metro (m)' },
  { value: 'cm', label: 'Centímetro (cm)' },
  { value: 'ft', label: 'Pie (ft)' },
  { value: 'in', label: 'Pulgada (in)' },
  { value: 'gal', label: 'Galón (gal)' }
]);

export const BULK_SALE_UNITS = Object.freeze(
  PRODUCT_SALE_UNITS.filter(({ value }) => value !== 'pza')
);

export const PURCHASE_UNITS = Object.freeze([
  { value: 'caja', label: 'Caja' },
  { value: 'paquete', label: 'Paquete' },
  { value: 'bulto', label: 'Bulto' },
  { value: 'costal', label: 'Costal' },
  { value: 'charola', label: 'Charola' },
  { value: 'display', label: 'Display' },
  { value: 'docena', label: 'Docena' },
  { value: 'pza', label: 'Pieza' },
  { value: 'kg', label: 'Kilogramo' },
  { value: 'lt', label: 'Litro' }
]);

const unitKey = (value) => String(value ?? '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const LEGACY_PRODUCT_UNITS = Object.freeze({
  pza: 'pza', pieza: 'pza', piezas: 'pza', unidad: 'pza', unidades: 'pza', pzas: 'pza',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg',
  g: 'g', gr: 'g', gramo: 'g', gramos: 'g',
  l: 'lt', lt: 'lt', litro: 'lt', litros: 'lt',
  ml: 'ml', mililitro: 'ml', mililitros: 'ml',
  m: 'mt', mt: 'mt', metro: 'mt', metros: 'mt',
  cm: 'cm', centimetro: 'cm', centimetros: 'cm',
  ft: 'ft', pie: 'ft', pies: 'ft',
  in: 'in', pulgada: 'in', pulgadas: 'in',
  gal: 'gal', galon: 'gal', galones: 'gal'
});

const LEGACY_PURCHASE_UNITS = Object.freeze(
  PURCHASE_UNITS.reduce((result, { value }) => ({ ...result, [value]: value }), {})
);

export const normalizeProductUnit = (value) => {
  const original = String(value ?? '').trim();
  if (!original) return '';
  return LEGACY_PRODUCT_UNITS[unitKey(original)] || original;
};

export const normalizePurchaseUnit = (value) => {
  const original = String(value ?? '').trim();
  if (!original) return '';
  return LEGACY_PURCHASE_UNITS[unitKey(original)] || original;
};

export const isCanonicalProductUnit = (value) => (
  PRODUCT_SALE_UNITS.some((unit) => unit.value === value)
);

export const isCanonicalPurchaseUnit = (value) => (
  PURCHASE_UNITS.some((unit) => unit.value === value)
);

const SALE_UNIT_TEXT = Object.freeze({
  pza: { name: 'pieza', short: 'pza' },
  kg: { name: 'kilogramo', short: 'kg' },
  g: { name: 'gramo', short: 'g' },
  lt: { name: 'litro', short: 'L' },
  ml: { name: 'mililitro', short: 'ml' },
  mt: { name: 'metro', short: 'm' },
  cm: { name: 'centímetro', short: 'cm' },
  ft: { name: 'pie', short: 'ft' },
  in: { name: 'pulgada', short: 'in' },
  gal: { name: 'galón', short: 'gal' }
});

export const getProductUnitName = (unit) => (
  SALE_UNIT_TEXT[normalizeProductUnit(unit)]?.name || String(unit || 'unidad').trim().toLowerCase()
);

export const getProductUnitShortLabel = (unit) => (
  SALE_UNIT_TEXT[normalizeProductUnit(unit)]?.short || String(unit || 'pza').trim()
);

export const resolveProductSaleUnit = (product = {}) => {
  const sourceUnit = [
    product.unit,
    product.bulkData?.sale?.unit,
    product.bulk_data?.sale?.unit,
    product.bulkData?.unit,
    product.bulk_data?.unit,
    product.bulkData?.purchase?.unit,
    product.bulk_data?.purchase?.unit,
    product.measurementUnit,
    product.saleUnit
  ].find((value) => String(value ?? '').trim());

  return normalizeProductUnit(sourceUnit || (product.saleType === 'bulk' || product.sale_type === 'bulk' ? 'kg' : 'pza'));
};

export const resolveProductSaleUnitLabel = (product = {}) => (
  getProductUnitShortLabel(resolveProductSaleUnit(product))
);
