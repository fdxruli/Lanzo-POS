import { describe, expect, it } from 'vitest';
import { validateBatchInput } from '../utils/validateBatchInput';

const values = (expiryDate) => ({
  stock: '0', cost: '0', price: '10', manufacturerBatchId: 'LOT-001', expiryDate
});

describe('validateBatchInput calendar dates', () => {
  it('accepts a real date-only expiry without converting its calendar day', () => {
    expect(validateBatchInput(values('2027-12-31'), { expirationMode: 'STRICT' }).valid).toBe(true);
  });

  it('rejects impossible date-only expiries such as February 31', () => {
    expect(validateBatchInput(values('2027-02-31'), { expirationMode: 'STRICT' })).toMatchObject({
      valid: false, message: 'La fecha ingresada no es válida.'
    });
  });
});
