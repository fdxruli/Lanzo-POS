import { Money } from '../utils/moneyMath';
import { isFinanciallyClosedSale } from './sales/financialStats';
import { STORES } from './db/dexie';
import { buildCashReconciliation } from './layawayFinancialProjection';
import {
  getSaleDisplayReference,
  getSaleIdentityReferences,
  getSaleSecondaryReference,
  normalizeSaleTraceability
} from './sales/saleReference';

const zeroTotals = { ventasContado: '0', abonosFiado: '0' };

const hasAmountValue = (value) => value !== null && value !== undefined && value !== '';

const sessionEnd = (cashSession, endOverride) => (
  endOverride || cashSession.fecha_cierre || new Date().toISOString()
);

const loadOptionalTable = async (database, tableName) => {
  try {
    return await database.table(tableName).toArray();
  } catch {
    return [];
  }
};

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
  hasAmountValue(cashSession?.total_teorico_cloud)
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

  // Local: la conciliacion usa IDs de pagos de apartado y no vuelve a sumar
  // efectivo al momento de entregar la mercancia.
  if (!isCloud && totals?.reconciliation) {
    return {
      fondoInicial,
      ventasContado,
      abonosFiado,
      entradasEfectivo,
      salidasEfectivo,
      totalTeorico: String(totals.reconciliation.theoreticalCash),
      source: 'local_reconciliation',
      reconciliation: totals.reconciliation
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

const normalizeIdentity = (value) => String(value ?? '').trim().toLowerCase();

const saleEffectType = (movement = {}) => {
  const type = String(movement.tipo || movement.type || '').toLowerCase();
  if (['venta', 'venta_efectivo', 'venta_tarjeta'].includes(type)) return 'sale';
  if (['abono', 'abono_cliente'].includes(type)) return 'customer_payment';
  if (['cancelacion', 'reversa'].includes(type)) return type;
  return type || null;
};

const movementSaleReferences = (movement = {}) => {
  const referenceType = normalizeIdentity(
    movement.referenceType || movement.reference_type
  );
  const referenceIdAllowed = !referenceType || referenceType === 'sale';

  return [
    movement.saleId,
    movement.sale_id,
    ...(referenceIdAllowed
      ? [movement.referenceId, movement.reference_id]
      : []),
    movement.metadata?.sale_id,
    movement.metadata?.saleId
  ].map(normalizeIdentity).filter(Boolean);
};

export const buildSaleIdentityIndex = (sales = []) => {
  const index = new Map();
  for (const sale of sales) {
    for (const identity of getSaleIdentityReferences(sale)) {
      index.set(normalizeIdentity(identity), sale);
    }
  }
  return index;
};

const resolveMovementSale = (movement, saleIndex) => {
  for (const identity of movementSaleReferences(movement)) {
    const sale = saleIndex.get(identity);
    if (sale) return sale;
  }
  return null;
};

const saleEffectKey = (sale, movement) => {
  const identity = normalizeIdentity(getSaleIdentityReferences(sale)[0]);
  const effect = saleEffectType(movement);
  const amount = Money.toExactString(Money.init(movement.monto ?? movement.amount ?? 0));
  return identity && effect ? `${identity}::${effect}::${amount}` : null;
};

export const enrichOfficialCashMovements = (cashMovements = [], sales = []) => {
  const saleIndex = buildSaleIdentityIndex(sales);

  return cashMovements.map((movement) => {
    const sale = resolveMovementSale(movement, saleIndex);
    if (!sale) return movement;

    const traceability = normalizeSaleTraceability(sale);
    return {
      ...movement,
      sale,
      saleId: movement.saleId || movement.sale_id || sale.id || null,
      sale_id: movement.sale_id || movement.saleId || sale.id || null,
      ...traceability,
      primaryReference: getSaleDisplayReference(sale),
      secondaryReference: getSaleSecondaryReference(sale)
    };
  });
};

export const normalizeSaleMovements = (sales) => {
  const movements = [];

  for (const sale of sales) {
    if (!isFinanciallyClosedSale(sale)) continue;

    const method = sale.paymentMethod?.toLowerCase();
    const paymentAmount = sale.paymentData?.amount;
    const isCash = method === 'efectivo' || method === 'cash' ||
      (!method && Number(paymentAmount) > 0);
    const isCredit = method === 'fiado';
    const saleLabel = getSaleDisplayReference(sale) || sale.ticketNumber || sale.id;
    const traceability = normalizeSaleTraceability(sale);
    const secondaryReference = getSaleSecondaryReference(sale);

    if (isCash) {
      movements.push({
        id: sale.id || `venta-${sale.timestamp}`,
        sale,
        saleId: sale.id || null,
        sale_id: sale.id || null,
        referenceType: 'sale',
        referenceId: sale.id || null,
        tipo: 'venta',
        monto: String(sale.total || paymentAmount || 0),
        concepto: saleLabel,
        secondaryReference,
        ...traceability,
        fecha: sale.timestamp
      });
    } else if (isCredit && Number(sale.abono) > 0) {
      movements.push({
        id: sale.id || `abono-${sale.timestamp}`,
        sale,
        saleId: sale.id || null,
        sale_id: sale.id || null,
        referenceType: 'sale',
        referenceId: sale.id || null,
        tipo: 'abono',
        monto: String(sale.abono),
        concepto: saleLabel,
        secondaryReference: `Abono fiado · ${secondaryReference}`,
        ...traceability,
        fecha: sale.timestamp
      });
    } else if (!isCredit) {
      movements.push({
        id: sale.id || `venta-${sale.timestamp}`,
        sale,
        saleId: sale.id || null,
        sale_id: sale.id || null,
        referenceType: 'sale',
        referenceId: sale.id || null,
        tipo: 'venta_tarjeta',
        monto: String(sale.total || paymentAmount || 0),
        concepto: saleLabel,
        secondaryReference: `${secondaryReference} · ${sale.paymentMethod || 'Otro'}`,
        ...traceability,
        fecha: sale.timestamp
      });
    }
  }

  return movements;
};

export const deduplicateSyntheticSaleMovements = (
  officialMovements = [],
  syntheticMovements = []
) => {
  const officialKeys = new Set(
    officialMovements
      .map((movement) => movement.sale ? saleEffectKey(movement.sale, movement) : null)
      .filter(Boolean)
  );

  return syntheticMovements.filter((movement) => {
    const key = movement.sale ? saleEffectKey(movement.sale, movement) : null;
    return !key || !officialKeys.has(key);
  });
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
  const [cashMovements, sales, deletedSales, wasteLogs, layaways] = await Promise.all([
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
      .toArray(),
    loadOptionalTable(database, STORES.LAYAWAYS)
  ]);

  const salesTotals = calculateSessionTotals(sales);
  const reconciliation = buildCashReconciliation({
    cashSession: { ...cashSession, fecha_cierre: end },
    sales,
    layaways,
    cashMovements
  });
  const totals = buildCashSessionTotals(cashSession, salesTotals, cashMovements);
  // Compatibilidad: los consumidores antiguos comparan exactamente este objeto.
  // La proyeccion completa viaja como campo propio del resultado.
  Object.defineProperty(totals, 'reconciliation', { value: reconciliation, enumerable: false });

  const officialCashMovements = enrichOfficialCashMovements(cashMovements, sales);
  const syntheticSaleMovements = deduplicateSyntheticSaleMovements(
    officialCashMovements,
    normalizeSaleMovements(sales)
  );

  const movements = [
    ...officialCashMovements,
    ...syntheticSaleMovements,
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
    totals,
    reconciliation
  };
}
