import { describe, expect, it } from 'vitest';
import { getBatchStockInputProps } from '../utils/batchStockInput';

describe('getBatchStockInputProps', () => {
  it('permite decimales para productos a granel', () => {
    expect(
      getBatchStockInputProps({ saleType: 'bulk', bulkData: { purchase: { unit: 'kg' } } }, 'retail')
    ).toMatchObject({
      step: '0.001',
      inputMode: 'decimal',
      unit: 'kg'
    });
  });

  it('permite decimales para unidades de peso o volumen aunque no venga saleType', () => {
    expect(getBatchStockInputProps({ unit: 'lt' }, 'retail').step).toBe('0.001');
    expect(getBatchStockInputProps({ unit: 'gr' }, 'retail').step).toBe('0.001');
    expect(getBatchStockInputProps({ unit: 'kg' }, 'fruteria').step).toBe('0.001');
  });

  it('mantiene enteros para piezas y variantes unitarias', () => {
    expect(
      getBatchStockInputProps({ saleType: 'unit', unit: 'pza' }, 'retail', { hasVariants: true })
    ).toMatchObject({
      step: '1',
      inputMode: 'numeric',
      unit: 'pza'
    });
  });
});
