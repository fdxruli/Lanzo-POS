import { Money } from '../utils/moneyMath';
import { isFinanciallyClosedSale } from './sales/financialStats';
import { STORES } from './db/dexie';

const zeroTotals = { ventasContado: '0', abonosFiado: '0' };

const hasAmountValue = (value) => value !== null && value !== undefined && value !== '';

const sessionEnd = (cashSession, endOverride) => (
  endOverride || cashSession.fecha_cierre || new Date().toISOString()
);

const loadSessionSales = async (database, cashSession, endOverride) => {
  const end = sessionEnd(cashSession, endOverride);
  const salesTable = database.table(STORES.SALES);

  const [taggedSales, legacySales] = await Promise.all([
    salesTable
      .where('cash_session_id')
      .equals(cashSession.id)
      .toArray(),
    salesTable
      .where('timestamp')
      .between(cashSession.fecha_apertura, end, true, true)
      .filter((sale) => !sale.cash_session_id)
      .toArray()
  ]);

  return [...taggedSales, ...legacySales];
};

const sumCloudCustomerPaymentMovements = (movements = []) => {
  let total = Money.init(0);

  for (const movement of movements) {
    const type = String(movement.tipo || movement.type || '').toLowerCase();
    const source = String(movement.origen || movement.source || '').toLowerCase();
    const isCustomerPayment = type === 'abono_cliente' || source === 'customer_payment';

    if (isCustomerPayment) {
      total = Money.add(total, movement.monto ?? movement.amount ?? 0);
    }
  }

  return Money.toExactString(total);
};

export const isCloudCashSession = (cashSession = {}, { isCloudCash = false } = {}) => Boolean(
  isCloudCash ||
  cashSession?.cloudCash ||
  hasAmountValue(cashSession?.total_teorico_cloud) ||
  hasAmountValue(cashSession?.ventas_efectivo) ||
  hasAmountValue(cashSession?.abonos_fiado)
);

export const buildCashSessionTotals = (cashSession = {}, salesTotals = zeroTotals, cashMovements = [], options = {}) => {
  const isCloud = isCloudCashSession(cashSession, options);
  const hasCloudSales = hasAmountValue(cashSession?.ventas_efectivo);
  const hasCloudCustomerPayments = hasAmountValue(cashSession?.abonos_fiado);

  // En cloud, Supabase es la fuente oficial de totales de caja.
  // Los movimientos se muestran para auditoria; los agregados cloud evitan doble conteo.
  return {
    ventasContado: isCloud && hasCloudSales
      ? String(cashSession.ventas_efectivo)
      : String(salesTotals?.ventasContado || '0'),
    abonosFiado: isCloud && hasCloudCustomerPayments
      ? String(cashSession.abonos_fiado)
      : (isCloud ? sumCloudCustomerPaymentMovements(cashMovements) : String(salesTotals?.abonosFiado || '0'))
  };
};

export const resolveCashSessionAmounts = (cashSession = {}, totals = zeroTotals, options = {}) => {
  const isCloud = isCloudCashSession(cashSession, options);
  const ventasContado = isCloud && hasAmountValue(cashSession?.ventas_efectivo)
    ? String(cashSession.ventas_efectivo)
    : String(totals?.ventasContado || '0');
  const abonosFiado = isCloud && hasAmountValue(cashSession?.abonos_fiado)
    ? String(cashSession.abonos_fiado)
    : String(totals?.abonosFiado || '0');
  const entradasEfectivo = String(cashSession?.entradas_efectivo || '0');
  const salidasEfectivo = String(cashSession?.salidas_efectivo || '0');
  const fondoInicial = String(cashSession?.monto_inicial || '0');

  if (isCloud && hasAmountValue(cashSession?.total_teorico_cloud)) {
    return {
      fondoInicial,
      ventasContado,
      abonosFiado,
      entradasEfectivo,
      salidasEfectivo,
      totalTeorico: String(cashSession.total_teorico_cloud),
      source: 'cloud_aggregate'
    };
  }

  const ingresos = Money.add(
    Money.add(Money.init(fondoInicial), Money.init(ventasContado)),
    Money.add(Money.init(abonosFiado), Money.init(entradasEfectivo))
  );

  return {
    fondoInicial,
    ventasContado,
    abonosFiado,
    entradasEfectivo,
    salidasEfectivo,
    totalTeorico: Money.toExactString(Money.subtract(ingresos, Money.init(salidasEfectivo))),
    source: isCloud ? 'cloud_fallback' : 'local_projection'
  };
};

export const calculateSessionTotals = (sales) => {
  let contado = Money.init(0);
  let abonosFiado = Money.init(0);

  for (const sale of sales) {
    if (!isFinanciallyClosedSale(sale)) continue;

    const method = sale.paymentMethod?.toLowerCase();
    const paymentAmount = sale.paymentData?.amount;
    const isCash = method === 'efectivo' || method === 'cash' ||
      (!method && Number(paymentAmount) > 0);

    if (isCash) {
      contado = Money.add(contado, sale.total || paymentAmount || 0);
    } else if (method === 'fiado') {
      abonosFiado = Money.add(abonosFiado, sale.abono || 0);
    }
  }

  return {
    ventasContado: Money.toExactString(contado),
    abonosFiado: Money.toExactString(abonosFiado)
  };
};

export async function loadCashSessionTotals(database, cashSession, endOverride) {
  const sales = await loadSessionSales(database, cashSession, endOverride);
  return buildCashSessionTotals(cashSession, calculateSessionTotals(sales));
}

const normalizeSaleMovements = (sales) => {
  const movements = [];

  for (const sale of sales) {
    if (!isFinanciallyClosedSale(sale)) continue;

    const method = sale.paymentMethod?.toLowerCase();
    const paymentAmount = sale.paymentData?.amount;
    const isCash = method === 'efectivo' || method === 'cash' ||
      (!method && Number(paymentAmount) > 0);
    const isCredit = method === 'fiado';
    const saleLabel = sale.folio || sale.ticketNumber || sale.id;
    const shortLabel = String(saleLabel).substring(0, 12);

    if (isCash) {
      movements.push({
        id: sale.id || `venta-${sale.timestamp}`,
        tipo: 'venta',
        monto: String(sale.total || paymentAmount || 0),
        concepto: `Venta #${shortLabel}`,
        fecha: sale.timestamp
      });
    } else if (isCredit && Number(sale.abono) > 0) {
      movements.push({
        id: sale.id || `abono-${sale.timestamp}`,
        tipo: 'abono',
        monto: String(sale.abono),
        concepto: `Abono Fiado #${shortLabel}`,
        fecha: sale.timestamp
      });
    } else if (!isCredit) {
      movements.push({
        id: sale.id || `venta-${sale.timestamp}`,
        tipo: 'venta_tarjeta',
        monto: String(sale.total || paymentAmount || 0),
        concepto: `Venta (${sale.paymentMethod || 'Otro'}) #${shortLabel}`,
        fecha: sale.timestamp
      });
    }
  }

  return movements;
};

export async function loadCashSessionProjection(database, cashSession, endOverride) {
  if (!cashSession) {
    return {
      sales: [],
      movements: [],
      totals: zeroTotals
    };
  }

  const end = sessionEnd(cashSession, endOverride);
  const [cashMovements, sales, deletedSales, wasteLogs] = await Promise.all([
    database.table(STORES.MOVIMIENTOS_CAJA)
      .where('cash_session_id')
      .equals(cashSession.id)
      .toArray(),
    loadSessionSales(database, cashSession, end),
    database.table(STORES.DELETED_SALES)
      .where('deletedAt')
      .between(cashSession.fecha_apertura, end, true, true)
      .toArray(),
    database.table(STORES.WASTE)
      .where('timestamp')
      .between(cashSession.fecha_apertura, end, true, true)
      .toArray()
  ]);

  const salesTotals = calculateSessionTotals(sales);
  const totals = buildCashSessionTotals(cashSession, salesTotals, cashMovements);

  const movements = [
    ...cashMovements,
    ...normalizeSaleMovements(sales),
    ...deletedSales.map((sale) => ({
      id: `del-sale-${sale.id}`,
      tipo: 'venta_eliminada',
      monto: String(sale.total || sale.paymentData?.amount || 0),
      concepto: `Venta Eliminada #${String(sale.folio || sale.ticketNumber || sale.id).substring(0, 12)}`,
      fecha: sale.deletedAt
    })),
    ...wasteLogs.map((waste) => ({
      id: waste.id,
      tipo: 'merma',
      monto: String(waste.lossAmount || 0),
      concepto: `Merma/Eliminado: ${waste.productName} (${waste.quantity}${waste.unit})`,
      fecha: waste.timestamp
    }))
  ].sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));

  return {
    sales,
    movements,
    totals
  };
}
