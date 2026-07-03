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

export const normalizeSelectedModifierForCloudShadow = (modifier = {}) => {
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

  return selectedModifiers.map(normalizeSelectedModifierForCloudShadow);
};

const normalizePaymentMethod = (method) => String(method || 'unknown').trim().toLowerCase() || 'unknown';

const mapItem = (item = {}, index = 0) => {
  const productId = firstText(item.productId, item.parentId, item.id);
  const quantity = toNumber(item.quantity, 0);
  const unitPrice = toNumber(item.price ?? item.unitPrice, 0);
  const unitCost = item.cost === undefined && item.unitCost === undefined
    ? null
    : toNumber(item.cost ?? item.unitCost, 0);
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
    batch_id: firstText(item.batchId, item.batch_id),
    batch_sku: firstText(item.batchSku, item.batch_sku),
    batch_expiry_date: firstText(item.batchExpiryDate, item.expiryDate),
    rubro: firstText(item.rubro, item.categoryName, item.category),
    selected_modifiers: selectedModifiers || undefined,
    metadata: compactObject({
      parentId: item.parentId || null,
      lineId: item.lineId || null,
      cartLineId: item.cartLineId || null,
      selectedModifiers: selectedModifiers || undefined,
      batchesUsed: item.batchesUsed || null,
      stockDeducted: item.stockDeducted ?? null,
      requiresPrescription: item.requiresPrescription || false,
      inventoryReservation: item.inventoryReservation || null,
      snapshotOnly: true
    })
  });
};

const buildSyntheticPayment = (sale = {}) => {
  const method = normalizePaymentMethod(sale.paymentMethod);
  const total = toNumber(sale.total, 0);
  const amountPaid = toNumber(sale.abono ?? sale.amountPaid, method === 'fiado' ? 0 : total);
  const balanceDue = toNumber(sale.saldoPendiente ?? sale.balanceDue, 0);

  return compactObject({
    id: `${sale.id}:payment:main`,
    method,
    amount: method === 'fiado' ? amountPaid : Math.max(amountPaid, total - balanceDue),
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
  method: normalizePaymentMethod(payment.method || payment.paymentMethod || sale.paymentMethod),
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

  const items = (Array.isArray(localSale.items) ? localSale.items : []).map(mapItem);
  const payments = extractPayments(localSale);
  const idempotencyKey = `sales.shadow_upsert:${localSale.id}:${options.deviceId || 'device'}`;

  return {
    sale,
    items,
    payments,
    idempotencyKey
  };
};

export const cloudSaleToLocalSyncPatch = (cloudSale = {}, response = {}) => ({
  cloudSaleId: cloudSale.id || cloudSale.local_sale_id || response.sale?.id || null,
  cloudSalesSyncStatus: 'synced',
  cloudSalesLastSyncAt: new Date().toISOString(),
  cloudSalesSyncError: null,
  cloudServerVersion: Number(cloudSale.server_version || response.server_version || 0) || null,
  sourceMode: cloudSale.source_mode || 'shadow',
  effectsStatus: cloudSale.effects_status || 'local_applied',
  paymentMethod: cloudSale.payment_method || undefined,
  paymentStatus: cloudSale.payment_status || undefined,
  folio: cloudSale.cloud_folio || cloudSale.folio || undefined,
  cloudFolio: cloudSale.cloud_folio || undefined,
  abono: cloudSale.amount_paid === undefined ? undefined : String(cloudSale.amount_paid),
  saldoPendiente: cloudSale.balance_due === undefined ? undefined : String(cloudSale.balance_due),
  cashSessionId: cloudSale.cash_session_id || response.cash_session?.id || undefined,
  cashMovementId: cloudSale.cash_movement_id || response.cash_movement?.id || undefined,
  cashEffectStatus: cloudSale.cash_effect_status || undefined,
  inventoryEffectStatus: cloudSale.inventory_effect_status || undefined,
  creditEffectStatus: cloudSale.credit_effect_status || undefined,
  customerLedgerId: cloudSale.customer_ledger_id || response.ledger_charge?.id || undefined,
  creditLedgerChargeId: cloudSale.credit_ledger_charge_id || response.ledger_charge?.id || undefined,
  creditLedgerPaymentId: cloudSale.credit_ledger_payment_id || response.ledger_payment?.id || undefined,
  creditCustomerDebtBefore: cloudSale.credit_customer_debt_before ?? undefined,
  creditCustomerDebtAfter: cloudSale.credit_customer_debt_after ?? undefined
});

export default {
  localSaleToCloudShadowPayload,
  cloudSaleToLocalSyncPatch,
  normalizeSelectedModifierForCloudShadow
};
