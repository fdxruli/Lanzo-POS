export const FINANCIAL_TIMEOUTS = Object.freeze({
  STATION_RESOLUTION_MS: 10_000,
  PREFLIGHT_MS: 15_000,
  DISPATCH_MS: 35_000,
  RECEIPT_MS: 10_000,
  AUDIT_DETAIL_MS: 10_000,
  POST_SYNC_MS: 10_000
});

export const getFinancialTimeoutMs = (overrides, key) => {
  const candidate = Number(overrides?.[key]);
  return Number.isFinite(candidate) && candidate > 0
    ? candidate
    : FINANCIAL_TIMEOUTS[key];
};

export const withFinancialTimeout = (
  operation,
  {
    timeoutMs,
    code = 'FINANCIAL_TIMEOUT',
    message = null,
    phase = null,
    ambiguous = false
  } = {}
) => {
  const task = typeof operation === 'function'
    ? Promise.resolve().then(operation)
    : Promise.resolve(operation);
  const duration = Number(timeoutMs);

  if (!Number.isFinite(duration) || duration <= 0) return task;

  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message || code);
      error.name = 'FinancialTimeoutError';
      error.code = code;
      error.financialPhase = phase;
      error.isFinancialTimeout = true;
      error.isFinancialOperationAmbiguous = ambiguous;
      reject(error);
    }, duration);
  });

  return Promise.race([task, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};
