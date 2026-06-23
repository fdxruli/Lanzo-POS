import { db, STORES } from './dexie';
import { handleDexieError } from './utils';

const toIsoOrNull = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const normalizeDateRange = (rangoFechas = null) => {
  if (!rangoFechas) return { startIso: null, endIso: null };

  return {
    startIso: toIsoOrNull(rangoFechas.start || rangoFechas.from || rangoFechas.inicio),
    endIso: toIsoOrNull(rangoFechas.end || rangoFechas.to || rangoFechas.fin)
  };
};

const normalizeRubros = (rubros = []) => {
  const list = Array.isArray(rubros) ? rubros : [rubros];
  const normalized = [];

  for (const rubro of list) {
    const value = String(rubro || '').trim().toLowerCase();
    if (value) normalized.push(value);
  }

  return normalized;
};

const collectComparableRubros = (record = {}) => {
  const values = [
    record.rubro,
    record.rubros,
    record.businessType,
    record.businessTypes,
    record.business_type,
    record.activeRubro
  ];

  if (Array.isArray(record.items)) {
    record.items.forEach((item) => {
      values.push(item.rubro, item.rubros, item.businessType, item.business_type);
    });
  }

  const comparable = [];

  for (const value of values.flat()) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) comparable.push(normalized);
  }

  return comparable;
};

const matchesRubros = (record, rubros) => {
  if (!rubros.length) return true;

  const comparable = collectComparableRubros(record);
  if (!comparable.length) return true;

  return comparable.some((value) => rubros.includes(value));
};

const isOpenSale = (sale = {}) => {
  const status = String(sale.status || '').toLowerCase();
  const fulfillmentStatus = String(sale.fulfillmentStatus || '').toLowerCase();
  return status === 'open' || fulfillmentStatus === 'open';
};

const isCancelledSale = (sale = {}) => {
  const status = String(sale.status || '').toLowerCase();
  const fulfillmentStatus = String(sale.fulfillmentStatus || '').toLowerCase();
  return status === 'cancelled' || fulfillmentStatus === 'cancelled';
};

const queryByTimestampRange = async (storeName, { startIso, endIso }, timestampIndex = 'timestamp') => {
  const table = db.table(storeName);

  if (startIso && endIso) {
    return table.where(timestampIndex).between(startIso, endIso, true, true).toArray();
  }

  if (startIso) {
    return table.where(timestampIndex).aboveOrEqual(startIso).toArray();
  }

  if (endIso) {
    return table.where(timestampIndex).belowOrEqual(endIso).toArray();
  }

  return table.toArray();
};

const sortNewestFirst = (rows = [], field = 'timestamp') => (
  [...rows].sort((a, b) => Date.parse(b?.[field] || 0) - Date.parse(a?.[field] || 0))
);

export const reportingService = {
  async getDashboardReport({
    rangoFechas = null,
    rubros = [],
    incluirCanceladas = false,
    incluirMermas = true,
    incluirProductos = true,
    incluirClientes = false
  } = {}) {
    try {
      if (!db.isOpen()) await db.open();

      const range = normalizeDateRange(rangoFechas);
      const normalizedRubros = normalizeRubros(rubros);

      const [rawSales, rawWasteLogs, menu, customers] = await Promise.all([
        queryByTimestampRange(STORES.SALES, range),
        incluirMermas ? queryByTimestampRange(STORES.WASTE, range) : Promise.resolve([]),
        incluirProductos ? db.table(STORES.MENU).toArray() : Promise.resolve([]),
        incluirClientes ? db.table(STORES.CUSTOMERS).toArray() : Promise.resolve([])
      ]);

      const sales = rawSales.filter((sale) => (
        !isOpenSale(sale)
        && (incluirCanceladas || !isCancelledSale(sale))
        && matchesRubros(sale, normalizedRubros)
      ));

      const wasteLogs = rawWasteLogs
        .filter((log) => matchesRubros(log, normalizedRubros));

      return {
        sales: sortNewestFirst(sales),
        wasteLogs: sortNewestFirst(wasteLogs),
        menu,
        customers,
        meta: {
          rangoFechas: {
            start: range.startIso,
            end: range.endIso
          },
          incluirCanceladas,
          incluirMermas,
          rubros: normalizedRubros,
          counts: {
            sales: sales.length,
            wasteLogs: wasteLogs.length,
            menu: menu.length,
            customers: customers.length
          }
        }
      };
    } catch (error) {
      throw handleDexieError(error, 'Get Dashboard Report');
    }
  }
};

export default reportingService;
