import { describe, expect, it } from 'vitest';
import {
  buildDiagnosticResult,
  DIAGNOSTIC_TYPES,
  filterDiagnosticSales,
  getDiagnosticPeriod,
  resolveDiagnosticSource
} from '../diagnosticCalculations';

const period = {
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-10-01T00:00:00.000Z',
  timezone: 'UTC',
  rangeType: 'thisMonth'
};

const sale = (overrides = {}) => ({
  id: `sale-${Math.random()}`,
  timestamp: '2026-09-10T12:00:00.000Z',
  status: 'closed',
  total: 100,
  items: [{ id: 'p-1', name: 'Producto', quantity: 1, price: 100, unit_cost: 40 }],
  ...overrides
});

describe('diagnosticCalculations', () => {
  it('uses business timezone boundaries for the supported date ranges', () => {
    const result = getDiagnosticPeriod('today', {
      now: new Date('2026-09-19T05:00:00.000Z'),
      timezone: 'America/Mexico_City'
    });

    expect(result.from).toBe('2026-09-18T06:00:00.000Z');
    expect(result.to).toBe('2026-09-19T06:00:00.000Z');
  });

  it('calculates inventory risk without mutating products or hiding missing fields', () => {
    const result = buildDiagnosticResult({
      diagnosticType: DIAGNOSTIC_TYPES.INVENTORY,
      period,
      source: 'local',
      menu: [
        { id: 'zero', name: 'Cero', trackStock: true, stock: 0, committedStock: 0, minStock: 2, cost: 5 },
        { id: 'negative', name: 'Negativo', trackStock: true, stock: -1, committedStock: 0, minStock: 2, cost: 5 },
        { id: 'low', name: 'Bajo', trackStock: true, stock: 5, committedStock: 4, minStock: 2, cost: 10 },
        { id: 'dead', name: 'Sin movimiento', trackStock: true, stock: 3, committedStock: 0, minStock: 1, cost: 20 },
        { id: 'missing-cost', name: 'Sin costo', trackStock: true, stock: 2, committedStock: 0, minStock: 1 }
      ],
      sales: [sale({ id: 'sold-low', items: [{ id: 'low', quantity: 1, price: 10, unit_cost: 5 }] })],
      wasteLogs: [{ id: 'w-1', timestamp: '2026-09-10T12:00:00.000Z', productId: 'low', lossAmount: 7 }],
      batches: [{ id: 'batch-1', productId: 'dead', productName: 'Sin movimiento', stock: 2, cost: 20, expiryDate: '2026-09-20T00:00:00.000Z' }]
    });

    expect(result.metrics.productsWithoutStock).toBe(2);
    expect(result.metrics.stockNegative).toBe(1);
    expect(result.metrics.lowStock).toBe(1);
    expect(result.metrics.committedStock).toBe(4);
    expect(result.metrics.productsWithoutMovement).toBe(2);
    expect(result.metrics.wasteAmount).toBe(7);
    expect(result.metrics.expiringLots).toBe(1);
    expect(result.metrics.capitalDetained).toBe(70);
    expect(result.coverage.missingFields.some((field) => field.startsWith('cost:missing-cost'))).toBe(true);
    expect(result.findings.map((item) => item.id)).toEqual(expect.arrayContaining([
      'inventory-out-of-stock',
      'inventory-negative-stock',
      'inventory-low-stock',
      'inventory-no-movement',
      'inventory-waste',
      'inventory-expiration-risk'
    ]));
  });

  it('excludes cancelled, reverted and duplicate ecommerce sales and preserves missing-cost quality', () => {
    const result = buildDiagnosticResult({
      diagnosticType: DIAGNOSTIC_TYPES.FINANCIAL,
      period,
      source: 'mixed',
      sales: [
        sale({ id: 'normal', total: 100, paymentMethod: 'cash' }),
        sale({ id: 'cancelled', status: 'cancelled', total: 500 }),
        sale({ id: 'reverted', status: 'reverted', total: 400 }),
        sale({ id: 'shadow-order', sourceMode: 'shadow', ecommerceOrderId: 'order-1', total: 80 }),
        sale({ id: 'final-order', ecommerceOrderId: 'order-1', total: 90, paymentMethod: 'card', items: [{ id: 'p-2', name: 'P2', quantity: 2, price: 45, cost: 10 }] }),
        sale({ id: 'missing', total: 40, items: [{ id: 'p-3', quantity: 1, price: 40 }] })
      ]
    });

    expect(result.metrics.salesCount).toBe(3);
    expect(result.metrics.netSales).toBe(230);
    expect(result.metrics.costOfSales).toBe(60);
    expect(result.metrics.grossProfit).toBeNull();
    expect(result.metrics.missingCostRevenue).toBe(40);
    expect(result.metrics.paymentMethods.map((row) => row.method)).toEqual(expect.arrayContaining(['cash', 'card']));
    expect(result.warnings).toHaveLength(1);
    expect(result.findings.some((item) => item.id === 'financial-missing-costs')).toBe(true);
  });

  it('calculates customer activity, recurrence, anonymous sales and debt', () => {
    const result = buildDiagnosticResult({
      diagnosticType: DIAGNOSTIC_TYPES.CUSTOMERS,
      period,
      customers: [
        { id: 'c-1', name: 'Nuevo', debt: 0 },
        { id: 'c-2', name: 'Recurrente', debt: 25 },
        { id: 'c-3', name: 'Sin compra', debt: 10 }
      ],
      sales: [
        sale({ id: 'c1-sale', customerId: 'c-1', total: 20 }),
        sale({ id: 'c2-sale-1', customerId: 'c-2', total: 30, balanceDue: 5 }),
        sale({ id: 'c2-sale-2', customerId: 'c-2', total: 40 }),
        sale({ id: 'anonymous', total: 50 })
      ]
    });

    expect(result.metrics.registeredCustomers).toBe(3);
    expect(result.metrics.activeCustomers).toBe(2);
    expect(result.metrics.recurrentCustomers).toBe(1);
    expect(result.metrics.purchaseFrequency).toBe(1.5);
    expect(result.metrics.pendingBalances).toBe(5);
    expect(result.metrics.totalDebt).toBe(35);
    expect(result.metrics.anonymousSales).toBe(1);
    expect(result.metrics.customersWithoutRecentActivity).toBe(1);
  });

  it('returns a stable empty result instead of fabricating data', () => {
    const result = buildDiagnosticResult({
      diagnosticType: DIAGNOSTIC_TYPES.FINANCIAL,
      period,
      sales: []
    });

    expect(result.metrics.netSales).toBe(0);
    expect(result.metrics.grossProfit).toBe(0);
    expect(result.coverage.salesAnalyzed).toBe(0);
    expect(result.findings[0].id).toBe('financial-no-sales');
  });

  it('keeps the same input deterministic apart from generated metadata', () => {
    const input = { diagnosticType: DIAGNOSTIC_TYPES.FINANCIAL, period, sales: [sale({ id: 'stable' })] };
    const first = buildDiagnosticResult({ ...input, generatedAt: '2026-09-19T00:00:00.000Z' });
    const second = buildDiagnosticResult({ ...input, generatedAt: '2026-09-19T00:00:00.000Z' });
    expect(first).toEqual(second);
  });

  it('filters date and status before the diagnostic calculation', () => {
    const rows = [sale({ id: 'inside' }), sale({ id: 'outside', timestamp: '2026-08-01T00:00:00.000Z' }), sale({ id: 'void', status: 'voided' })];
    expect(filterDiagnosticSales(rows, period).map((row) => row.id)).toEqual(['inside']);
  });

  it('identifies local, cloud and mixed report sources explicitly', () => {
    expect(resolveDiagnosticSource({ mode: 'local' }, {})).toBe('local');
    expect(resolveDiagnosticSource({ mode: 'cloud_final' }, {})).toBe('cloud');
    expect(resolveDiagnosticSource({ mode: 'cloud_final' }, { sales: [sale()] })).toBe('mixed');
  });
});
