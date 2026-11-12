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

// Etiquetas POS basadas en un único snapshot operativo; committedStock puede
// agrupar apartados, mesas y otras reservas. No se infiere el origen.
export const getPosStockState = (record, {
  tracked = record?.trackStock === true || (record?.trackStock !== false && record?.batchManagement?.enabled === true)
} = {}) => {
  if (!tracked) return { kind: 'untracked', blocked: false, snapshot: null };
  const snapshot = getOperationalStockSnapshot(record);
  if (!snapshot.valid || snapshot.physicalStock < 0
    || snapshot.committedStock > snapshot.physicalStock + 0.00001
    || snapshot.availableStock < 0) {
    return { kind: 'unknown', blocked: true, snapshot: null };
  }
  if (snapshot.availableStock > 0) {
    return { kind: 'available', blocked: false, snapshot };
  }
  return {
    kind: snapshot.physicalStock > 0 && snapshot.committedStock > 0 ? 'committed' : 'empty',
    blocked: true,
    snapshot
  };
};

export const getPosStockBlockMessage = (state, productName = 'Producto') => {
  const scopedName = state?.batchLabel ? `${productName} — lote ${state.batchLabel}` : productName;
  if (state?.kind === 'committed') {
    const { physicalStock, committedStock } = state.snapshot;
    return `${scopedName}: producto sin disponibilidad — unidades comprometidas.
Existencia física: ${physicalStock}. Comprometidas: ${committedStock}. Disponibles: 0.
Estas unidades pertenecen a reservas vigentes u otras operaciones y no pueden utilizarse en esta venta. Revisa la operación correspondiente para liberarlas.`;
  }
  if (state?.kind === 'empty') return `${scopedName}: agotado físicamente. No quedan unidades disponibles.`;
  return `${scopedName}: inventario no verificable. Actualiza el catálogo y comprueba las existencias antes de vender.`;
};
