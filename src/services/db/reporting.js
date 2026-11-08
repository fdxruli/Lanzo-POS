import { db, STORES } from './dexie';
import { handleDexieError } from './utils';
import { buildLayawayFinancialProjection } from '../layawayFinancialProjection';

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

const isFinanciallyClosedSale = (sale = {}) => (
  ['closed', 'completed'].includes(String(sale.status || '').toLowerCase())
);

const isCancelledSale = (sale = {}) => {
  const status = String(sale.status || '').toLowerCase();
  const fulfillmentStatus = String(sale.fulfillmentStatus || '').toLowerCase();
  return status === 'cancelled' || fulfillmentStatus === 'cancelled';
};

const ledgerSaleReference = (row = {}) => (
  row.saleId || row.sale_id || row.reference || row.referenceId || row.reference_id || null
);

const isDashboardPaymentEvent = (row = {}) => (
  ['PAYMENT', 'CANCEL_PAYMENT', 'PAYMENT_REVERSAL', 'REFUND', 'CANCEL_CHARGE'].includes(
    String(row.type || '').trim().toUpperCase()
  )
);

const getEventTimestamp = (row = {}) => (
  row.timestamp || row.createdAt || row.created_at || row.fecha || null
);

const isTimestampInRange = (value, range = {}) => {
  if (!range.startIso && !range.endIso) return true;
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return false;
  return (!range.startIso || timestamp >= Date.parse(range.startIso))
    && (!range.endIso || timestamp <= Date.parse(range.endIso));
};

const isCashReversalMovement = (movement = {}) => [
  'cancelacion', 'cancelacion_venta', 'cancelacion_abono_inicial',
  'sale_refund', 'cash_refund', 'refund'
].includes(String(movement.type || movement.tipo || '').trim().toLowerCase())
  || ['sale_cancellation_refund', 'sale_refund'].includes(
    String(movement.source || movement.origen || movement.metadata?.source || '').trim().toLowerCase()
  );

const hasUnresolvedCreditCancellation = (cancelledSales = [], customerLedger = []) => {
  const ledgerRows = Array.isArray(customerLedger) ? customerLedger : [];

  return (cancelledSales || []).some((sale) => {
    const hasCharge = ledgerRows.some((row) => (
      String(row.type || '').trim().toUpperCase() === 'CHARGE'
      && String(ledgerSaleReference(row) || '') === String(sale?.id || '')
    ));
    if (!hasCharge) return false;

    return !ledgerRows.some((row) => (
      String(row.type || '').trim().toUpperCase() === 'CANCEL_CHARGE'
      && String(ledgerSaleReference(row) || '') === String(sale?.id || '')
    ));
  });
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

      const [rawSales, rawWasteLogs, menu, customers, layaways, rawCashMovements, rawCustomerLedger, allCancelledSales] = await Promise.all([
        queryByTimestampRange(STORES.SALES, range),
        incluirMermas ? queryByTimestampRange(STORES.WASTE, range) : Promise.resolve([]),
        incluirProductos ? db.table(STORES.MENU).toArray() : Promise.resolve([]),
        incluirClientes ? db.table(STORES.CUSTOMERS).toArray() : Promise.resolve([]),
        db.table(STORES.LAYAWAYS).toArray().catch(() => []),
        db.table(STORES.MOVIMIENTOS_CAJA).toArray(),
        db.table(STORES.CUSTOMER_LEDGER).toArray(),
        db.table(STORES.SALES).filter(isCancelledSale).toArray()
      ]);

      const sales = rawSales.filter((sale) => (
        !isOpenSale(sale)
        && (isFinanciallyClosedSale(sale) || (incluirCanceladas && isCancelledSale(sale)))
        && (incluirCanceladas || !isCancelledSale(sale))
        && matchesRubros(sale, normalizedRubros)
      ));

      const wasteLogs = rawWasteLogs
        .filter((log) => matchesRubros(log, normalizedRubros));
      const cashMovements = rawCashMovements.filter((movement) => {
        const timestamp = movement.fecha || movement.createdAt;
        if (range.startIso && (!timestamp || Date.parse(timestamp) < Date.parse(range.startIso))) return false;
        if (range.endIso && (!timestamp || Date.parse(timestamp) > Date.parse(range.endIso))) return false;
        return true;
      });
      const customerLedger = rawCustomerLedger.filter((row) => {
        if (!isDashboardPaymentEvent(row)) return false;
        const timestamp = getEventTimestamp(row);
        return !timestamp || isTimestampInRange(timestamp, range);
      });
      const cashReversalMovements = rawCashMovements.filter((movement) => {
        if (!isCashReversalMovement(movement)) return false;
        const timestamp = getEventTimestamp(movement);
        return !timestamp || isTimestampInRange(timestamp, range);
      });
      const cancelledSales = allCancelledSales.filter((sale) => (
        !sale.cancelledAt && !sale.cancelled_at
        || isTimestampInRange(sale.timestamp, range)
        || isTimestampInRange(sale.cancelledAt || sale.cancelled_at, range)
      ));
      const layawayFinancial = buildLayawayFinancialProjection({
        layaways,
        sales,
        cashMovements,
        range: { start: range.startIso, end: range.endIso }
      });

      return {
        sales: sortNewestFirst(sales),
        wasteLogs: sortNewestFirst(wasteLogs),
        menu,
        customers,
        customerLedger,
        cancelledSales,
        cashReversalMovements,
        hasUnresolvedCreditCancellation: hasUnresolvedCreditCancellation(allCancelledSales, rawCustomerLedger),
        layawayFinancial,
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
