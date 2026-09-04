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

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isLeapYear = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const daysInMonth = (year, month) => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const timestamp = (value) => {
  if (value === null || value === undefined) return null;
  const raw = String(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) {
    throw new Error('FINANCIAL_TIMESTAMP_INVALID');
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '', timezone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHours = timezone === 'Z' ? 0 : Number(timezone.slice(1, 3));
  const offsetMinutes = timezone === 'Z' ? 0 : Number(timezone.slice(4, 6));

  // Date.UTC normalizes overflow (2026-02-30 becomes March 2). Validate the
  // calendar and clock components before constructing the instant so malformed
  // financial timestamps cannot be silently rewritten.
  if (
    year < 1
    || year > 9999
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth(year, month)
    || hour > 23
    || minute > 59
    || second > 59
    || (timezone !== 'Z' && (offsetHours > 23 || offsetMinutes > 59))
  ) {
    throw new Error('FINANCIAL_TIMESTAMP_INVALID');
  }

  const offset = (offsetHours * 60 + offsetMinutes) * (timezone === 'Z' || timezone.startsWith('+') ? 1 : -1);
  // setUTCFullYear avoids Date.UTC's special 1900 offset for years 0..99.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute - offset, second, 0);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
    throw new Error('FINANCIAL_TIMESTAMP_INVALID');
  }
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

const splitChildOperationType = (child = {}) => {
  const method = String(firstNonblank(child.sale, ['payment_method', 'paymentMethod']) || '').trim().toLowerCase();
  if (['credit', 'fiado', 'mixed_credit', 'partial_credit', 'credito', 'crédito', 'credito_parcial', 'crédito_parcial'].includes(method)) {
    return 'sale.credit';
  }
  return child.sale?.metadata?.cloudInventoryEffects === true
    ? 'sale.cashier_inventory'
    : 'sale.cashier';
};

const canonicalSplitChild = (child = {}) => {
  const operationType = splitChildOperationType(child);
  const saleRecord = child.sale && typeof child.sale === 'object' && !Array.isArray(child.sale)
    ? child.sale
    : {};
  const items = Array.isArray(child.items) ? child.items : [];
  const payments = Array.isArray(child.payments) ? child.payments : [];
  return {
    label: text(firstNonblank(child, ['label'])),
    sale: sale(operationType, saleRecord),
    items: items.map(saleItem),
    payments: payments.map((item) => salePayment(operationType, item)),
    customer_id: text(firstNonblank(child, ['customer_id']) || firstNonblank(saleRecord, ['customer_id', 'customerId']))
  };
};

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

const layawayItem = (item = {}) => compact({
  id: text(firstNonblank(item, ['id'])),
  product_id: text(firstNonblank(item, ['product_id', 'productId', 'parentId'])),
  product_name: text(firstNonblank(item, ['product_name', 'productName', 'name'])),
  product_sku: text(firstNonblank(item, ['product_sku', 'productSku', 'sku'])),
  barcode: text(firstNonblank(item, ['barcode', 'barCode'])),
  category_id: text(firstNonblank(item, ['category_id', 'categoryId'])),
  category_name: text(firstNonblank(item, ['category_name', 'categoryName', 'rubro', 'category'])),
  rubro: text(firstNonblank(item, ['rubro', 'category', 'categoryName'])),
  batch_id: text(firstNonblank(item, ['batch_id', 'batchId'])),
  batch_sku: text(firstNonblank(item, ['batch_sku', 'batchSku'])),
  batch_expiry_date: text(firstNonblank(item, ['batch_expiry_date', 'batchExpiryDate', 'expiryDate'])),
  variant_id: text(firstNonblank(item, ['variant_id', 'variantId'])),
  size: text(firstNonblank(item, ['size', 'talla'])),
  color: text(firstNonblank(item, ['color', 'colorName'])),
  attributes: item?.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes)
    ? item.attributes
    : null,
  variant_attributes: item?.variant_attributes && typeof item.variant_attributes === 'object' && !Array.isArray(item.variant_attributes)
    ? item.variant_attributes
    : (item?.variantAttributes && typeof item.variantAttributes === 'object' && !Array.isArray(item.variantAttributes)
      ? item.variantAttributes
      : null),
  quantity: decimal(firstNonblank(item, ['quantity', 'qty'])),
  unit_price: decimal(firstNonblank(item, ['unit_price', 'unitPrice', 'price'])),
  unit_cost: decimal(firstNonblank(item, ['unit_cost', 'unitCost', 'cost'])),
  line_total: decimal(firstNonblank(item, ['line_total', 'lineTotal', 'total', 'exactTotal'])),
  discount_amount: decimal(firstNonblank(item, ['discount_amount', 'discountAmount'])) || '0',
  tax_amount: decimal(firstNonblank(item, ['tax_amount', 'taxAmount'])) || '0'
});

const layawayPayment = (payment = {}, fallbackCashSessionId = null) => {
  const rawMethod = String(firstNonblank(payment, ['method', 'payment_method', 'paymentMethod']) || 'cash')
    .trim()
    .toLowerCase();
  return compact({
    id: text(firstNonblank(payment, ['id', 'payment_id', 'paymentId'])),
    method: rawMethod === 'efectivo' ? 'cash' : rawMethod,
    amount: decimal(firstNonblank(payment, ['amount', 'total'])),
    payment_type: text(firstNonblank(payment, ['payment_type', 'paymentType', 'type'])),
    reference: text(firstNonblank(payment, ['reference', 'ref'])),
    customer_id: text(firstNonblank(payment, ['customer_id', 'customerId'])),
    cash_session_id: text(firstNonblank(payment, ['cash_session_id', 'cashSessionId', 'cajaId'])) || text(fallbackCashSessionId)
  });
};

const layawayPaymentPayload = (request = {}) => {
  if (request.payment && typeof request.payment === 'object' && !Array.isArray(request.payment)) return request.payment;
  if (request.initial_payment && typeof request.initial_payment === 'object' && !Array.isArray(request.initial_payment)) return request.initial_payment;
  if (request.initialPayment && typeof request.initialPayment === 'object' && !Array.isArray(request.initialPayment)) return request.initialPayment;
  return {};
};

const layawayCashSessionId = (request = {}) => text(
  firstNonblank(request, ['cash_session_id', 'cashSessionId', 'cajaId'])
  || firstNonblank(layawayPaymentPayload({ initial_payment: request.initial_payment }), ['cash_session_id', 'cashSessionId', 'cajaId'])
  || firstNonblank(layawayPaymentPayload({ initialPayment: request.initialPayment }), ['cash_session_id', 'cashSessionId', 'cajaId'])
  || firstNonblank(request.payment, ['cash_session_id', 'cashSessionId', 'cajaId'])
  || firstNonblank(request.refund, ['cash_session_id', 'cashSessionId', 'cajaId'])
);

const layawayRecord = (request = {}) => (
  request.layaway && typeof request.layaway === 'object' && !Array.isArray(request.layaway)
    ? request.layaway
    : (request.layawayData && typeof request.layawayData === 'object' && !Array.isArray(request.layawayData)
      ? request.layawayData
      : {})
);

const layawayDeadline = (layaway = {}) => {
  const raw = text(firstNonblank(layaway, ['deadline', 'due_date', 'dueDate']));
  if (!raw) throw new Error('LAYAWAY_DEADLINE_REQUIRED');
  return DATE_ONLY_PATTERN.test(raw)
    ? timestamp(`${raw}T00:00:00.000000Z`)
    : timestamp(raw);
};

const canonicalLayawayRequest = (operationType, request = {}) => {
  if (operationType === 'layaway.create') {
    const layaway = layawayRecord(request);
    const items = Array.isArray(layaway.items) ? layaway.items : [];
    const payment = layawayPaymentPayload(request);
    const cashSessionId = layawayCashSessionId(request);
    return compact({
      layaway: compact({
        id: text(firstNonblank(layaway, ['id', 'layaway_id', 'layawayId'])),
        customer_id: text(firstNonblank(layaway, ['customer_id', 'customerId'])),
        customer_name: text(firstNonblank(layaway, ['customer_name', 'customerName'])),
        customer_phone: text(firstNonblank(layaway, ['customer_phone', 'customerPhone'])),
        total_amount: decimal(firstNonblank(layaway, ['total_amount', 'totalAmount', 'total'])),
        currency: text(firstNonblank(layaway, ['currency']) || 'MXN')?.toUpperCase() || null,
        deadline: layawayDeadline(layaway),
        items: items.map(layawayItem)
      }),
      initial_payment: Object.keys(payment).length > 0 ? layawayPayment(payment, cashSessionId) : null,
      cash_session_id: cashSessionId
    });
  }

  if (operationType === 'layaway.payment') {
    const cashSessionId = layawayCashSessionId(request);
    return compact({
      layaway_id: text(firstNonblank(request, ['layaway_id', 'layawayId', 'id'])),
      payment: layawayPayment(layawayPaymentPayload(request), cashSessionId),
      cash_session_id: cashSessionId
    });
  }

  if (operationType === 'layaway.cancel') {
    return compact({
      layaway_id: text(firstNonblank(request, ['layaway_id', 'layawayId', 'id'])),
      reason: text(firstNonblank(request, ['reason', 'motivo'])) || 'Cancelación de apartado',
      retain_money: Boolean(request.retain_money ?? request.retainMoney ?? request.retained_money ?? false),
      refund_id: text(firstNonblank(request, ['refund_id', 'refundId'])),
      cash_session_id: layawayCashSessionId(request)
    });
  }

  throw new Error('FINANCIAL_OPERATION_TYPE_UNSUPPORTED');
};

export const canonicalFinancialRequestV1 = (operationType, request = {}) => {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('FINANCIAL_REQUEST_CONTRACT_INVALID');
  switch (operationType) {
    case 'layaway.create':
    case 'layaway.payment':
    case 'layaway.cancel':
      return canonicalLayawayRequest(operationType, request);
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
      return { sale: sale(operationType, request.sale), items: request.items.map(saleItem), payments: request.payments.map((item) => salePayment(operationType, item)), cash_session_id: text(firstNonblank(request, ['cash_session_id', 'cashSessionId'])), customer_id: text(firstNonblank(request, ['customer_id', 'customerId'])) };
    case 'sale.split': {
      if (!Array.isArray(request.children) || request.children.length < 2 || request.children.length > 8) {
        throw new Error('FINANCIAL_SPLIT_CONTRACT_INVALID');
      }
      return {
        parent_order_id: text(firstNonblank(request, ['parent_order_id', 'parentOrderId'])),
        parent_order_version: text(firstNonblank(request, ['parent_order_version', 'parentOrderVersion'])),
        split_group_id: text(firstNonblank(request, ['split_group_id', 'splitGroupId'])),
        cash_session_id: text(firstNonblank(request, ['cash_session_id', 'cashSessionId'])),
        children: request.children.map(canonicalSplitChild)
      };
    }
    case 'sale.layaway_complete': {
      if (!request.sale || !Array.isArray(request.items) || !Array.isArray(request.payments)) {
        throw new Error('FINANCIAL_LAYAWAY_CONTRACT_INVALID');
      }
      return {
        layaway_id: text(firstNonblank(request, ['layaway_id', 'layawayId'])),
        sale: sale('sale.layaway_complete', request.sale),
        items: request.items.map(saleItem),
        payments: request.payments.map((item) => salePayment('sale.layaway_complete', item))
      };
    }
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
