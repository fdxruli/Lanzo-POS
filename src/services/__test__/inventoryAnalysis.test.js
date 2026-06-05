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
  it('genera alertas exclusivamente desde batches (SSOT)', () => {
    const now = new Date('2026-02-10T12:00:00.000Z');
    const products = [
      { id: 'prod-1', name: 'Leche', isActive: true, stock: 4, isPerishable: true, location: 'Refrigerador' },
      { id: 'prod-2', name: 'Yogurt', isActive: true, isPerishable: true }
    ];
    const riskBatches = [
      { id: 'batch-1', productId: 'prod-1', stock: 3, expiryDate: '2026-02-11T00:00:00.000Z', sku: 'L001' },
      { id: 'batch-2', productId: 'prod-2', stock: 5, expiryDate: '2026-02-15T00:00:00.000Z', sku: 'Y001' }
    ];

    const report = buildExpiringProductsReport({
      products,
      riskBatches,
      daysThreshold: 7,
      now
    });

    // Solo lotes, nunca productos directos
    expect(report).toHaveLength(2);
    expect(report.every((item) => item.type === 'Lote')).toBe(true);

    const batchAlert = report.find((item) => item.id === 'batch-1');
    expect(batchAlert).toMatchObject({
      type: 'Lote',
      productId: 'prod-1',
      productName: 'Leche',
      batchSku: 'L001',
      daysRemaining: 1,
      daysLeft: 1,
      urgencyLevel: 'critical'
    });
  });

  it('maneja lotes huerfanos (producto eliminado) sin crashear', () => {
    const now = new Date('2026-02-10T00:00:00.000Z');
    const riskBatches = [
      { id: 'batch-orphan', productId: 'prod-deleted', stock: 2, expiryDate: '2026-02-12T00:00:00.000Z', sku: 'ORPH' }
    ];

    const report = buildExpiringProductsReport({
      products: [],
      riskBatches,
      daysThreshold: 7,
      now
    });

    expect(report).toHaveLength(1);
    expect(report[0].productName).toContain('Producto Eliminado');
  });

  it('calcula urgencyLevel correctamente desde batches', () => {
    const now = new Date('2026-02-10T00:00:00.000Z');
    const products = [
      { id: 'p1', name: 'Pan', isPerishable: true },
      { id: 'p2', name: 'Queso', isPerishable: true }
    ];
    const riskBatches = [
      { id: 'b1', productId: 'p1', stock: 3, expiryDate: '2026-02-09T00:00:00.000Z' },
      { id: 'b2', productId: 'p2', stock: 2, expiryDate: '2026-02-14T00:00:00.000Z' }
    ];

    const report = buildExpiringProductsReport({
      products,
      riskBatches,
      daysThreshold: 7,
      now
    });

    const expired = report.find((item) => item.id === 'b1');
    const upcoming = report.find((item) => item.id === 'b2');

    expect(expired.urgencyLevel).toBe('critical');
    expect(upcoming.urgencyLevel).toBe('high');
  });
});
