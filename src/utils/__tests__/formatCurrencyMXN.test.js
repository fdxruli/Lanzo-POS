import { describe, expect, it } from 'vitest';
import { formatCurrencyMXN } from '../formatCurrencyMXN';

describe('formatCurrencyMXN', () => {
  it('formats numbers and numeric text consistently as MXN', () => {
    expect(formatCurrencyMXN(19045.9)).toBe('$19,045.90');
    expect(formatCurrencyMXN('19045.9')).toBe('$19,045.90');
    expect(formatCurrencyMXN('$19,045.90')).toBe('$19,045.90');
  });

  it('does not duplicate the currency symbol or produce NaN for empty values', () => {
    expect(formatCurrencyMXN(null)).toBe('');
    expect(formatCurrencyMXN(undefined)).toBe('');
    expect(formatCurrencyMXN('')).toBe('');
    expect(formatCurrencyMXN('not-a-number', 'Sin importe')).toBe('Sin importe');
    expect(formatCurrencyMXN('$NaN', 'Sin importe')).toBe('Sin importe');
  });
});
