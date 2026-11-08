import { formatCurrencyMXN } from '../../utils/formatCurrencyMXN';
import { normalizeFinancialNumber } from '../sales/financialPolicy';
import {
  getSaleEcommerceOrderCode,
  getSaleFinancialFolio,
  getSaleOperationalFolio,
  getSaleOriginLabel
} from '../sales/saleReference';

const PAYMENT_STATUS_LABELS = Object.freeze({
  paid: 'Pagada',
  credit: 'Fiada',
  mixed_credit: 'Pago mixto con crédito',
  partial: 'Parcialmente pagada',
  cancelled: 'Cancelada',
  unknown: 'Estado desconocido'
});

const PAID_PAYMENT_STATUSES = new Set(['paid', 'complete', 'completed', 'settled', 'fully_paid', 'fully-paid']);
const CREDIT_PAYMENT_STATUSES = new Set(['credit_pending', 'unpaid_credit', 'fiado', 'credit_due', 'credit']);
const PARTIAL_PAYMENT_STATUSES = new Set(['partial', 'partially_paid', 'partially-paid']);
const MIXED_CREDIT_METHODS = new Set(['mixed_credit', 'mixed-credit', 'partial_credit', 'partial-credit', 'credito_parcial', 'crédito_parcial']);

const firstValue = (record, keys) => {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return null;
};

const normalized = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');

const isCancelledSale = (sale = {}) => (
  ['cancelled', 'canceled'].includes(normalized(sale.status || sale.sale_status))
  || ['cancelled', 'canceled'].includes(normalized(sale.fulfillmentStatus || sale.fulfillment_status))
);

export const getSalePaymentStatusCategory = (sale = {}) => {
  if (isCancelledSale(sale)) return 'cancelled';

  const status = normalized(sale.paymentStatus || sale.payment_status);
  const method = normalized(sale.paymentMethod || sale.payment_method);

  if (PAID_PAYMENT_STATUSES.has(status)) return 'paid';
  if (CREDIT_PAYMENT_STATUSES.has(status)) return 'credit';
  if (PARTIAL_PAYMENT_STATUSES.has(status)) {
    const paidInitially = normalizeFinancialNumber(firstValue(sale, [
      'initialAmountPaid', 'initial_amount_paid', 'amountPaid', 'amount_paid', 'abono'
    ]), Number.NaN);
    if (Number.isFinite(paidInitially) && paidInitially === 0) return 'credit';
    if ((Number.isFinite(paidInitially) && paidInitially > 0) || MIXED_CREDIT_METHODS.has(method)) return 'mixed_credit';
    return 'partial';
  }
  if (status === 'unpaid' && ['credit', 'fiado'].includes(method)) return 'credit';

  return 'unknown';
};

export const getSalePaymentStatusLabel = (sale = {}) => (
  PAYMENT_STATUS_LABELS[getSalePaymentStatusCategory(sale)]
);

export const getSaleInitialFinancialAmounts = (sale = {}) => {
  const paidInitially = normalizeFinancialNumber(firstValue(sale, [
    'initialAmountPaid', 'initial_amount_paid', 'amountPaid', 'amount_paid', 'abono'
  ]), Number.NaN);
  const normalizedPaidInitially = Number.isFinite(paidInitially) && paidInitially >= 0
    ? paidInitially
    : null;

  const explicitInitialCredit = normalizeFinancialNumber(firstValue(sale, [
    'initialCreditAmount', 'initial_credit_amount', 'original_balance_due'
  ]), Number.NaN);
  const initialCredit = Number.isFinite(explicitInitialCredit)
    ? explicitInitialCredit
    : Number.NaN;

  return {
    paidInitially: normalizedPaidInitially,
    initialCredit: Number.isFinite(initialCredit) && initialCredit >= 0 ? initialCredit : null
  };
};

export const dedupeSalesByStableId = (sales = []) => {
  const seen = new Set();
  return (Array.isArray(sales) ? sales : []).filter((sale) => {
    const id = firstValue(sale, ['cloudSaleId', 'cloud_sale_id', 'id']);
    if (!id) return true;
    const key = String(id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const formatSaleDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

export const formatSalesHistoryDateRange = (range = {}) => {
  const normalizedRange = range && typeof range === 'object' ? range : {};
  const from = normalizedRange.date_from || normalizedRange.start || normalizedRange.from || normalizedRange.dateFrom || null;
  const to = normalizedRange.date_to || normalizedRange.end || normalizedRange.to || normalizedRange.dateTo || null;
  if (!from && !to) return 'Rango de consulta no informado';
  return `Desde ${from ? formatSaleDate(from) : 'sin inicio'} hasta ${to ? formatSaleDate(to) : 'sin fin'}`;
};

const escapeCsvCell = (value) => {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

const getSaleValue = (sale = {}, keys = []) => firstValue(sale, keys);

const getSaleTotal = (sale = {}) => {
  const total = normalizeFinancialNumber(getSaleValue(sale, ['total', 'net_total', 'net_sales_total']), Number.NaN);
  return Number.isFinite(total) ? formatCurrencyMXN(total) : '';
};

const getProductSummary = (sale = {}) => {
  const items = Array.isArray(sale.items) ? sale.items : (Array.isArray(sale.sale_items) ? sale.sale_items : []);
  return items.map((item = {}) => {
    const name = firstValue(item, ['name', 'productName', 'product_name', 'description']);
    if (!name) return null;
    const quantity = firstValue(item, ['quantity', 'qty']);
    return quantity === null ? String(name) : `${quantity} × ${name}`;
  }).filter(Boolean).join('; ');
};

const getInitialAmountLabel = (value) => (
  value === null ? '' : formatCurrencyMXN(value)
);

const formatFilters = (filters = []) => (
  filters.length ? filters.join('; ') : 'Sin filtros locales'
);

const CSV_COLUMNS = Object.freeze([
  'venta_id',
  'venta_cloud_id',
  'folio_operativo',
  'folio_financiero',
  'pedido_ecommerce',
  'canal',
  'fecha',
  'cliente',
  'productos',
  'total_comercial_mxn',
  'metodo_pago',
  'estado_pago',
  'estado_venta',
  'origen_venta',
  'pagado_inicialmente_mxn',
  'credito_inicial_historico_mxn',
  'periodo_consulta',
  'filtros_aplicados',
  'alcance',
  'origen_datos',
  'cobertura',
  'pagina',
  'registros_cargados_en_pagina',
  'registros_exportados',
  'total_disponible_en_consulta'
]);

const saleRowValues = (sale = {}, metadata = {}) => {
  const initialAmounts = getSaleInitialFinancialAmounts(sale);
  const totalCount = Number.isFinite(Number(metadata.totalCount)) && metadata.totalCount !== null
    ? String(metadata.totalCount)
    : 'No informado';

  return [
    getSaleValue(sale, ['id', 'localSaleId', 'local_sale_id']) || '',
    getSaleValue(sale, ['cloudSaleId', 'cloud_sale_id']) || '',
    getSaleOperationalFolio(sale) || '',
    getSaleFinancialFolio(sale) || '',
    getSaleEcommerceOrderCode(sale) || '',
    getSaleOriginLabel(sale) || '',
    formatSaleDate(getSaleValue(sale, ['timestamp', 'soldAt', 'sold_at', 'createdAt', 'created_at'])),
    getSaleValue(sale, ['customerName', 'customer_name']) || sale.customer?.name || sale.customerSnapshot?.name || '',
    getProductSummary(sale),
    getSaleTotal(sale),
    getSaleValue(sale, ['paymentMethod', 'payment_method']) || '',
    getSalePaymentStatusLabel(sale),
    isCancelledSale(sale) ? 'Cancelada' : (getSaleValue(sale, ['status', 'sale_status']) || 'Desconocida'),
    getSaleValue(sale, ['sourceMode', 'source_mode']) || 'Desconocido',
    getInitialAmountLabel(initialAmounts.paidInitially),
    getInitialAmountLabel(initialAmounts.initialCredit),
    metadata.period || formatSalesHistoryDateRange(metadata.dateRange),
    formatFilters(metadata.activeFilters),
    metadata.scopeLabel || 'Alcance no informado',
    metadata.sourceLabel || 'Origen no informado',
    metadata.coverageLabel || 'Página visible',
    String((Number(metadata.pageIndex) || 0) + 1),
    String(Number(metadata.pageLoadedCount) || 0),
    String(Number(metadata.exportedCount) || 0),
    totalCount
  ];
};

export const buildSalesHistoryCsv = (sales = [], metadata = {}) => {
  const uniqueSales = dedupeSalesByStableId(sales);
  const rows = uniqueSales.map((sale) => saleRowValues(sale, {
    ...metadata,
    exportedCount: uniqueSales.length
  }));
  return [CSV_COLUMNS, ...rows]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\r\n');
};

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character]);

const printRow = (sale = {}) => {
  const initialAmounts = getSaleInitialFinancialAmounts(sale);
  const fields = [
    getSaleFinancialFolio(sale) || getSaleOperationalFolio(sale) || getSaleValue(sale, ['id']) || '',
    formatSaleDate(getSaleValue(sale, ['timestamp', 'soldAt', 'sold_at', 'createdAt', 'created_at'])),
    getSaleValue(sale, ['customerName', 'customer_name']) || sale.customer?.name || sale.customerSnapshot?.name || '',
    getProductSummary(sale),
    getSaleTotal(sale),
    getSaleValue(sale, ['paymentMethod', 'payment_method']) || '',
    getSalePaymentStatusLabel(sale),
    isCancelledSale(sale) ? 'Cancelada' : (getSaleValue(sale, ['status', 'sale_status']) || 'Desconocida'),
    initialAmounts.paidInitially === null ? '' : `Pagado inicialmente: ${formatCurrencyMXN(initialAmounts.paidInitially)}`,
    initialAmounts.initialCredit === null ? '' : `Crédito inicial (histórico): ${formatCurrencyMXN(initialAmounts.initialCredit)}`
  ];
  return `<tr>${fields.map((field) => `<td>${escapeHtml(field)}</td>`).join('')}</tr>`;
};

export const buildSalesHistoryPrintHtml = (sales = [], metadata = {}) => {
  const uniqueSales = dedupeSalesByStableId(sales);
  const pageNumber = (Number(metadata.pageIndex) || 0) + 1;
  const coverage = metadata.coverageLabel || `Solo página ${pageNumber}: ${uniqueSales.length} registro(s) filtrado(s)`;
  const range = metadata.period || formatSalesHistoryDateRange(metadata.dateRange);
  const filters = formatFilters(metadata.activeFilters);
  const rows = uniqueSales.map(printRow).join('');

  return `<!doctype html>
<html lang="es-MX">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Historial de ventas · Página ${pageNumber}</title>
    <style>
      @page { size: landscape; margin: 9mm; }
      * { box-sizing: border-box; }
      body { color: #171717; font: 10px Arial, sans-serif; margin: 0; }
      h1 { font-size: 18px; margin: 0 0 6px; }
      .meta { margin: 2px 0; overflow-wrap: anywhere; }
      .notice { background: #fff4d6; border: 1px solid #d8a500; font-weight: 700; margin: 8px 0 12px; padding: 6px; }
      table { border-collapse: collapse; table-layout: fixed; width: 100%; }
      th, td { border: 1px solid #aeb4bd; overflow-wrap: anywhere; padding: 4px; text-align: left; vertical-align: top; }
      th { background: #edf0f4; }
      th:nth-child(1) { width: 8%; }
      th:nth-child(2) { width: 11%; }
      th:nth-child(3) { width: 12%; }
      th:nth-child(4) { width: 19%; }
      th:nth-child(5) { width: 9%; }
      th:nth-child(6) { width: 8%; }
      th:nth-child(7) { width: 9%; }
      th:nth-child(8), th:nth-child(9), th:nth-child(10) { width: 8%; }
      .money { text-align: right; white-space: normal; }
      tr { break-inside: avoid; }
      thead { display: table-header-group; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(metadata.businessName || 'LANZO POS')} · Historial de ventas</h1>
    <p class="meta"><strong>Período:</strong> ${escapeHtml(range)}</p>
    <p class="meta"><strong>Filtros locales:</strong> ${escapeHtml(filters)}</p>
    <p class="meta"><strong>Alcance:</strong> ${escapeHtml(metadata.scopeLabel || 'Alcance no informado')}</p>
    <p class="meta"><strong>Origen de datos:</strong> ${escapeHtml(metadata.sourceLabel || 'Origen no informado')}</p>
    <p class="notice">${escapeHtml(coverage)}. Este documento contiene únicamente la página visible; no representa todo el historial.</p>
    <table>
      <thead><tr><th>Folio</th><th>Fecha</th><th>Cliente</th><th>Productos (si están disponibles)</th><th>Total comercial</th><th>Método</th><th>Estado de pago</th><th>Estado de venta</th><th>Pagado inicialmente</th><th>Crédito inicial (histórico)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;
};
