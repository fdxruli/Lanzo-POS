export const STOCK_DECIMALS = 4;

export const normalizeStock = (value) => {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Number(Math.round(num + 'e' + STOCK_DECIMALS) + 'e-' + STOCK_DECIMALS);
};

export const getCommittedStock = (record) => normalizeStock(record?.committedStock ?? record?.committed_stock ?? 0);

export const getAvailableStock = (record) => {
  const physicalStock = normalizeStock(record?.stock ?? record?.quantity ?? 0);
  const committedStock = getCommittedStock(record);
  return normalizeStock(Math.max(0, physicalStock - committedStock));
};

const isMissingValue = (value) => value === null || value === undefined || value === '';

export const getOperationalStockSnapshot = (record) => {
  const rawPhysicalStock = record?.stock ?? record?.quantity;
  const rawCommittedStock = record?.committedStock ?? record?.committed_stock;

  if (isMissingValue(rawPhysicalStock)) {
    return {
      valid: false,
      physicalStock: null,
      committedStock: null,
      availableStock: null
    };
  }

  const physicalStockNumber = Number(rawPhysicalStock);
  const committedStockNumber = isMissingValue(rawCommittedStock) ? 0 : Number(rawCommittedStock);

  if (
    !Number.isFinite(physicalStockNumber)
    || !Number.isFinite(committedStockNumber)
    || committedStockNumber < 0
  ) {
    return {
      valid: false,
      physicalStock: null,
      committedStock: null,
      availableStock: null
    };
  }

  const physicalStock = normalizeStock(physicalStockNumber);
  const committedStock = normalizeStock(committedStockNumber);

  return {
    valid: true,
    physicalStock,
    committedStock,
    availableStock: normalizeStock(physicalStock - committedStock)
  };
};
