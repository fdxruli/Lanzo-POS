import { describe, expect, it } from 'vitest';
import {
  formatMessageDate,
  formatMoney,
  formatMoneyValue,
  isCreditPaymentMethod,
  normalizeMessageDate,
  normalizeMexicanPhone,
  normalizeMoney,
  normalizePaymentMethod
} from '../normalizers';

describe('customer messaging normalizers', () => {
  describe('normalizeMexicanPhone', () => {
    it.each([
      ['10 digit national number', '5512345678'],
      ['spaces and parentheses', '(55) 1234 5678'],
      ['hyphens', '55-1234-5678'],
      ['+52 prefix', '+52 (55) 1234-5678'],
      ['52 prefix', '52 55 1234 5678']
    ])('returns E.164 for %s', (_label, input) => {
      expect(normalizeMexicanPhone(input)).toMatchObject({
        status: 'valid',
        code: null,
        e164: '+525512345678',
        nationalNumber: '5512345678'
      });
    });

    it('rejects an already duplicated country prefix instead of duplicating it again', () => {
      expect(normalizeMexicanPhone('+52 52 55 1234 5678')).toMatchObject({
        status: 'invalid',
        code: 'CUSTOMER_PHONE_INVALID',
        e164: null,
        nationalNumber: null
      });
    });

    it.each([
      ['empty text', ''],
      ['whitespace text', '   '],
      ['null', null],
      ['undefined', undefined]
    ])('returns the missing diagnostic for %s', (_label, input) => {
      expect(normalizeMexicanPhone(input)).toMatchObject({
        status: 'missing',
        code: 'CUSTOMER_PHONE_MISSING',
        e164: null,
        nationalNumber: null
      });
    });

    it.each(['551234567', '55123456789', '55AB12345678', '++52 55 1234 5678'])('returns an invalid diagnostic for %s', (input) => {
      expect(normalizeMexicanPhone(input)).toMatchObject({
        status: 'invalid',
        code: 'CUSTOMER_PHONE_INVALID',
        e164: null,
        nationalNumber: null
      });
    });
  });

  describe('money', () => {
    it('preserves exact decimal inputs without coercing through a float', () => {
      expect(normalizeMoney(12.5)).toMatchObject({ ok: true, exact: '12.5', decimal: '12.50' });
      expect(normalizeMoney('1,234.50')).toMatchObject({ ok: true, exact: '1234.5', decimal: '1234.50' });
      expect(normalizeMoney('0')).toMatchObject({ ok: true, exact: '0', decimal: '0.00' });
    });

    it('formats zero, pending balances, and discounts safely', () => {
      expect(formatMoney('0')).toMatchObject({ ok: true, value: '$0.00' });
      expect(formatMoney('1200.5')).toMatchObject({ ok: true, value: '$1,200.50' });
      expect(formatMoney('-15.25')).toMatchObject({ ok: true, value: '-$15.25' });
      expect(formatMoneyValue('1200.5')).toBe('$1,200.50');
    });

    it.each([
      ['empty text', '', 'MONEY_VALUE_MISSING'],
      ['null', null, 'MONEY_VALUE_MISSING'],
      ['undefined', undefined, 'MONEY_VALUE_MISSING'],
      ['invalid text', 'not-a-number', 'MONEY_VALUE_INVALID'],
      ['currency text', '$10.00', 'MONEY_VALUE_INVALID'],
      ['boolean', true, 'MONEY_VALUE_INVALID'],
      ['object', { value: 10 }, 'MONEY_VALUE_INVALID']
    ])('returns a controlled result for %s', (_label, input, code) => {
      expect(normalizeMoney(input)).toMatchObject({ ok: false, code });
      expect(formatMoneyValue(input, { fallback: '—' })).toBe('—');
    });
  });

  describe('dates', () => {
    it('formats a durable ISO timestamp deterministically for an explicit zone', () => {
      const input = '2026-09-17T18:30:00.000Z';
      const first = normalizeMessageDate(input, { timeZone: 'UTC' });
      const second = normalizeMessageDate(input, { timeZone: 'UTC' });

      expect(first).toMatchObject({
        ok: true,
        kind: 'timestamp',
        value: '17/09/2026 18:30',
        iso: input,
        timeZone: 'UTC'
      });
      expect(second).toEqual(first);
      expect(formatMessageDate(new Date(input), { timeZone: 'UTC' })).toBe('17/09/2026 18:30');
    });

    it('preserves a layaway YYYY-MM-DD deadline as a calendar date', () => {
      expect(normalizeMessageDate('2026-10-05', { timeZone: 'America/Mexico_City' })).toEqual({
        ok: true,
        status: 'valid',
        kind: 'date_only',
        value: '2026-10-05',
        timeZone: 'America/Mexico_City'
      });
    });

    it.each([
      ['missing', null, 'MESSAGE_DATE_MISSING'],
      ['empty', '', 'MESSAGE_DATE_MISSING'],
      ['invalid', 'not-a-date', 'MESSAGE_DATE_INVALID']
    ])('returns a controlled result for a %s date', (_label, input, code) => {
      expect(normalizeMessageDate(input, { timeZone: 'UTC' })).toMatchObject({ ok: false, code });
      expect(formatMessageDate(input, { timeZone: 'UTC', fallback: 'Sin fecha' })).toBe('Sin fecha');
    });
  });

  describe('payment methods', () => {
    it.each([
      ['efectivo', 'cash', false],
      ['tarjeta', 'card', false],
      ['transferencia', 'transfer', false],
      ['fiado', 'credit', true],
      ['credit', 'credit', true],
      ['mixed_credit', 'credit', true],
      ['customer_credit', 'credit', true],
      ['mixed credit', 'credit', true],
      ['crypto', 'crypto', false]
    ])('normalizes %s', (input, canonical, isCredit) => {
      const result = normalizePaymentMethod(input);
      expect(result.canonical).toBe(canonical);
      expect(result.isCredit).toBe(isCredit);
      expect(isCreditPaymentMethod(input)).toBe(isCredit);
    });

    it('keeps the original value for diagnostics while using a canonical method', () => {
      expect(normalizePaymentMethod('  MIXED-CREDIT  ')).toMatchObject({
        original: 'MIXED-CREDIT',
        normalized: 'mixed_credit',
        canonical: 'credit',
        isCredit: true
      });
    });
  });
});
