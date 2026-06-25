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

const mapItem = (item = {}, index = 0) => {
  const productId = firstText(item.productId, item.product_id, item.parentId, item.id);
  const quantity = toNumber(item.quantity, 0);
  const unitPrice = toNumber(item.price ?? item.unitPrice ?? item.unit_price, 0);
  const unitCost = item.cost === undefined && item.unitCost === undefined && item.unit_cost === undefined
    ? null
    : toNumber(item.cost ?? item.unitCost ?? item.unit_cost, 0);

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
    batch_id: firstText(item.batchId, item.batch_id),
    batch_sku: firstText(item.batchSku, item.batch_sku),
    batch_expiry_date: firstText(item.batchExpiryDate, item.batch_expiry_date, item.expiryDate),
    rubro: firstText(item.rubro, item.categoryName, item.category),
    metadata: compactObject({
      parentId: item.parentId || null,
      lineId: item.lineId || null,
      cartLineId: item.cartLineId || null,
      batchesUsed: item.batchesUsed || null,
      inventoryEffectStatus: 'not_applied',
      creditEffectStatus: 'not_applied',
      snapshotOnly: true
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

export const mapLocalCheckoutToCloudSale = ({ sale = {}, processedItems = [], paymentData = {}, total = null } = {}) => {
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
        phase: 'fase6b_cloud_cashier_sales',
        localGeneratedAt: now,
        orderType: sale.orderType || null,
        splitGroupId: sale.splitGroupId || null,
        noCloudInventoryEffects: true,
        noCloudCreditEffects: true
      })
    }),
    items: (Array.isArray(processedItems) ? processedItems : []).map(mapItem),
    payments,
    idempotencyKey: `sales.cloud_commit:${saleId}`
  };
};

export default {
  normalizeCloudCashierPaymentMethod,
  isCreditLikePaymentMethod,
  isCloudCashierCompatiblePayment,
  mapLocalCheckoutToCloudSale
};
