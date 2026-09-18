import { describe, expect, it } from 'vitest';
import {
  formatMessageDate,
  formatMoney,
  isCreditPaymentMethod,
  normalizeMessageDate,
  normalizeMexicanPhone,
  normalizeMoney,
  normalizePaymentMethod
} from '../index';

describe('customer messaging normalizers', () => {
  it.each([
    ['5512345678', '+525512345678'],
    ['55 1234 5678', '+525512345678'],
    ['55-1234-5678', '+525512345678'],
    ['+52 (55) 1234-5678', '+525512345678'],
    ['52 55 1234 5678', '+525512345678']
  ])('normalizes Mexican phone %s', (input, e164) => {
    expect(normalizeMexicanPhone(input)).toMatchObject({ status: 'valid', e164 });
  });

  it('returns controlled phone diagnostics without changing the input', () => {
    const duplicatePrefix = '52525512345678';
    expect(normalizeMexicanPhone(duplicatePrefix)).toMatchObject({ status: 'invalid', code: 'CUSTOMER_PHONE_INVALID' });
    expect(normalizeMexicanPhone('')).toMatchObject({ status: 'missing', code: 'CUSTOMER_PHONE_MISSING' });
    expect(normalizeMexicanPhone(null)).toMatchObject({ status: 'missing', code: 'CUSTOMER_PHONE_MISSING' });
    expect(normalizeMexicanPhone('555')).toMatchObject({ status: 'invalid', code: 'CUSTOMER_PHONE_INVALID' });
    expect(duplicatePrefix).toBe('52525512345678');
  });

  it('parses and formats numbers and decimal strings without float coercion', () => {
    expect(normalizeMoney(12.5)).toMatchObject({ ok: true, exact: '12.5', decimal: '12.50' });
    expect(normalizeMoney('10.25')).toMatchObject({ ok: true, exact: '10.25', decimal: '10.25' });
    expect(normalizeMoney(0)).toMatchObject({ ok: true, exact: '0', decimal: '0.00' });
    expect(formatMoney('1,234.50')).toMatchObject({ ok: true, value: '$1,234.50' });
    expect(formatMoney('-5.1')).toMatchObject({ ok: true, value: '-$5.10' });
  });

  it('returns controlled missing or invalid money results', () => {
    expect(normalizeMoney('')).toMatchObject({ ok: false, code: 'MONEY_VALUE_MISSING' });
    expect(normalizeMoney(null)).toMatchObject({ ok: false, code: 'MONEY_VALUE_MISSING' });
    expect(normalizeMoney('not-money')).toMatchObject({ ok: false, code: 'MONEY_VALUE_INVALID' });
    expect(normalizeMoney({ amount: 10 })).toMatchObject({ ok: false, code: 'MONEY_VALUE_INVALID' });
  });

  it('formats durable timestamps and calendar-only layaway dates deterministically', () => {
    expect(normalizeMessageDate('2026-09-17T18:30:00.000Z', { timeZone: 'UTC' })).toMatchObject({
      ok: true,
      value: '17/09/2026 18:30',
      iso: '2026-09-17T18:30:00.000Z'
    });
    expect(formatMessageDate('2026-09-25', { timeZone: 'America/Mexico_City' })).toBe('2026-09-25');
    expect(normalizeMessageDate()).toMatchObject({ ok: false, code: 'MESSAGE_DATE_MISSING' });
    expect(normalizeMessageDate('not-a-date')).toMatchObject({ ok: false, code: 'MESSAGE_DATE_INVALID' });
  });

  it.each([
    ['efectivo', 'cash', false],
    ['tarjeta', 'card', false],
    ['transferencia', 'transfer', false],
    ['fiado', 'credit', true],
    ['credit', 'credit', true],
    ['mixed_credit', 'credit', true],
    ['customer_credit', 'credit', true],
    ['custom-method', 'custom_method', false]
  ])('normalizes payment method %s', (input, canonical, isCredit) => {
    expect(normalizePaymentMethod(input)).toMatchObject({ canonical, isCredit });
    expect(isCreditPaymentMethod(input)).toBe(isCredit);
  });
});
