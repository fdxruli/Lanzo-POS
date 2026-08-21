const text = (value) => {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result || null;
};

const firstNonblank = (source, keys = []) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  for (const key of keys) {
    if (!(key in source)) continue;
    const value = source[key];
    if (value !== null && value !== undefined && text(value) !== null) return value;
  }
  return null;
};

const NO_VALUE = Symbol('financial-no-value');

const firstPresent = (source, keys = []) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return NO_VALUE;
  for (const key of keys) if (key in source) return source[key];
  return NO_VALUE;
};

const decimal = (value) => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) throw new Error('FINANCIAL_NUMERIC_INVALID');
  const negative = raw.startsWith('-');
  const unsigned = raw.replace(/^[+-]/, '');
  let [whole, fraction = ''] = unsigned.split('.');
  whole = whole.replace(/^0+(?=\d)/, '') || '0';
  fraction = fraction.replace(/0+$/, '');
  const normalized = fraction ? `${whole}.${fraction}` : whole;
  return negative && normalized !== '0' ? `-${normalized}` : normalized;
};

const integer = (value) => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!/^[+-]?\d+$/.test(raw)) throw new Error('FINANCIAL_INTEGER_INVALID');
  const negative = raw.startsWith('-');
  const normalized = raw.replace(/^[+-]/, '').replace(/^0+(?=\d)/, '') || '0';
  return negative && normalized !== '0' ? `-${normalized}` : normalized;
};

const timestamp = (value) => {
  if (value === null || value === undefined) return null;
  const raw = String(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) {
    throw new Error('FINANCIAL_TIMESTAMP_INVALID');
  }
  const [, year, month, day, hour, minute, second, fraction = '', timezone] = match;
  const offset = timezone === 'Z' ? 0 : ((Number(timezone.slice(1, 3)) * 60 + Number(timezone.slice(4, 6))) * (timezone.startsWith('+') ? 1 : -1));
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute) - offset, Number(second)));
  if (Number.isNaN(date.getTime())) throw new Error('FINANCIAL_TIMESTAMP_INVALID');
  // PostgreSQL's to_char(...US...) preserves microseconds and always emits six.
  return `${date.toISOString().slice(0, 19)}.${fraction.slice(0, 6).padEnd(6, '0')}Z`;
};

const compact = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));

const paymentMethod = (operationType, raw) => {
  const method = String(raw || '').trim().toLowerCase();
  if (operationType === 'sale.credit' && ['mixed_credit', 'partial_credit', 'credito_parcial', 'crédito_parcial'].includes(method)) return 'mixed_credit';
  if (['cash', 'efectivo'].includes(method)) return 'cash';
  if (['card', 'tarjeta', 'tarjeta_credito', 'tarjeta_debito', 'debit', 'credit_card', 'debit_card'].includes(method)) return 'card';
  if (['transfer', 'transferencia', 'spei', 'bank_transfer'].includes(method)) return 'transfer';
  if (['mixed', 'mixto'].includes(method)) return 'mixed';
  if (['fiado', 'credit', 'credito', 'crédito', 'debt', 'customer_credit', 'cuenta_cliente'].includes(method)) return 'credit';
  return method || null;
};

const batchAllocations = (item) => {
  let rows = firstPresent(item, ['batches_used', 'batchesUsed']);
  if (rows === NO_VALUE) rows = firstPresent(item?.metadata, ['batches_used', 'batchesUsed']);
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => compact({
    batch_id: text(firstNonblank(row, ['batch_id', 'batchId', 'id'])),
    quantity: decimal(firstNonblank(row, ['quantity', 'qty', 'usedQuantity', 'used_quantity']))
  }));
};

const selectedModifiers = (item) => {
  let rows = firstPresent(item, ['selected_modifiers', 'selectedModifiers']);
  if (rows === NO_VALUE) rows = firstPresent(item?.metadata, ['selected_modifiers', 'selectedModifiers']);
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => compact({
    ingredient_id: text(firstNonblank(row, ['ingredientId', 'ingredient_id'])),
    ingredient_quantity: decimal(firstNonblank(row, ['ingredientQuantity', 'ingredient_quantity', 'quantity']))
  }));
};

const saleItem = (item = {}) => compact({
  id: text(firstNonblank(item, ['id'])),
  product_id: text(firstNonblank(item, ['product_id', 'productId', 'parentId'])),
  product_name: text(firstNonblank(item, ['product_name', 'productName', 'name'])),
  product_sku: text(firstNonblank(item, ['product_sku', 'productSku', 'sku'])),
  barcode: text(firstNonblank(item, ['barcode', 'barCode'])),
  category_id: text(firstNonblank(item, ['category_id', 'categoryId'])),
  category_name: text(firstNonblank(item, ['category_name', 'categoryName', 'rubro', 'category'])),
  batch_id: text(firstNonblank(item, ['batch_id', 'batchId'])),
  batch_sku: text(firstNonblank(item, ['batch_sku', 'batchSku'])),
  batch_expiry_date: text(firstNonblank(item, ['batch_expiry_date', 'batchExpiryDate', 'expiryDate'])),
  stock_source: text(firstNonblank(item, ['stock_source', 'stockSource'])),
  batch_allocations: batchAllocations(item),
  selected_modifiers: selectedModifiers(item),
  quantity: decimal(firstNonblank(item, ['quantity', 'qty'])),
  unit_price: decimal(firstNonblank(item, ['unit_price', 'unitPrice', 'price'])),
  unit_cost: decimal(firstNonblank(item, ['unit_cost', 'unitCost', 'cost'])),
  line_total: decimal(firstNonblank(item, ['line_total', 'lineTotal', 'total', 'exactTotal'])),
  discount_amount: decimal(firstNonblank(item, ['discount_amount', 'discountAmount'])),
  tax_amount: decimal(firstNonblank(item, ['tax_amount', 'taxAmount']))
});

const salePayment = (operationType, payment = {}) => compact({
  id: text(firstNonblank(payment, ['id'])),
  method: paymentMethod(operationType, text(firstNonblank(payment, ['method', 'payment_method', 'paymentMethod']))),
  amount: decimal(firstNonblank(payment, ['amount', 'total'])),
  received_amount: decimal(firstNonblank(payment, ['received_amount', 'receivedAmount'])),
  change_amount: decimal(firstNonblank(payment, ['change_amount', 'changeAmount'])),
  reference: text(firstNonblank(payment, ['reference', 'ref']))
});

const sale = (operationType, record = {}) => compact({
  id: text(firstNonblank(record, ['id', 'cloud_sale_id', 'cloudSaleId'])),
  local_sale_id: text(firstNonblank(record, ['local_sale_id', 'localSaleId'])),
  subtotal: decimal(firstNonblank(record, ['subtotal'])),
  discount_total: decimal(firstNonblank(record, ['discount_total', 'discountTotal'])),
  tax_total: decimal(firstNonblank(record, ['tax_total', 'taxTotal'])),
  total: decimal(firstNonblank(record, ['total'])),
  amount_paid: decimal(firstNonblank(record, ['amount_paid', 'amountPaid', 'abono'])),
  change_amount: decimal(firstNonblank(record, ['change_amount', 'changeAmount'])),
  balance_due: decimal(firstNonblank(record, ['balance_due', 'balanceDue', 'saldoPendiente'])),
  payment_method: paymentMethod(operationType, text(firstNonblank(record, ['payment_method', 'paymentMethod']))),
  fulfillment_status: text(firstNonblank(record, ['fulfillment_status', 'fulfillmentStatus'])),
  local_folio: text(firstNonblank(record, ['local_folio', 'localFolio', 'folio'])),
  customer_id: text(firstNonblank(record, ['customer_id', 'customerId'])),
  customer_name: text(firstNonblank(record, ['customer_name', 'customerName'])),
  customer_phone: text(firstNonblank(record, ['customer_phone', 'customerPhone'])),
  currency: text(firstNonblank(record, ['currency']))?.toUpperCase() || null,
  sold_at: timestamp(firstNonblank(record, ['sold_at', 'soldAt', 'timestamp'])),
  created_at: timestamp(firstNonblank(record, ['created_at', 'createdAt', 'timestamp']))
});

export const canonicalFinancialRequestV1 = (operationType, request = {}) => {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('FINANCIAL_REQUEST_CONTRACT_INVALID');
  switch (operationType) {
    case 'cash.open': return { opening: {
      opening_amount: decimal(firstNonblank(request, ['opening_amount', 'montoInicial'])) || '0',
      opening_counted_amount: decimal(firstNonblank(request, ['opening_counted_amount', 'montoContado', 'montoContadoInicial'])),
      opening_suggested_amount: decimal(firstNonblank(request, ['opening_suggested_amount', 'montoSugerido'])),
      opening_policy: text(firstNonblank(request, ['opening_policy', 'politicaApertura'])),
      opening_origin: text(firstNonblank(request, ['opening_origin', 'origen'])),
      is_auto_opening: text(firstNonblank(request, ['is_auto_opening', 'esAutoApertura'])),
      responsible_name: text(firstNonblank(request, ['responsible_name', 'responsable']))
    } };
    case 'cash.movement': return {
      cash_session_id: request.cash_session_id ?? null, type: request.type ?? null, amount: decimal(request.amount), concept: request.concept ?? null,
      source: request.source ?? null, reference_type: request.reference_type ?? null, reference_id: request.reference_id ?? null
    };
    case 'cash.adjust_initial_fund': return {
      cash_session_id: request.cash_session_id ?? null, new_opening_amount: decimal(request.new_opening_amount), reason: request.reason ?? null, expected_version: integer(request.expected_version)
    };
    case 'cash.close': return {
      cash_session_id: request.cash_session_id ?? null,
      closing_counted_amount: decimal(firstNonblank(request, ['closing_counted_amount', 'countedAmount', 'montoFisicoTotal'])),
      next_shift_fund: decimal(firstNonblank(request, ['next_shift_fund', 'nextShiftFund', 'montoFondoSiguienteTurno'])),
      comments: text(firstNonblank(request, ['audit_comments', 'comments', 'comentarios'])), expected_version: integer(request.expected_version)
    };
    case 'cash.admin_close': return {
      cash_session_id: request.cash_session_id ?? null, closing_mode: request.closing_mode ?? null, counted_amount: decimal(request.counted_amount),
      next_shift_fund: decimal(request.next_shift_fund), reason_code: request.reason_code ?? null, comments: request.comments ?? null, expected_version: integer(request.expected_version)
    };
    case 'sale.cashier': case 'sale.cashier_inventory': case 'sale.credit':
      if (!request.sale || !Array.isArray(request.items) || !Array.isArray(request.payments)) throw new Error('FINANCIAL_SALE_CONTRACT_INVALID');
      return { sale: sale(operationType, request.sale), items: request.items.map(saleItem), payments: request.payments.map((item) => salePayment(operationType, item)), cash_session_id: text(request.cash_session_id), customer_id: text(request.customer_id) };
    case 'sale.cancel': return { sale_id: request.sale_id ?? null, reason: request.reason ?? null };
    default: throw new Error('FINANCIAL_OPERATION_TYPE_UNSUPPORTED');
  }
};

export const canonicalJsonV1 = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonV1).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonV1(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

const sha256 = async (input) => {
  if (!globalThis.crypto?.subtle) throw new Error('FINANCIAL_CRYPTO_UNAVAILABLE');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const hashCanonicalFinancialRequestV1 = async ({ operationType, canonicalRequest, actorKey, cashSessionId = null, cashStationId = null }) => {
  if (!text(operationType) || !text(actorKey)) throw new Error('FINANCIAL_REQUEST_CONTRACT_INVALID');
  const document = { request_contract_version: 1, operation_type: operationType, request: canonicalRequest, verified_origin: { actor_key: actorKey, cash_session_id: cashSessionId, cash_station_id: cashStationId } };
  return `sha256:${await sha256(canonicalJsonV1(document))}`;
};

export const financialRequestHashV1 = async ({ operationType, request, actorKey, cashSessionId = null, cashStationId = null }) => {
  const canonicalRequest = canonicalFinancialRequestV1(operationType, request);
  return { canonicalRequest, requestHash: await hashCanonicalFinancialRequestV1({ operationType, canonicalRequest, actorKey, cashSessionId, cashStationId }) };
};
