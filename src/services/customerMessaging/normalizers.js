import { Money } from '../../utils/moneyMath';

export const DEFAULT_MESSAGE_TIME_ZONE = 'America/Mexico_City';

const CREDIT_PAYMENT_METHODS = new Set([
  'fiado',
  'credit',
  'mixed_credit',
  'customer_credit',
  // Existing cloud contracts can still return these legacy spellings. They
  // remain diagnostics-only aliases and are never written back to finance.
  'partial_credit',
  'credito',
  'crédito',
  'debt',
  'cuenta_cliente'
]);

const PAYMENT_METHOD_ALIASES = Object.freeze({
  efectivo: 'cash',
  cash: 'cash',
  tarjeta: 'card',
  card: 'card',
  tarjeta_credito: 'card',
  tarjeta_debito: 'card',
  credit_card: 'card',
  debit_card: 'card',
  debit: 'card',
  transferencia: 'transfer',
  transfer: 'transfer',
  spei: 'transfer',
  bank_transfer: 'transfer',
  mixto: 'mixed',
  mixed: 'mixed',
  fiado: 'credit',
  credit: 'credit',
  mixed_credit: 'credit',
  customer_credit: 'credit',
  partial_credit: 'credit',
  credito: 'credit',
  crédito: 'credit',
  debt: 'credit',
  cuenta_cliente: 'credit'
});

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_PATTERN = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;

const valueIsMissing = (value) => value === null
  || value === undefined
  || (typeof value === 'string' && value.trim() === '');

const makeMoneyFailure = (status, code, value) => ({
  ok: false,
  status,
  code,
  input: value
});

/**
 * Normalizes an amount without coercing it through a JavaScript float. The Big
 * instance is intentionally kept private to this helper API so callers do not
 * call Number#toFixed on cloud decimal strings.
 */
export const normalizeMoney = (value) => {
  if (valueIsMissing(value)) {
    return makeMoneyFailure('missing', 'MONEY_VALUE_MISSING', value);
  }

  if (typeof value === 'boolean' || typeof value === 'object') {
    return makeMoneyFailure('invalid', 'MONEY_VALUE_INVALID', value);
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    return makeMoneyFailure('invalid', 'MONEY_VALUE_INVALID', value);
  }

  const raw = String(value).trim();
  if (!MONEY_PATTERN.test(raw)) {
    return makeMoneyFailure('invalid', 'MONEY_VALUE_INVALID', value);
  }

  try {
    const amount = Money.init(raw.replace(/,/g, ''));
    return {
      ok: true,
      status: 'valid',
      amount,
      exact: Money.toExactString(amount),
      decimal: amount.toFixed(2)
    };
  } catch {
    return makeMoneyFailure('invalid', 'MONEY_VALUE_INVALID', value);
  }
};

const groupIntegerPart = (value) => value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Returns a controlled result rather than throwing when cloud values are empty
 * or malformed. The display format is deterministic and does not require a
 * Number conversion.
 */
export const formatMoney = (value, { currency = 'MXN' } = {}) => {
  const normalized = normalizeMoney(value);
  if (!normalized.ok) return normalized;

  const decimal = normalized.decimal;
  const negative = decimal.startsWith('-');
  const unsigned = negative ? decimal.slice(1) : decimal;
  const [whole, fraction] = unsigned.split('.');
  const symbol = currency === 'MXN' ? '$' : `${currency} `;

  return {
    ok: true,
    status: 'valid',
    value: `${negative ? '-' : ''}${symbol}${groupIntegerPart(whole)}.${fraction}`,
    exact: normalized.exact,
    decimal
  };
};

export const formatMoneyValue = (value, options = {}) => {
  const formatted = formatMoney(value, options);
  return formatted.ok ? formatted.value : (options.fallback ?? '—');
};

export const normalizePaymentMethod = (value) => {
  const original = valueIsMissing(value) ? null : String(value).trim();
  const normalized = original ? original.toLowerCase().replace(/[\s-]+/g, '_') : '';
  const canonical = PAYMENT_METHOD_ALIASES[normalized] || (normalized || 'unknown');

  return {
    original,
    normalized,
    canonical,
    isCredit: CREDIT_PAYMENT_METHODS.has(normalized)
  };
};

export const isCreditPaymentMethod = (value) => normalizePaymentMethod(value).isCredit;

const dateParts = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date)
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, value]));

  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
};

/**
 * Date-only layaway fields are preserved as calendar dates. They are never
 * parsed as UTC midnight, which would display the previous date in Mexico.
 */
export const normalizeMessageDate = (value, { timeZone = DEFAULT_MESSAGE_TIME_ZONE } = {}) => {
  if (valueIsMissing(value)) {
    return { ok: false, status: 'missing', code: 'MESSAGE_DATE_MISSING', input: value };
  }

  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim())) {
    return {
      ok: true,
      status: 'valid',
      kind: 'date_only',
      value: value.trim(),
      timeZone
    };
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, status: 'invalid', code: 'MESSAGE_DATE_INVALID', input: value };
  }

  return {
    ok: true,
    status: 'valid',
    kind: 'timestamp',
    value: dateParts(date, timeZone),
    iso: date.toISOString(),
    timeZone
  };
};

export const formatMessageDate = (value, options = {}) => {
  const normalized = normalizeMessageDate(value, options);
  return normalized.ok ? normalized.value : (options.fallback ?? '—');
};

/**
 * Mexican customer phone normalization. It is deliberately pure: persisted
 * customer data is never changed and callers receive a diagnostic instead of
 * an exception.
 */
export const normalizeMexicanPhone = (value) => {
  if (valueIsMissing(value)) {
    return {
      status: 'missing',
      code: 'CUSTOMER_PHONE_MISSING',
      input: value,
      e164: null,
      nationalNumber: null
    };
  }

  const raw = String(value).trim();
  const plusCount = (raw.match(/\+/g) || []).length;
  if (
    /[a-z]/i.test(raw)
    || /[^\d\s+()\-.]/.test(raw)
    || plusCount > 1
    || (plusCount === 1 && !raw.startsWith('+'))
  ) {
    return {
      status: 'invalid',
      code: 'CUSTOMER_PHONE_INVALID',
      input: value,
      e164: null,
      nationalNumber: null
    };
  }

  const digits = raw.replace(/\D/g, '');
  let nationalNumber = null;

  if (digits.length === 10) {
    nationalNumber = digits;
  } else if (digits.length === 12 && digits.startsWith('52')) {
    nationalNumber = digits.slice(2);
  }

  if (!nationalNumber || !/^\d{10}$/.test(nationalNumber)) {
    return {
      status: 'invalid',
      code: 'CUSTOMER_PHONE_INVALID',
      input: value,
      e164: null,
      nationalNumber: null
    };
  }

  return {
    status: 'valid',
    code: null,
    input: value,
    e164: `+52${nationalNumber}`,
    nationalNumber
  };
};

export const isValueMissing = valueIsMissing;
