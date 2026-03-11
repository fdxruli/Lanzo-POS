import { describe, expect, it } from 'vitest';
import { getBatchTableColumns } from '../utils/tableColumns';

describe('getBatchTableColumns', () => {
  it('respeta orden de columnas con variantes y lotes', () => {
    const keys = getBatchTableColumns({ hasVariants: true, hasLots: true }).map((column) => column.key);
    expect(keys).toEqual([
      'primary',
      'sku',
      'expiryDate',
      'price',
      'location',
      'stock',
      'actions'
    ]);
  });

  it('respeta orden de columnas solo con lotes', () => {
    const keys = getBatchTableColumns({ hasVariants: false, hasLots: true }).map((column) => column.key);
    expect(keys).toEqual([
      'primary',
      'expiryDate',
      'price',
      'location',
      'stock',
      'actions'
    ]);
  });

  it('respeta orden base sin lotes ni variantes', () => {
    const keys = getBatchTableColumns({ hasVariants: false, hasLots: false }).map((column) => column.key);
    expect(keys).toEqual([
      'primary',
      'price',
      'location',
      'stock',
      'actions'
    ]);
  });
});

