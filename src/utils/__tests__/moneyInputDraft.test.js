import { describe, expect, it } from 'vitest';
import { isMoneyInputDraft, normalizeMoneyInputDraft, parseMoneyInputDraft } from '../moneyInputDraft';

describe('money input draft boundary', () => {
  it.each(['', '0', '1', '15', '150', '150.', '150,', '150.9', '150,9', '150.99', '.01'])('preserves the editable grammar for %j', (draft) => {
    expect(isMoneyInputDraft(draft)).toBe(true);
  });

  it.each(['-', '+', 'e', 'E', '1e3', '..', ',,', '150.999', 'abc', ' 150 ', '1,000.00'])('rejects %j without turning it into zero', (draft) => {
    expect(isMoneyInputDraft(draft)).toBe(false);
    expect(parseMoneyInputDraft(draft)).toEqual({ status: 'invalid', cents: null });
    expect(normalizeMoneyInputDraft(draft)).toBeNull();
  });

  it('distinguishes a required empty draft from an explicitly optional zero', () => {
    expect(parseMoneyInputDraft('')).toEqual({ status: 'incomplete', cents: null });
    expect(normalizeMoneyInputDraft('')).toBeNull();
    expect(parseMoneyInputDraft('', { allowEmpty: true })).toEqual({ status: 'valid', cents: 0 });
    expect(normalizeMoneyInputDraft('', { allowEmpty: true })).toBe('0.00');
    expect(parseMoneyInputDraft('.')).toEqual({ status: 'incomplete', cents: null });
    expect(parseMoneyInputDraft(',', { allowEmpty: true })).toEqual({ status: 'incomplete', cents: null });
  });

  it.each(['150.', '150,'])('resolves trailing separator %j at the monetary boundary', (draft) => {
    expect(parseMoneyInputDraft(draft)).toEqual({ status: 'incomplete', cents: 15000 });
    expect(normalizeMoneyInputDraft(draft)).toBe('150.00');
  });

  it.each([
    ['33.34', 3334], ['33.33', 3333], ['100.00', 10000], ['150.99', 15099],
    ['150,99', 15099], ['0.01', 1], ['999999.99', 99999999], ['150.9', 15090]
  ])('resolves %s to exact Money cents', (draft, cents) => {
    expect(parseMoneyInputDraft(draft)).toEqual({ status: 'valid', cents });
  });

  it.each(['999999999999999999', '999999999999999999999999999999'])('rejects cents beyond safe integer precision for %s', (value) => {
    expect(parseMoneyInputDraft(value)).toEqual({ status: 'invalid', cents: null });
  });
});
