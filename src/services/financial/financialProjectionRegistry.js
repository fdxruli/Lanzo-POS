const handlers = new Map();

export const FINANCIAL_RECOVERY_OPERATIONS = Object.freeze([
  'cash.open', 'cash.movement', 'cash.adjust_initial_fund', 'cash.close', 'cash.admin_close',
  'sale.cashier', 'sale.cashier_inventory', 'sale.credit', 'sale.cancel'
]);

// Registration is deliberately side-effect safe: it stores a function only.
// Runtime/Dexie access belongs inside a handler invocation after actor grant.
export const registerFinancialProjectionHandler = (operationType, handler) => {
  if (!FINANCIAL_RECOVERY_OPERATIONS.includes(operationType) || typeof handler !== 'function') {
    throw new Error('FINANCIAL_PROJECTION_HANDLER_INVALID');
  }
  handlers.set(operationType, handler);
  return () => handlers.get(operationType) === handler && handlers.delete(operationType);
};

export const getFinancialProjectionHandler = (operationType) => handlers.get(operationType) || null;

export const applyFinancialProjection = async ({ intent, actorHandle } = {}) => {
  const handler = getFinancialProjectionHandler(intent?.operationType);
  if (!handler) throw new Error('FINANCIAL_RECOVERY_PROJECTION_HANDLER_UNAVAILABLE');
  actorHandle?.assertCurrent?.();
  const result = await handler({
    operationType: intent.operationType,
    requestPayload: intent.requestPayload,
    responsePayload: intent.responsePayload,
    intent,
    actorHandle
  });
  actorHandle?.assertCurrent?.();
  return result;
};

export const financialProjectionRegistryInternals = Object.freeze({ handlers });
