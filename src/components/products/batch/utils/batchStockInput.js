const DECIMAL_STOCK_UNITS = new Set([
  'kg',
  'kilo',
  'kilos',
  'kilogramo',
  'kilogramos',
  'g',
  'gr',
  'gramo',
  'gramos',
  'lt',
  'l',
  'litro',
  'litros',
  'ml',
  'mililitro',
  'mililitros',
  'lb',
  'lbs',
  'libra',
  'libras'
]);

const normalizeUnit = (unit) => String(unit || '').trim().toLowerCase();

export function getBatchStockInputProps(product = {}, rubroGroup = 'retail', features = {}) {
  const unit = normalizeUnit(
    product?.bulkData?.purchase?.unit ||
    product?.unit ||
    product?.purchaseUnit ||
    product?.stockUnit
  );

  const usesMeasuredStock =
    product?.saleType === 'bulk' ||
    DECIMAL_STOCK_UNITS.has(unit) ||
    (rubroGroup === 'fruteria' && unit !== 'pza') ||
    (rubroGroup === 'restaurant' && product?.productType === 'ingredient');

  if (features?.hasVariants && !usesMeasuredStock) {
    return {
      step: '1',
      inputMode: 'numeric',
      unit
    };
  }

  return {
    step: usesMeasuredStock ? '0.001' : '1',
    inputMode: usesMeasuredStock ? 'decimal' : 'numeric',
    unit
  };
}
