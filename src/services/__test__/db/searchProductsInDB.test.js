import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchProductsInTable } from '../../db/productSearch';
import { buildProductSearchFields } from '../../db/productSearchIndex';

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
    },
    async primaryKeys() {
      return currentRows.map((row) => row.id);
    },
    async first() {
      return currentRows[0];
    }
  };
};

const createMockTable = (rows) => ({
  bulkGet(ids) {
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    return Promise.resolve(ids.map((id) => rowsById.get(id)));
  },
  where(indexName) {
    return {
      equals(term) {
        const indexedRows = rows.filter((row) => {
          const value = row?.[indexName];
          return Array.isArray(value)
            ? value.includes(term)
            : value === term;
        });
        return createMockCollection(indexedRows);
      },
      startsWith(term) {
        const normalizedTerm = String(term || '').toLowerCase();
        const indexedRows = rows.filter((row) => {
          const value = row?.[indexName];
          if (value === null || value === undefined) return false;
          if (Array.isArray(value)) {
            return value.some((item) => String(item).startsWith(normalizedTerm));
          }
          return String(value).toLowerCase().startsWith(normalizedTerm);
        });
        return createMockCollection(indexedRows);
      }
    };
  },
  filter() {
    throw new Error('La busqueda no debe hacer full scan');
  }
});

const withSearchFields = (rows) =>
  rows.map((row) => ({ ...row, ...buildProductSearchFields(row) }));

describe('searchProductsInDB', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna [] cuando el termino esta vacio', async () => {
    const result = await searchProductsInTable(createMockTable([]), '   ');

    expect(result).toEqual([]);
  });

  it('usa indices y deduplica resultados repetidos por id', async () => {
    const rows = withSearchFields([
      { id: 'p1', name: 'alitas bbq', barcode: 'ali-001', sku: 'ali-sku', isActive: true },
      { id: 'p2', name: 'albondigas', barcode: '12345', sku: 'alb-001', isActive: true },
      { id: 'p3', name: 'combo premium', barcode: '9988', sku: 'ali-pack', isActive: true },
      { id: 'p4', name: 'alitas ocultas', barcode: 'ali-999', sku: 'x', isActive: false }
    ]);

    const result = await searchProductsInTable(createMockTable(rows), 'ali');
    const ids = result.map((item) => item.id);

    expect(ids).toContain('p1');
    expect(ids).toContain('p3');
    expect(ids).not.toContain('p4');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('aplica fallback contains cuando el indice no cubre la coincidencia', async () => {
    const rows = withSearchFields([
      { id: 'p1', name: 'tortilla de maiz', barcode: '7788', sku: 'tor-01', isActive: true },
      { id: 'p2', name: 'pan integral', barcode: '3322', sku: 'pan-01', isActive: true }
    ]);

    const result = await searchProductsInTable(createMockTable(rows), 'maiz');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });

  it('normaliza acentos y resuelve SKU alfanumerico exacto primero', async () => {
    const rows = withSearchFields([
      { id: 'p1', name: 'Café molido', barcode: '7501', sku: 'CAF-001', isActive: true }
    ]);

    const byName = await searchProductsInTable(createMockTable(rows), 'cafe');
    const bySku = await searchProductsInTable(createMockTable(rows), 'caf-001');

    expect(byName.map((product) => product.id)).toEqual(['p1']);
    expect(bySku.map((product) => product.id)).toEqual(['p1']);
  });
});
