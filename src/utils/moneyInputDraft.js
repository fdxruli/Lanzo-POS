import { Money } from './moneyMath';

// Keep the user's text intact until a monetary calculation or commit needs cents.
export const isMoneyInputDraft = (value) => (
  typeof value === 'string' && /^\d*(?:[.,]\d{0,2})?$/.test(value)
);

export const parseMoneyInputDraft = (value, { allowEmpty = false } = {}) => {
  if (!isMoneyInputDraft(value)) return { status: 'invalid', cents: null };
  if (value === '') return { status: allowEmpty ? 'valid' : 'incomplete', cents: allowEmpty ? 0 : null };
  if (value === '.' || value === ',') return { status: 'incomplete', cents: null };

  const candidate = value.replace(',', '.');
  try {
    const amount = Money.init(candidate.endsWith('.') ? candidate.slice(0, -1) : candidate);
    const cents = Money.toCents(amount);
    if (!Number.isSafeInteger(cents) || cents < 0 || !Money.fromCents(cents).eq(amount)) {
      return { status: 'invalid', cents: null };
    }
    return { status: /[.,]$/.test(value) ? 'incomplete' : 'valid', cents };
  } catch {
    return { status: 'invalid', cents: null };
  }
};

export const normalizeMoneyInputDraft = (value, options) => {
  const { cents } = parseMoneyInputDraft(value, options);
  return cents === null ? null : Money.fromCents(cents).toFixed(2);
};
