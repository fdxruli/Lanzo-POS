import { describe, expect, it } from 'vitest';
import {
  buildPhoneBuckets,
  getPhoneConflictGroups,
  normalizePhoneKey,
  summarizePhoneConflictGroups,
  toIndexedPhoneKey
} from '../../db/customerPhoneUtils';

describe('customerPhoneUtils', () => {
  it('normaliza telefono dejando solo digitos', () => {
    expect(normalizePhoneKey('+52 (55) 1234-5678')).toBe('525512345678');
    expect(normalizePhoneKey(' 55-12-34 ')).toBe('551234');
  });

  it('toIndexedPhoneKey retorna null para telefonos vacios', () => {
    expect(toIndexedPhoneKey('')).toBeNull();
    expect(toIndexedPhoneKey('---')).toBeNull();
    expect(toIndexedPhoneKey('(55) 1234')).toBe('551234');
  });

  it('detecta grupos duplicados por telefono normalizado', () => {
    const customers = [
      { id: '1', phone: '55-1234' },
      { id: '2', phone: '(55)1234' },
      { id: '3', phone: '55-9999' },
      { id: '4', phone: '' }
    ];

    const buckets = buildPhoneBuckets(customers);
    expect(buckets.get('551234')).toHaveLength(2);
    expect(buckets.get('559999')).toHaveLength(1);

    const conflicts = getPhoneConflictGroups(customers);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].phoneKey).toBe('551234');
    expect(conflicts[0].records.map((c) => c.id)).toEqual(['1', '2']);

    expect(summarizePhoneConflictGroups(conflicts)).toBe('551234 (2)');
  });
});
