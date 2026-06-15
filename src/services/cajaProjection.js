import { Money } from '../utils/moneyMath';
import { isFinanciallyClosedSale } from './sales/financialStats';
import { STORES } from './db/dexie';

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
  return calculateSessionTotals(sales);
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
      totals: { ventasContado: '0', abonosFiado: '0' }
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
    totals: calculateSessionTotals(sales)
  };
}
