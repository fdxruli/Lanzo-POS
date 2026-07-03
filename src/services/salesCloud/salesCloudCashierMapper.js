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
  Object.entries(value).filter(([, entry]) => entry !== undefined)
);

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return null;
};

const getLineTotal = (item = {}) => {
  if (item.exactTotal !== undefined) return toNumber(item.exactTotal, 0);
  if (item.lineTotal !== undefined) return toNumber(item.lineTotal, 0);
  if (item.total !== undefined) return toNumber(item.total, 0);
  return toNumber(item.price, 0) * toNumber(item.quantity, 0);
};

const hasManualBatchSelection = (item = {}) => Boolean(
  item.manualBatchSelection === true ||
  item.batchSelectionSource === 'manual' ||
  item.stockSource === 'manual_batch' ||
  item.metadata?.manualBatchSelection === true ||
  item.metadata?.batchSelectionSource === 'manual'
);

const getExplicitBatchesUsed = (item = {}, allowLocalBatches = true) => {
  const batchesUsed = item.batchesUsed || item.batches_used || item.metadata?.batchesUsed || item.metadata?.batches_used;
  if (!Array.isArray(batchesUsed) || batchesUsed.length === 0) return null;
  if (allowLocalBatches || hasManualBatchSelection(item)) return batchesUsed;
  return null;
};

export const normalizeSelectedModifierForCloud = (modifier = {}) => {
  const id = firstText(
    modifier.id,
    modifier.modifierId,
    modifier.modifier_id,
    modifier.optionId,
    modifier.option_id
  );
  const optionId = firstText(modifier.optionId, modifier.option_id, id);
  const ingredientId = firstText(modifier.ingredientId, modifier.ingredient_id);
  const hasIngredientQuantity = modifier.ingredientQuantity !== undefined || modifier.ingredient_quantity !== undefined;
  const hasLegacyQuantity = modifier.quantity !== undefined;

  return compactObject({
    id,
    optionId,
    option_id: optionId,
    name: firstText(modifier.name, modifier.label, modifier.optionName, modifier.option_name),
    price: modifier.price === undefined ? undefined : toNumber(modifier.price, 0),
    ingredientId,
    ingredient_id: ingredientId,
    ingredientQuantity: hasIngredientQuantity
      ? toNumber(modifier.ingredientQuantity ?? modifier.ingredient_quantity, null)
      : undefined,
    ingredient_quantity: hasIngredientQuantity
      ? toNumber(modifier.ingredientQuantity ?? modifier.ingredient_quantity, null)
      : undefined,
    ingredientUnit: firstText(modifier.ingredientUnit, modifier.ingredient_unit, modifier.unit),
    ingredient_unit: firstText(modifier.ingredientUnit, modifier.ingredient_unit, modifier.unit),
    tracksInventory: modifier.tracksInventory ?? modifier.tracks_inventory,
    tracks_inventory: modifier.tracksInventory ?? modifier.tracks_inventory,
    quantity: hasLegacyQuantity ? toNumber(modifier.quantity, null) : undefined
  });
};

const getSelectedModifiers = (item = {}) => {
  const selectedModifiers = item.selectedModifiers ||
    item.selected_modifiers ||
    item.modifiersSelected ||
    item.metadata?.selectedModifiers ||
    item.metadata?.selected_modifiers;

  if (!Array.isArray(selectedModifiers) || selectedModifiers.length === 0) {
    return null;
  }

  return selectedModifiers.map(normalizeSelectedModifierForCloud);
};

export const normalizeCloudCashierPaymentMethod = (method) => {
  const raw = String(method || '').trim().toLowerCase();
  if (['cash', 'efectivo'].includes(raw)) return 'cash';
  if (['card', 'tarjeta', 'tarjeta_credito', 'tarjeta_debito', 'debit', 'credit_card', 'debit_card'].includes(raw)) return 'card';
  if (['transfer', 'transferencia', 'spei', 'bank_transfer'].includes(raw)) return 'transfer';
  if (['mixed', 'mixto'].includes(raw)) return 'mixed';
  if ([
    'fiado',
    'credit',
    'credito',
    'crédito',
    'debt',
    'customer_credit',
    'cuenta_cliente',
    'mixed_credit',
    'partial_credit'
  ].includes(raw)) return 'credit';
  return raw || 'unknown';
};

export const isCreditLikePaymentMethod = (method) => normalizeCloudCashierPaymentMethod(method) === 'credit';

export const isCloudCashierCompatiblePayment = (paymentData = {}) => {
  const method = normalizeCloudCashierPaymentMethod(paymentData.paymentMethod || paymentData.method);
  if (method === 'credit') return false;
  if (method === 'mixed') {
    const payments = paymentData.payments || paymentData.paymentBreakdown || paymentData.paymentDetails?.payments;
    return Array.isArray(payments) && payments.length > 0 && payments.every((payment) => {
      const paymentMethod = normalizeCloudCashierPaymentMethod(payment.method || payment.paymentMethod);
      return ['cash', 'card', 'transfer'].includes(paymentMethod) && toNumber(payment.amount ?? payment.total, 0) > 0;
    });
  }
  return ['cash', 'card', 'transfer'].includes(method);
};

const mapItem = (item = {}, index = 0, options = {}) => {
  const productId = firstText(item.productId, item.parentId, item.id);
  const quantity = toNumber(item.quantity, 0);
  const unitPrice = toNumber(item.price ?? item.unitPrice, 0);
  const unitCost = item.cost === undefined && item.unitCost === undefined
    ? null
    : toNumber(item.cost ?? item.unitCost, 0);
  const allowLocalBatches = options.allowLocalBatches !== false;
  const explicitBatchesUsed = getExplicitBatchesUsed(item, allowLocalBatches);
  const explicitBatchId = hasManualBatchSelection(item)
    ? firstText(item.batchId, item.batch_id)
    : (allowLocalBatches ? firstText(item.batchId, item.batch_id) : null);
  const selectedModifiers = getSelectedModifiers(item);

  return compactObject({
    id: firstText(item.lineId, item.cartLineId) || (productId ? `${productId}:${index + 1}` : null),
    product_id: productId,
    product_name: firstText(item.name, item.productName) || 'Producto',
    product_sku: firstText(item.sku, item.productSku),
    barcode: firstText(item.barcode),
    category_id: firstText(item.categoryId, item.category_id),
    category_name: firstText(item.categoryName, item.category, item.rubro),
    quantity,
    unit_price: unitPrice,
    unit_cost: unitCost,
    discount_amount: toNumber(item.discountAmount ?? item.discount, 0),
    tax_amount: toNumber(item.taxAmount ?? item.tax, 0),
    line_total: getLineTotal(item),
    batch_id: explicitBatchId,
    batch_sku: explicitBatchId ? firstText(item.batchSku, item.batch_sku) : undefined,
    batch_expiry_date: explicitBatchId ? firstText(item.batchExpiryDate, item.expiryDate) : undefined,
    rubro: firstText(item.rubro, item.categoryName, item.category),
    selected_modifiers: selectedModifiers || undefined,
    metadata: compactObject({
      parentId: item.parentId || null,
      lineId: item.lineId || null,
      cartLineId: item.cartLineId || null,
      selectedModifiers: selectedModifiers || undefined,
      batchesUsed: explicitBatchesUsed,
      stockDeducted: item.stockDeducted ?? null,
      requiresPrescription: item.requiresPrescription || false,
      inventoryReservation: allowLocalBatches ? item.inventoryReservation || null : null,
      batchSelectionSource: hasManualBatchSelection(item) ? 'manual' : undefined,
      snapshotOnly: true
    })
  });
};

const buildSyntheticPayment = (sale = {}) => {
  const method = normalizeCloudCashierPaymentMethod(sale.paymentMethod);
  const total = toNumber(sale.total, 0);
  const amountPaid = toNumber(sale.abono ?? sale.amountPaid, method === 'credit' ? 0 : total);
  const balanceDue = toNumber(sale.saldoPendiente ?? sale.balanceDue, 0);

  return compactObject({
    id: `${sale.id}:payment:main`,
    method,
    amount: method === 'credit' ? amountPaid : Math.max(amountPaid, total - balanceDue),
    received_amount: toNumber(sale.receivedAmount, amountPaid || null),
    change_amount: toNumber(sale.changeAmount, 0),
    reference: firstText(sale.paymentReference, sale.reference),
    cash_session_id: firstText(sale.cash_session_id, sale.cashSessionId),
    cash_movement_id: firstText(sale.cash_movement_id, sale.cashMovementId),
    customer_ledger_id: firstText(sale.customer_ledger_id, sale.customerLedgerId),
    metadata: compactObject({
      source: 'synthetic_from_local_sale',
      snapshotOnly: true
    })
  });
};

const mapPayment = (payment = {}, sale = {}, index = 0) => compactObject({
  id: firstText(payment.id) || `${sale.id}:payment:${index + 1}`,
  method: normalizeCloudCashierPaymentMethod(payment.method || payment.paymentMethod || sale.paymentMethod),
  amount: toNumber(payment.amount ?? payment.total, 0),
  received_amount: payment.receivedAmount === undefined && payment.received_amount === undefined
    ? null
    : toNumber(payment.receivedAmount ?? payment.received_amount, 0),
  change_amount: payment.changeAmount === undefined && payment.change_amount === undefined
    ? null
    : toNumber(payment.changeAmount ?? payment.change_amount, 0),
  reference: firstText(payment.reference, payment.ref),
  cash_session_id: firstText(payment.cash_session_id, payment.cashSessionId, sale.cash_session_id, sale.cashSessionId),
  cash_movement_id: firstText(payment.cash_movement_id, payment.cashMovementId),
  customer_ledger_id: firstText(payment.customer_ledger_id, payment.customerLedgerId),
  metadata: compactObject({
    ...(payment.metadata || {}),
    snapshotOnly: true
  })
});

const extractPayments = (sale = {}) => {
  const explicitPayments = sale.payments || sale.paymentBreakdown || sale.paymentDetails?.payments;
  if (Array.isArray(explicitPayments) && explicitPayments.length > 0) {
    return explicitPayments.map((payment, index) => mapPayment(payment, sale, index));
  }

  return [buildSyntheticPayment(sale)].filter((payment) => toNumber(payment.amount, 0) >= 0);
};

const extractInitialCreditPayments = ({ sale = {}, paymentData = {}, amountPaid = 0 } = {}) => {
  if (amountPaid <= 0) return [];

  const explicitPayments = paymentData.payments || paymentData.paymentBreakdown || paymentData.paymentDetails?.payments;
  if (Array.isArray(explicitPayments) && explicitPayments.length > 0) {
    return explicitPayments
      .map((payment, index) => mapPayment(payment, sale, index))
      .filter((payment) => ['cash', 'card', 'transfer'].includes(payment.method) && toNumber(payment.amount, 0) > 0);
  }

  const method = normalizeCloudCashierPaymentMethod(
    paymentData.initialPaymentMethod ||
    paymentData.abonoPaymentMethod ||
    paymentData.creditPaymentMethod ||
    paymentData.partialPaymentMethod ||
    'cash'
  );

  if (!['cash', 'card', 'transfer'].includes(method)) return [];

  return [compactObject({
    id: `${sale.id}:payment:initial`,
    method,
    amount: amountPaid,
    received_amount: method === 'cash' ? toNumber(paymentData.receivedAmount, amountPaid) : amountPaid,
    change_amount: method === 'cash' ? toNumber(paymentData.changeAmount, 0) : 0,
    reference: firstText(paymentData.paymentReference, paymentData.reference),
    cash_session_id: firstText(paymentData.cashSessionId, paymentData.cash_session_id),
    metadata: compactObject({
      source: 'initial_credit_payment_from_checkout',
      phase: 'fase6d_cloud_sales_credit_ledger'
    })
  })];
};

export const localSaleToCloudShadowPayload = (localSale = {}, options = {}) => {
  const now = new Date().toISOString();
  const soldAt = toIsoString(localSale.timestamp || localSale.soldAt || localSale.sold_at, now);
  const total = toNumber(localSale.total, 0);
  const amountPaid = toNumber(localSale.abono ?? localSale.amountPaid, localSale.paymentMethod === 'fiado' ? 0 : total);
  const balanceDue = toNumber(localSale.saldoPendiente ?? localSale.balanceDue, 0);

  const sale = compactObject({
    id: localSale.id,
    local_sale_id: localSale.id,
    folio: firstText(localSale.folio),
    local_folio: firstText(localSale.folio),
    timestamp: soldAt,
    sold_at: soldAt,
    status: localSale.status || 'closed',
    fulfillment_status: localSale.fulfillmentStatus || localSale.fulfillment_status || null,
    payment_method: localSale.paymentMethod || localSale.payment_method || null,
    payment_status: balanceDue > 0 ? 'partial' : 'paid',
    customer_id: firstText(localSale.customerId, localSale.customer_id),
    customer_name: firstText(localSale.customerName, localSale.customer?.name, localSale.customerSnapshot?.name),
    customer_phone: firstText(localSale.customerPhone, localSale.customer?.phone, localSale.customerSnapshot?.phone),
    subtotal: toNumber(localSale.subtotal, total),
    discount_total: toNumber(localSale.discountTotal ?? localSale.discount_total, 0),
    tax_total: toNumber(localSale.taxTotal ?? localSale.tax_total, 0),
    total,
    amount_paid: amountPaid,
    change_amount: toNumber(localSale.changeAmount ?? localSale.change_amount, 0),
    balance_due: balanceDue,
    currency: localSale.currency || 'MXN',
    cash_session_id: firstText(localSale.cash_session_id, localSale.cashSessionId),
    cash_movement_id: firstText(localSale.cash_movement_id, localSale.cashMovementId),
    customer_ledger_id: firstText(localSale.customer_ledger_id, localSale.customerLedgerId),
    metadata: compactObject({
      origin: 'local_device',
      sourceMode: 'shadow',
      effectsStatus: 'local_applied',
      orderType: localSale.orderType || null,
      splitGroupId: localSale.splitGroupId || null,
      splitParentId: localSale.splitParentId || null,
      splitChildIds: localSale.splitChildIds || null,
      prescriptionDetails: localSale.prescriptionDetails || null,
      dueDate: localSale.dueDate || null,
      postEffectsCompleted: localSale.postEffectsCompleted ?? null,
      postEffectsFailed: options.postEffectsFailed || false,
      syncedFrom: 'salesCloudShadowService',
      snapshotOnly: true
    })
  });

  const items = (Array.isArray(localSale.items) ? localSale.items : []).map((item, index) => mapItem(item, index));
  const payments = extractPayments(localSale);
  const idempotencyKey = `sales.shadow_upsert:${localSale.id}:${options.deviceId || 'device'}`;

  return {
    sale,
    items,
    payments,
    idempotencyKey
  };
};

export const mapLocalCheckoutToCloudSale = ({ sale = {}, processedItems = [], paymentData = {}, total, inventoryEnabled = false } = {}) => {
  const now = new Date().toISOString();
  const soldAt = toIsoString(sale.timestamp || sale.soldAt || sale.sold_at, now);
  const saleTotal = toNumber(total ?? sale.total, 0);
  const paymentMethod = normalizeCloudCashierPaymentMethod(paymentData.paymentMethod || sale.paymentMethod || 'cash');
  const amountPaid = paymentMethod === 'cash'
    ? toNumber(paymentData.amountPaid ?? sale.abono ?? sale.amountPaid, saleTotal)
    : saleTotal;

  const cloudSale = compactObject({
    id: sale.id,
    local_sale_id: sale.id,
    local_folio: firstText(sale.folio),
    timestamp: soldAt,
    sold_at: soldAt,
    status: sale.status || 'closed',
    fulfillment_status: sale.fulfillmentStatus || sale.fulfillment_status || null,
    payment_method: paymentMethod,
    payment_status: 'paid',
    customer_id: firstText(sale.customerId, paymentData.customerId, sale.customer_id),
    customer_name: firstText(sale.customerName, sale.customer?.name, sale.customerSnapshot?.name),
    customer_phone: firstText(sale.customerPhone, sale.customer?.phone, sale.customerSnapshot?.phone),
    subtotal: toNumber(sale.subtotal, saleTotal),
    discount_total: toNumber(sale.discountTotal ?? sale.discount_total, 0),
    tax_total: toNumber(sale.taxTotal ?? sale.tax_total, 0),
    total: saleTotal,
    amount_paid: saleTotal,
    change_amount: toNumber(paymentData.changeAmount ?? sale.changeAmount ?? sale.change_amount, paymentMethod === 'cash' ? Math.max(amountPaid - saleTotal, 0) : 0),
    balance_due: 0,
    currency: sale.currency || 'MXN',
    cash_session_id: firstText(paymentData.cashSessionId, paymentData.cash_session_id, sale.cashSessionId, sale.cash_session_id),
    metadata: compactObject({
      origin: 'cloud_checkout',
      sourceMode: 'cloud_committed',
      phase: inventoryEnabled ? 'rest_inv_5_cloud_restaurant_inventory' : 'fase6b_cloud_cashier_sales',
      cloudInventoryEffects: Boolean(inventoryEnabled),
      noCloudCreditEffects: true,
      orderType: sale.orderType || null,
      prescriptionDetails: sale.prescriptionDetails || null,
      syncedFrom: 'salesCloudCashierService'
    })
  });

  const itemMapOptions = { allowLocalBatches: !inventoryEnabled };
  const items = (Array.isArray(processedItems) ? processedItems : []).map((item, index) => mapItem(item, index, itemMapOptions));
  const payments = extractPayments({
    ...sale,
    ...paymentData,
    id: sale.id,
    paymentMethod,
    total: saleTotal,
    amountPaid: saleTotal,
    abono: saleTotal,
    saldoPendiente: 0
  }).filter((payment) => ['cash', 'card', 'transfer'].includes(payment.method) && toNumber(payment.amount, 0) > 0);

  return {
    sale: cloudSale,
    items,
    payments,
    idempotencyKey: inventoryEnabled ? `sales.cloud_commit.inventory:${sale.id}` : `sales.cloud_commit:${sale.id}`
  };
};

export const mapLocalCreditCheckoutToCloudSale = ({ sale = {}, processedItems = [], paymentData = {}, total, inventoryEnabled = false } = {}) => {
  const now = new Date().toISOString();
  const soldAt = toIsoString(sale.timestamp || sale.soldAt || sale.sold_at, now);
  const saleTotal = toNumber(total ?? sale.total, 0);
  const amountPaid = Math.max(toNumber(paymentData.amountPaid ?? sale.abono ?? sale.amountPaid, 0), 0);
  const balanceDue = Math.max(toNumber(paymentData.saldoPendiente ?? sale.saldoPendiente ?? sale.balanceDue, saleTotal - amountPaid), 0);
  const customerId = firstText(paymentData.customerId, sale.customerId, sale.customer_id);

  const cloudSale = compactObject({
    id: sale.id,
    local_sale_id: sale.id,
    local_folio: firstText(sale.folio),
    timestamp: soldAt,
    sold_at: soldAt,
    status: sale.status || 'closed',
    fulfillment_status: sale.fulfillmentStatus || sale.fulfillment_status || null,
    payment_method: amountPaid > 0 ? 'mixed_credit' : 'credit',
    payment_status: amountPaid > 0 ? 'partial' : 'credit_pending',
    customer_id: customerId,
    customer_name: firstText(sale.customerName, sale.customer?.name, sale.customerSnapshot?.name),
    customer_phone: firstText(sale.customerPhone, sale.customer?.phone, sale.customerSnapshot?.phone),
    subtotal: toNumber(sale.subtotal, saleTotal),
    discount_total: toNumber(sale.discountTotal ?? sale.discount_total, 0),
    tax_total: toNumber(sale.taxTotal ?? sale.tax_total, 0),
    total: saleTotal,
    amount_paid: amountPaid,
    change_amount: toNumber(paymentData.changeAmount ?? sale.changeAmount ?? sale.change_amount, 0),
    balance_due: balanceDue,
    currency: sale.currency || 'MXN',
    cash_session_id: firstText(paymentData.cashSessionId, paymentData.cash_session_id, sale.cashSessionId, sale.cash_session_id),
    metadata: compactObject({
      origin: 'cloud_credit_checkout',
      sourceMode: 'cloud_committed',
      phase: 'fase6d_cloud_sales_credit_ledger',
      cloudCreditEffects: true,
      cloudInventoryEffects: Boolean(inventoryEnabled),
      noCloudCreditEffects: false,
      orderType: sale.orderType || null,
      prescriptionDetails: sale.prescriptionDetails || null,
      dueDate: paymentData.dueDate || sale.dueDate || null,
      syncedFrom: 'salesCloudCashierService'
    })
  });

  const itemMapOptions = { allowLocalBatches: !inventoryEnabled };
  const items = (Array.isArray(processedItems) ? processedItems : []).map((item, index) => mapItem(item, index, itemMapOptions));
  const payments = extractInitialCreditPayments({ sale, paymentData, amountPaid });

  return {
    sale: cloudSale,
    items,
    payments,
    customerId,
    idempotencyKey: `sales.cloud_credit:${sale.id}`
  };
};

export default {
  isCloudCashierCompatiblePayment,
  isCreditLikePaymentMethod,
  localSaleToCloudShadowPayload,
  mapLocalCheckoutToCloudSale,
  mapLocalCreditCheckoutToCloudSale,
  normalizeCloudCashierPaymentMethod,
  normalizeSelectedModifierForCloud
};
