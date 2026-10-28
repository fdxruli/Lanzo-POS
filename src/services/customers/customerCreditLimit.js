import { Money } from '../../utils/moneyMath';
import { parseMoneyInputDraft } from '../../utils/moneyInputDraft';

const INVALID_AMOUNT = 'Escribe un importe válido con hasta dos decimales.';
const NEGATIVE_AMOUNT = 'El límite de crédito no puede ser negativo.';

const invalid = (error = INVALID_AMOUNT) => ({ valid: false, value: null, cents: null, error });

const toMoneyDraft = (value, { allowEmpty = false, stepCents = 0, minimumCents = 0, requirePositive = false } = {}) => {
  if (value === null || value === undefined) {
    return invalid('Escribe un límite de crédito.');
  }

  if (typeof value === 'string' && value === '') {
    if (allowEmpty) return { valid: true, value: 0, cents: 0, error: '' };
    return invalid('Escribe un límite de crédito.');
  }

  const raw = typeof value === 'string' ? value.trim() : String(value);
  if (!raw) return invalid();
  if (raw.startsWith('-')) return invalid(NEGATIVE_AMOUNT);

  const parsed = parseMoneyInputDraft(raw);
  if (parsed.status !== 'valid' || !Number.isSafeInteger(parsed.cents) || parsed.cents < 0) {
    return invalid();
  }

  if (requirePositive && parsed.cents === 0) {
    return invalid('El límite de crédito debe ser mayor a $0.00.');
  }
  if (minimumCents > 0 && parsed.cents < minimumCents) {
    return invalid(`El límite de crédito debe cubrir el saldo pendiente de $${Money.fromCents(minimumCents).toFixed(2)}.`);
  }
  if (stepCents > 0 && parsed.cents % stepCents !== 0) {
    return invalid('El límite de Clientes debe ser $0 o un múltiplo de $50.');
  }

  const amount = Money.fromCents(parsed.cents);
  const valueAsNumber = Number(amount.toString());
  try {
    if (!Number.isFinite(valueAsNumber) || Money.toCents(valueAsNumber) !== parsed.cents) return invalid();
  } catch {
    return invalid();
  }

  return { valid: true, value: valueAsNumber, cents: parsed.cents, error: '' };
};

const parseMinimumCents = (minimum) => {
  const parsed = parseMoneyInputDraft(String(minimum ?? 0));
  if (parsed.status !== 'valid' || !Number.isSafeInteger(parsed.cents) || parsed.cents < 0) return null;
  return parsed.cents;
};

// The original Clientes number input used min="0" and step="50". With noValidate,
// this keeps that same rule explicitly. An empty field retains its former meaning: $0.
export const validateDirectoryCreditLimit = (value) => toMoneyDraft(value, {
  allowEmpty: true,
  stepCents: 5000
});

// Fiado has its own existing rule: a positive, cent-precise limit that covers the pending balance.
export const validateQuickAddCreditLimit = (value, minimumCreditLimit = 0) => {
  const minimumCents = parseMinimumCents(minimumCreditLimit);
  if (minimumCents === null) return invalid('No se pudo validar el saldo pendiente.');
  return toMoneyDraft(value, { minimumCents, requirePositive: true });
};

// Shared Cloud and storage boundaries validate exact money without imposing Clientes' $50 step on Fiado.
export const validateCustomerCreditLimitMoney = (value) => toMoneyDraft(value, { allowEmpty: true });

export const isValidCustomerCreditLimitMoney = (value) => validateCustomerCreditLimitMoney(value).valid;
