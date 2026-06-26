const toNumber = (value, fallback = 0) => {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toIsoString = (value, fallback = new Date().toISOString()) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

const compactObject = (value = {}) => Object.fromEntries(
  Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null)
);

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return null;
};

const toBoolean = (value, fallback = false) => {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', 'yes', 'si', 'sí', 'enabled', 'active'].includes(normalized)) return true;
  if (['false', 'no', 'disabled', 'inactive'].includes(normalized)) return false;
  return fallback;
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const hasBatchManagement = (item = {}) => {
  const raw = item.batchManagement ?? item.batch_management ?? item.metadata?.batchManagement ?? item.metadata?.batch_management;
  if (typeof raw === 'boolean') return raw;
  if (raw && typeof raw === 'object') {
    return toBoolean(raw.enabled, false)
      || toBoolean(raw.batchManagement, false)
      || toBoolean(raw.manageBatches, false)
      || toBoolean(raw.useBatches, false)
      || ['batch', 'batches', 'lote', 'lotes', 'fefo'].includes(String(raw.mode || '').toLowerCase());
  }
  return toBoolean(raw, false);
};

export const normalizeCloudCashierPaymentMethod = (method) => {
  const normalized = String(method || '').trim().toLowerCase();
  if (['cash', 'efectivo'].includes(normalized)) return 'cash';
  if (['card', 'tarjeta', 'tarjeta_credito', 'tarjeta_debito', 'credit_card', 'debit_card'].includes(normalized)) return 'card';
  if (['transfer', 'transferencia', 'spei', 'bank_transfer'].includes(normalized)) return 'transfer';
  if (['mixed', 'mixto'].includes(normalized)) return 'mixed';
  if (['fiado', 'credit', 'credito', 'crédito', 'debt', 'customer_credit'].includes(normalized)) return 'credit';
  return normalized || 'unknown';
};

export const isCreditLikePaymentMethod = (method) => (
  normalizeCloudCashierPaymentMethod(method) === 'credit'
);

const isSupportedSingleMethod = (method) => (
  ['cash', 'card', 'transfer'].includes(normalizeCloudCashierPaymentMethod(method))
);

export const isCloudCashierCompatiblePayment = (paymentData = {}) => {
  const method = normalizeCloudCashierPaymentMethod(paymentData.paymentMethod);
  if (method === 'credit') return false;
  if (method === 'mixed') {
    const payments = paymentData.payments || paymentData.paymentBreakdown || paymentData.paymentDetails?.payments;
    return Array.isArray(payments) && payments.length > 1 && payments.every((payment) => isSupportedSingleMethod(payment.method || payment.paymentMethod));
  }
  return isSupportedSingleMethod(method);
};

const getLineTotal = (item = {}) => {
  if (item.exactTotal !== undefined) return toNumber(item.exactTotal, 0);
  if (item.lineTotal !== undefined) return toNumber(item.lineTotal, 0);
  if (item.total !== undefined) return toNumber(item.total, 0);
  return toNumber(item.price, 0) * toNumber(item.quantity, 0);
};

const resolveTrackStock = (item = {}) => {
  if (item.trackStock !== undefined) return toBoolean(item.trackStock, true);
  if (item.track_stock !== undefined) return toBoolean(item.track_stock, true);
  if (item.metadata?.trackStock !== undefined) return toBoolean(item.metadata.trackStock, true);
  return true;
};

const resolveStockSource = ({ item, batchId, batchesUsed, trackStock }) => {
  const explicit = firstText(item.stockSource, item.stock_source, item.metadata?.stockSource, item.metadata?.stock_source);
  if (['batch', 'product', 'none'].includes(String(explicit || '').toLowerCase())) return String(explicit).toLowerCase();
  if (!trackStock) return 'none';
  if (batchId || batchesUsed.length > 0 || hasBatchManagement(item)) return 'batch';
  return 'product';
};

const normalizeBatchUsage = (batch = {}) => compactObject({
  batch_id: firstText(batch.batch_id, batch.batchId, batch.id),
  quantity: toNumber(batch.quantity ?? batch.qty ?? batch.usedQuantity ?? batch.used_quantity, 0),
  unit_cost: batch.unit_cost === undefined && batch.unitCost === undefined && batch.cost === undefined
    ? null
    : toNumber(batch.unit_cost ?? batch.unitCost ?? batch.cost, 0)
});

const mapItem = (item = {}, index = 0, { inventoryEnabled = false } = {}) => {
  const productId = firstText(item.productId, item.product_id, item.parentId, item.id);
  const quantity = toNumber(item.quantity, 0);
  const unitPrice = toNumber(item.price ?? item.unitPrice ?? item.unit_price, 0);
  const unitCost = item.cost === undefined && item.unitCost === undefined && item.unit_cost === undefined
    ? null
    : toNumber(item.cost ?? item.unitCost ?? item.unit_cost, 0);
  const batchId = firstText(item.batchId, item.batch_id);
  const batchesUsed = asArray(item.batches_used || item.batchesUsed || item.metadata?.batches_used || item.metadata?.batchesUsed)
    .map(normalizeBatchUsage)
    .filter((batch) => batch.batch_id && batch.quantity > 0);
  const trackStock = resolveTrackStock(item);
  const stockSource = resolveStockSource({ item, batchId, batchesUsed, trackStock });

  return compactObject({
    id: firstText(item.lineId, item.cartLineId) || `${productId || 'item'}:${index + 1}`,
    product_id: productId,
    product_name: firstText(item.name, item.productName, item.product_name) || 'Producto',
    product_sku: firstText(item.sku, item.productSku, item.product_sku),
    barcode: firstText(item.barcode, item.barCode),
    category_id: firstText(item.categoryId, item.category_id),
    category_name: firstText(item.categoryName, item.category_name, item.category, item.rubro),
    quantity,
    unit_price: unitPrice,
    unit_cost: unitCost,
    discount_amount: toNumber(item.discountAmount ?? item.discount_amount ?? item.discount, 0),
    tax_amount: toNumber(item.taxAmount ?? item.tax_amount ?? item.tax, 0),
    line_total: getLineTotal(item),
    batch_id: batchId,
    batch_sku: firstText(item.batchSku, item.batch_sku),
    batch_expiry_date: firstText(item.batchExpiryDate, item.batch_expiry_date, item.expiryDate),
    batches_used: batchesUsed.length > 0 ? batchesUsed : null,
    track_stock: trackStock,
    stock_source: stockSource,
    rubro: firstText(item.rubro, item.categoryName, item.category),
    metadata: compactObject({
      parentId: item.parentId || null,
      localProductId: item.localProductId || item.id || null,
      lineId: item.lineId || null,
      cartLineId: item.cartLineId || null,
      batchesUsed: batchesUsed.length > 0 ? batchesUsed : null,
      batchManagement: hasBatchManagement(item),
      trackStock,
      stockSource,
      inventoryEffectStatus: inventoryEnabled && stockSource !== 'none' ? 'pending_cloud' : 'not_required',
      creditEffectStatus: 'not_applied',
      snapshotOnly: !inventoryEnabled
    })
  });
};

const buildSinglePayment = ({ saleId, total, paymentData }) => {
  const method = normalizeCloudCashierPaymentMethod(paymentData.paymentMethod);
  const amountPaid = toNumber(paymentData.amountPaid, total);
  const receivedAmount = method === 'cash' ? Math.max(amountPaid, total) : total;
  const changeAmount = method === 'cash' ? Math.max(receivedAmount - total, 0) : 0;

  return compactObject({
    id: `${saleId}:payment:1`,
    method,
    amount: total,
    received_amount: receivedAmount,
    change_amount: changeAmount,
    reference: firstText(paymentData.reference, paymentData.paymentReference),
    metadata: {
      source: 'cloud_cashier_checkout',
      inventoryEffectStatus: 'not_applied',
      creditEffectStatus: 'not_applied'
    }
  });
};

const buildMixedPayments = ({ saleId, paymentData }) => {
  const payments = paymentData.payments || paymentData.paymentBreakdown || paymentData.paymentDetails?.payments || [];
  return payments.map((payment, index) => {
    const method = normalizeCloudCashierPaymentMethod(payment.method || payment.paymentMethod);
    const amount = toNumber(payment.amount ?? payment.total, 0);
    const receivedAmount = method === 'cash'
      ? toNumber(payment.receivedAmount ?? payment.received_amount, amount)
      : amount;
    const changeAmount = method === 'cash'
      ? toNumber(payment.changeAmount ?? payment.change_amount, Math.max(receivedAmount - amount, 0))
      : 0;

    return compactObject({
      id: firstText(payment.id) || `${saleId}:payment:${index + 1}`,
      method,
      amount,
      received_amount: receivedAmount,
      change_amount: changeAmount,
      reference: firstText(payment.reference, payment.ref),
      metadata: {
        ...(payment.metadata || {}),
        source: 'cloud_cashier_checkout_mixed',
        inventoryEffectStatus: 'not_applied',
        creditEffectStatus: 'not_applied'
      }
    });
  });
};

export const mapLocalCheckoutToCloudSale = ({
  sale = {},
  processedItems = [],
  paymentData = {},
  total = null,
  inventoryEnabled = false
} = {}) => {
  const now = new Date().toISOString();
  const saleId = sale.id || `sal_${Date.now()}`;
  const totalNumber = toNumber(total ?? sale.total, 0);
  const method = normalizeCloudCashierPaymentMethod(paymentData.paymentMethod || sale.paymentMethod);
  const payments = method === 'mixed'
    ? buildMixedPayments({ saleId, paymentData })
    : [buildSinglePayment({ saleId, total: totalNumber, paymentData })];
  const paymentSum = payments.reduce((sum, payment) => sum + toNumber(payment.amount, 0), 0);

  return {
    sale: compactObject({
      id: saleId,
      local_sale_id: saleId,
      sold_at: toIsoString(sale.timestamp || sale.soldAt || sale.sold_at, now),
      created_at: toIsoString(sale.createdAt || sale.created_at || sale.timestamp, now),
      status: 'closed',
      fulfillment_status: sale.fulfillmentStatus || sale.fulfillment_status || null,
      payment_method: method,
      payment_status: 'paid',
      customer_id: firstText(paymentData.customerId, sale.customerId, sale.customer_id),
      customer_name: firstText(sale.customerName, sale.customer?.name, sale.customerSnapshot?.name),
      customer_phone: firstText(sale.customerPhone, sale.customer?.phone, sale.customerSnapshot?.phone),
      subtotal: toNumber(sale.subtotal, totalNumber),
      discount_total: toNumber(sale.discountTotal ?? sale.discount_total, 0),
      tax_total: toNumber(sale.taxTotal ?? sale.tax_total, 0),
      total: totalNumber,
      amount_paid: paymentSum,
      change_amount: payments.reduce((sum, payment) => sum + toNumber(payment.change_amount, 0), 0),
      balance_due: 0,
      currency: sale.currency || 'MXN',
      metadata: compactObject({
        phase: inventoryEnabled ? 'fase6c_cloud_sales_inventory' : 'fase6b_cloud_cashier_sales',
        localGeneratedAt: now,
        orderType: sale.orderType || null,
        splitGroupId: sale.splitGroupId || null,
        noCloudInventoryEffects: !inventoryEnabled,
        cloudInventoryEffects: inventoryEnabled,
        noCloudCreditEffects: true
      })
    }),
    items: (Array.isArray(processedItems) ? processedItems : []).map((item, index) => mapItem(item, index, { inventoryEnabled })),
    payments,
    idempotencyKey: inventoryEnabled ? `sales.cloud_commit.inventory:${saleId}` : `sales.cloud_commit:${saleId}`
  };
};

export default {
  normalizeCloudCashierPaymentMethod,
  isCreditLikePaymentMethod,
  isCloudCashierCompatiblePayment,
  mapLocalCheckoutToCloudSale
};
