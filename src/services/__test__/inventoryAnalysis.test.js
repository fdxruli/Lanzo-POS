import { describe, expect, it } from 'vitest';
import {
  buildExpiringProductsReport,
  buildLowStockProductsReport
} from '../inventoryAnalysis';

describe('buildLowStockProductsReport', () => {
  it('filtra productos invalidos y calcula sugerencias de compra', () => {
    const products = [
      { id: 'p1', name: 'Arroz', isActive: true, trackStock: true, stock: 2, minStock: 5, maxStock: 10, saleType: 'unit' },
      { id: 'p2', name: 'Frijol', isActive: true, trackStock: true, stock: 7, minStock: 5, maxStock: 12, saleType: 'bulk', bulkData: { purchase: { unit: 'kg' } } },
      { id: 'p3', name: 'Inactivo', isActive: false, trackStock: true, stock: 1, minStock: 2 }
    ];

    const report = buildLowStockProductsReport(products);

    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({
      id: 'p1',
      name: 'Arroz',
      currentStock: 2,
      minStock: 5,
      suggestedOrder: 8,
      deficit: 8,
      unit: 'pza'
    });
    expect(report[0].urgency).toBeCloseTo(0.4);
  });

  it('respeta limite y ordena por urgencia', () => {
    const products = [
      { id: 'a', name: 'A', isActive: true, trackStock: true, stock: 4, minStock: 8 },
      { id: 'b', name: 'B', isActive: true, trackStock: true, stock: 1, minStock: 8 },
      { id: 'c', name: 'C', isActive: true, trackStock: true, stock: 2, minStock: 8 }
    ];

    const report = buildLowStockProductsReport(products, { limit: 2 });

    expect(report).toHaveLength(2);
    expect(report[0].id).toBe('b');
    expect(report[1].id).toBe('c');
  });
});

describe('buildExpiringProductsReport', () => {
  it('incluye lotes y productos simples con alias daysLeft/daysRemaining', () => {
    const now = new Date('2026-02-10T12:00:00.000Z');
    const products = [
      { id: 'prod-1', name: 'Leche', isActive: true, stock: 4, shelfLife: '2026-02-12T00:00:00.000Z', location: 'Refrigerador' },
      { id: 'prod-2', name: 'Yogurt', isActive: true, trackStock: true, stock: 0, shelfLife: '2026-02-11T00:00:00.000Z' }
    ];
    const riskBatches = [
      { id: 'batch-1', productId: 'prod-1', stock: 3, expiryDate: '2026-02-11T00:00:00.000Z', sku: 'L001' }
    ];

    const report = buildExpiringProductsReport({
      products,
      riskBatches,
      daysThreshold: 7,
      now
    });

    expect(report).toHaveLength(2);

    const batchAlert = report.find((item) => item.id === 'batch-1');
    const productAlert = report.find((item) => item.id === 'prod-1');

    expect(batchAlert).toMatchObject({
      type: 'Lote',
      productId: 'prod-1',
      productName: 'Leche',
      batchSku: 'L001',
      daysRemaining: 1,
      daysLeft: 1
    });

    expect(productAlert).toMatchObject({
      type: 'Producto',
      productId: 'prod-1',
      batchSku: 'General',
      daysRemaining: 2,
      daysLeft: 2
    });
  });

  it('calcula urgencyLevel para vencidos y proximos', () => {
    const now = new Date('2026-02-10T00:00:00.000Z');
    const products = [
      { id: 'prod-1', name: 'Pan', isActive: true, stock: 3, shelfLife: '2026-02-09T00:00:00.000Z' },
      { id: 'prod-2', name: 'Queso', isActive: true, stock: 2, shelfLife: '2026-02-14T00:00:00.000Z' }
    ];

    const report = buildExpiringProductsReport({
      products,
      riskBatches: [],
      daysThreshold: 7,
      now
    });

    const expired = report.find((item) => item.id === 'prod-1');
    const upcoming = report.find((item) => item.id === 'prod-2');

    expect(expired.urgencyLevel).toBe('critical');
    expect(upcoming.urgencyLevel).toBe('high');
  });
});
