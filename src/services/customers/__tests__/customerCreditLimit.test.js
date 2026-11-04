import { describe, expect, it } from 'vitest';
import {
  validateCustomerCreditLimitMoney,
  validateDirectoryCreditLimit,
  validateDirectoryCreditLimitEdit,
  validateQuickAddCreditLimit
} from '../customerCreditLimit';

describe('customer credit limit contracts', () => {
  it('accepts $0 and an empty Clientes field as the existing no-credit value', () => {
    expect(validateDirectoryCreditLimit('0')).toMatchObject({ valid: true, value: 0, cents: 0 });
    expect(validateDirectoryCreditLimit('')).toMatchObject({ valid: true, value: 0, cents: 0 });
    expect(validateDirectoryCreditLimit(null).valid).toBe(false);
  });

  it('preserves the original min=0, step=50 rule for Clientes', () => {
    expect(validateDirectoryCreditLimit('50')).toMatchObject({ valid: true, value: 50, cents: 5000 });
    expect(validateDirectoryCreditLimit('100')).toMatchObject({ valid: true, value: 100, cents: 10000 });
    expect(validateDirectoryCreditLimit('50.00').valid).toBe(true);
    expect(validateDirectoryCreditLimit('25').error).toContain('múltiplo de $50');
    expect(validateDirectoryCreditLimit('50.01').valid).toBe(false);
  });

  it('rejects negative, non-numeric, partial, non-finite, over-precision, and unsafe amounts', () => {
    for (const value of ['-50', 'abc', '50abc', '1e3', '50.001', '999999999999999999999999', Infinity, NaN]) {
      expect(validateDirectoryCreditLimit(value).valid, String(value)).toBe(false);
      expect(validateCustomerCreditLimitMoney(value).valid, String(value)).toBe(false);
    }
  });

  it('allows only exact valid preserved decimal limits', () => {
    expect(validateDirectoryCreditLimitEdit('80.25', 80.25)).toMatchObject({ valid: true, cents: 8025 });
    expect(validateDirectoryCreditLimitEdit('80.26', 80.25).valid).toBe(false);
    expect(validateDirectoryCreditLimitEdit('100', 80.25).valid).toBe(true);
    expect(validateDirectoryCreditLimitEdit('-1', -1).valid).toBe(false);
    expect(validateDirectoryCreditLimitEdit('80.25', undefined).valid).toBe(false);
  });

  it('keeps QuickAdd compatible with a positive balance-covering limit and cent amounts', () => {
    expect(validateQuickAddCreditLimit('80.25', 80)).toMatchObject({ valid: true, value: 80.25, cents: 8025 });
    expect(validateQuickAddCreditLimit('80.25', 80.26).valid).toBe(false);
    expect(validateQuickAddCreditLimit('0', 0).valid).toBe(false);
    expect(validateQuickAddCreditLimit('', 0).valid).toBe(false);
    expect(validateQuickAddCreditLimit('80.256', 80).valid).toBe(false);
  });
});

describe('FIN-01 future reduction confirmation harness', () => {
  const submitWithFin01Guard = ({ rawLimit, currentDebtCents, currentLimitCents, confirmed }) => {
    const amount = validateDirectoryCreditLimit(rawLimit);
    if (!amount.valid) return { saved: false, code: 'INVALID_CREDIT_LIMIT' };
    const reducesBelowDebt = amount.cents < currentDebtCents && amount.cents !== currentLimitCents;
    if (reducesBelowDebt && !confirmed) return { saved: false, code: 'LIMIT_CONFIRMATION_REQUIRED' };
    return { saved: true, limitCents: amount.cents, debtCents: currentDebtCents };
  };

  it('requires FIN-01 confirmation but cannot let confirmation bypass amount validation', () => {
    expect(submitWithFin01Guard({ rawLimit: '50', currentDebtCents: 8000, currentLimitCents: 10000, confirmed: false }))
      .toMatchObject({ saved: false, code: 'LIMIT_CONFIRMATION_REQUIRED' });
    expect(submitWithFin01Guard({ rawLimit: '25', currentDebtCents: 8000, currentLimitCents: 10000, confirmed: true }))
      .toMatchObject({ saved: false, code: 'INVALID_CREDIT_LIMIT' });
    expect(submitWithFin01Guard({ rawLimit: '50', currentDebtCents: 8000, currentLimitCents: 10000, confirmed: true }))
      .toMatchObject({ saved: true, limitCents: 5000, debtCents: 8000 });
  });
});
