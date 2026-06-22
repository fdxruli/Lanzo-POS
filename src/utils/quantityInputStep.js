const UNIT_STEP_BY_UNIT = {
  kg: '0.001',
  kilo: '0.001',
  kilos: '0.001',
  kilogramo: '0.001',
  kilogramos: '0.001',
  lt: '0.001',
  l: '0.001',
  litro: '0.001',
  litros: '0.001',
  gr: '1',
  g: '1',
  gramo: '1',
  gramos: '1',
  ml: '1',
  mililitro: '1',
  mililitros: '1',
  pza: '1',
  pieza: '1',
  piezas: '1',
  unidad: '1',
  unidades: '1'
};

export const normalizeQuantityUnit = (unit) => String(unit || '').trim().toLowerCase();

export const getQuantityStepByUnit = (unit) => (
  UNIT_STEP_BY_UNIT[normalizeQuantityUnit(unit)] || '1'
);

export const getOrderItemUnit = (item = {}) => (
  item?.bulkData?.purchase?.unit ||
  item?.unit ||
  item?.purchaseUnit ||
  item?.stockUnit ||
  (item?.saleType === 'bulk' ? 'kg' : 'pza')
);

export const getOrderQuantityInputProps = (item = {}) => {
  const unit = getOrderItemUnit(item);

  return {
    step: getQuantityStepByUnit(unit),
    inputMode: getQuantityStepByUnit(unit) === '1' ? 'numeric' : 'decimal',
    unit
  };
};
