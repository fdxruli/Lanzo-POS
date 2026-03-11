import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/dexie';
import { searchProductsInDB } from '../../db/products';

const createMockCollection = (rows) => {
  let currentRows = [...rows];

  return {
    filter(predicate) {
      currentRows = currentRows.filter(predicate);
      return this;
    },
    limit(size) {
      currentRows = currentRows.slice(0, size);
      return this;
    },
    async toArray() {
      return [...currentRows];
    }
  };
};

const createMockTable = (rows) => ({
  where(indexName) {
    return {
      startsWith(term) {
        const normalizedTerm = String(term || '').toLowerCase();
        const indexedRows = rows.filter((row) => {
          const value = row?.[indexName];
          if (value === null || value === undefined) return false;
          return String(value).toLowerCase().startsWith(normalizedTerm);
        });
        return createMockCollection(indexedRows);
      }
    };
  },
  filter(predicate) {
    return createMockCollection(rows.filter(predicate));
  }
});

describe('searchProductsInDB', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna [] cuando el termino esta vacio', async () => {
    const tableSpy = vi.spyOn(db, 'table').mockImplementation(() => createMockTable([]));

    const result = await searchProductsInDB('   ');

    expect(result).toEqual([]);
    expect(tableSpy).not.toHaveBeenCalled();
  });

  it('usa indices y deduplica resultados repetidos por id', async () => {
    const rows = [
      { id: 'p1', name_lower: 'alitas bbq', barcode: 'ali-001', sku: 'ali-sku', isActive: true },
      { id: 'p2', name_lower: 'albondigas', barcode: '12345', sku: 'alb-001', isActive: true },
      { id: 'p3', name_lower: 'combo premium', barcode: '9988', sku: 'ali-pack', isActive: true },
      { id: 'p4', name_lower: 'alitas ocultas', barcode: 'ali-999', sku: 'x', isActive: false }
    ];

    vi.spyOn(db, 'table').mockImplementation(() => createMockTable(rows));

    const result = await searchProductsInDB('ali');
    const ids = result.map((item) => item.id);

    expect(ids).toContain('p1');
    expect(ids).toContain('p3');
    expect(ids).not.toContain('p4');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('aplica fallback contains cuando el indice no cubre la coincidencia', async () => {
    const rows = [
      { id: 'p1', name_lower: 'tortilla de maiz', barcode: '7788', sku: 'tor-01', isActive: true },
      { id: 'p2', name_lower: 'pan integral', barcode: '3322', sku: 'pan-01', isActive: true }
    ];

    vi.spyOn(db, 'table').mockImplementation(() => createMockTable(rows));

    const result = await searchProductsInDB('maiz');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });
});
