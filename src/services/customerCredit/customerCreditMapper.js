export const CUSTOMER_CREDIT_SYNC_STATUS = Object.freeze({
  LOCAL: 'local',
  SYNCED: 'synced',
  PENDING: 'pending',
  CONFLICT: 'conflict',
  READONLY_CACHE: 'readonly_cache'
});

const nowIso = () => new Date().toISOString();

const pick = (source, snakeKey, camelKey, fallback = null) => {
  if (!source) return fallback;
  if (source[camelKey] !== undefined) return source[camelKey];
  if (source[snakeKey] !== undefined) return source[snakeKey];
  return fallback;
};

const asStringAmount = (value, fallback = '0') => {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const cloudLedgerToLocal = (ledger = {}, existing = null) => {
  if (!ledger?.id) return null;

  const syncedAt = nowIso();
  const createdAt = pick(ledger, 'created_at', 'createdAt', syncedAt);

  return {
    ...(existing || {}),
    id: ledger.id,
    customerId: pick(ledger, 'customer_id', 'customerId'),
    type: ledger.type,
    amount: asStringAmount(ledger.amount),
    balanceAfter: asStringAmount(pick(ledger, 'balance_after', 'balanceAfter', 0)),
    debtCentsAfter: toNumber(pick(ledger, 'debt_cents_after', 'debtCentsAfter', 0)),
    paymentMethod: pick(ledger, 'payment_method', 'paymentMethod'),
    note: ledger.note || '',
    timestamp: createdAt,
    cashSessionId: pick(ledger, 'cash_session_id', 'cashSessionId'),
    cashMovementId: pick(ledger, 'cash_movement_id', 'cashMovementId'),
    referenceType: pick(ledger, 'reference_type', 'referenceType'),
    referenceId: pick(ledger, 'reference_id', 'referenceId'),
    saleId: pick(ledger, 'sale_id', 'saleId'),
    allocationPayload: pick(ledger, 'allocation_payload', 'allocationPayload', []),
    actorName: pick(ledger, 'actor_name', 'actorName'),
    staffUserId: pick(ledger, 'actor_staff_user_id', 'staffUserId'),
    deviceId: pick(ledger, 'actor_device_id', 'deviceId'),
    idempotencyKey: pick(ledger, 'idempotency_key', 'idempotencyKey'),
    syncStatus: CUSTOMER_CREDIT_SYNC_STATUS.SYNCED,
    serverVersion: toNumber(pick(ledger, 'server_version', 'serverVersion', existing?.serverVersion), 1),
    cloudUpdatedAt: createdAt,
    lastSyncedAt: syncedAt,
    metadata: ledger.metadata || {},
    deletedAt: pick(ledger, 'deleted_at', 'deletedAt')
  };
};

export const localAllocationsToCloud = (allocations = []) => {
  if (!Array.isArray(allocations)) return [];

  return allocations.reduce((result, allocation) => {
    const mapped = {
      sale_id: allocation.saleId || allocation.sale_id,
      amount_applied: asStringAmount(allocation.amountApplied ?? allocation.amount_applied ?? 0),
      previous_sale_balance: allocation.previousSaleBalance ?? allocation.previous_sale_balance ?? null,
      new_sale_balance: allocation.newSaleBalance ?? allocation.new_sale_balance ?? null,
      metadata: allocation.metadata || {}
    };

    if (mapped.sale_id && Number(mapped.amount_applied) > 0) {
      result.push(mapped);
    }

    return result;
  }, []);
};

export const receiptPayloadToLocal = (receipt = {}) => ({
  customerId: pick(receipt, 'customer_id', 'customerId'),
  customerName: pick(receipt, 'customer_name', 'customerName'),
  amount: asStringAmount(receipt.amount),
  previousDebt: asStringAmount(pick(receipt, 'previous_debt', 'previousDebt')),
  newDebt: asStringAmount(pick(receipt, 'new_debt', 'newDebt')),
  paymentMethod: pick(receipt, 'payment_method', 'paymentMethod'),
  cashSessionId: pick(receipt, 'cash_session_id', 'cashSessionId'),
  ledgerId: pick(receipt, 'ledger_id', 'ledgerId'),
  createdAt: pick(receipt, 'created_at', 'createdAt'),
  actorName: pick(receipt, 'actor_name', 'actorName')
});
