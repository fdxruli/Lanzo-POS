export const CASH_NETWORK_UNAVAILABLE_CODE = 'CASH_NETWORK_UNAVAILABLE';
export const CASH_STALE_RESPONSE_CODE = 'CLOUD_REQUEST_RESPONSE_STALE';

export const CASH_NETWORK_UNAVAILABLE_MESSAGE = 'Sin conexión con Supabase. La Caja permanece en solo consulta hasta verificar nuevamente la estación.';

const RETRYABLE_HTTP_STATUS_CODES = new Set([408, 429]);

const getStatusCode = (error) => {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.response?.statusCode,
    error?.context?.status
  ];

  for (const value of candidates) {
    const status = Number(value);
    if (Number.isInteger(status)) return status;
  }

  return null;
};

const getErrorText = (error) => {
  const values = [
    error?.message,
    error?.code,
    error?.name,
    error?.details,
    error?.hint,
    error?.response?.message,
    error?.response?.code
  ].filter((value) => value !== null && value !== undefined);

  return values.map((value) => {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }).join(' ').toLowerCase();
};

const getErrorChain = (error) => {
  const chain = [];
  const visited = new Set();
  let current = error;

  while (current && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = current.cause || current.originalError || current.error || null;
  }

  return chain;
};

const getRequestMetadata = (error) => error?.cloudRequestMeta
  || error?.cause?.cloudRequestMeta
  || null;

const isRetryableHttpStatus = (status) => Boolean(
  status && (RETRYABLE_HTTP_STATUS_CODES.has(status) || (status >= 500 && status <= 599))
);

/**
 * Network failures are transport failures, not financial or station errors.
 * The classifier deliberately accepts only known browser/HTTP transient
 * signals so authorization, actor and station validation failures remain
 * visible to their existing guardrails.
 */
export const isCashNetworkUnavailableError = (error) => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;

  return getErrorChain(error).some((candidate) => {
    if (candidate?.code === CASH_STALE_RESPONSE_CODE
      || candidate?.origin === 'stale/discarded'
      || String(candidate?.reason || '').includes('connection_lost')
      || String(candidate?.reason || '').includes('browser_offline')) {
      return true;
    }

    const status = getStatusCode(candidate);
    if (isRetryableHttpStatus(status)) return true;
    if (candidate?.name === 'TypeError') return true;

    const text = getErrorText(candidate);
    return (
      text.includes('err_connection_closed')
      || text.includes('failed to fetch')
      || text.includes('networkerror')
      || text.includes('network request failed')
      || text.includes('fetch failed')
      || text.includes('load failed')
      || text.includes('connection closed')
      || text.includes('connection reset')
      || text.includes('temporarily unavailable')
      || text.includes('cloud_request_backoff_active')
      || text.includes('cash_network_unavailable')
    );
  });
};

export const normalizeCashNetworkError = (error, { rpcName = null } = {}) => {
  const normalized = new Error(CASH_NETWORK_UNAVAILABLE_MESSAGE);
  normalized.name = 'CashNetworkUnavailableError';
  normalized.code = CASH_NETWORK_UNAVAILABLE_CODE;
  normalized.status = getStatusCode(error);
  normalized.rpcName = rpcName;
  normalized.cause = error;
  const requestMetadata = getRequestMetadata(error);
  normalized.generation = requestMetadata?.generation ?? error?.generation ?? null;
  if (requestMetadata) {
    normalized.requestId = requestMetadata.requestId || error?.requestId || null;
    normalized.connectionGeneration = requestMetadata.connectionGeneration || null;
    normalized.startedOnline = requestMetadata.startedOnline ?? null;
    normalized.responseOrigin = requestMetadata.origin || error?.origin || null;
    normalized.responseReason = requestMetadata.reason || error?.reason || null;
    normalized.cloudRequestMeta = requestMetadata;
  }
  return normalized;
};

export default Object.freeze({
  CASH_NETWORK_UNAVAILABLE_CODE,
  CASH_NETWORK_UNAVAILABLE_MESSAGE,
  CASH_STALE_RESPONSE_CODE,
  isCashNetworkUnavailableError,
  normalizeCashNetworkError
});
