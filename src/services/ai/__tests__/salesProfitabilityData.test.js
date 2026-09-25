import { describe, expect, it, vi } from 'vitest';
import {
  addCalendarDays,
  buildSalesProfitabilityDataset,
  buildSalesProfitabilityQueryRange,
  buildSalesProfitabilityProductExclusionsFromDataset,
  buildSalesProfitabilityProductOptionsFromDataset,
  loadSalesProfitabilityDataset,
  normalizeSalesProfitLine
} from '../salesProfitabilityData';

const finalSource = { mode: 'cloud_final', stale: false };

const historyReport = (rows, overrides = {}) => ({
  source: finalSource,
  rows,
  total_count: rows.length,
  limit: rows.length || 100,
  offset: 0,
  has_more: false,
  ...overrides
});

const profitReport = (rows, overrides = {}) => ({
  source: finalSource,
  rows,
  total_count: rows.length,
  limit: rows.length || 100,
  offset: 0,
  has_more: false,
  ...overrides
});

describe('sales profitability data', () => {
  it('converts the requested 90 calendar days in Mexico City to inclusive/exclusive UTC bounds', () => {
    const range = buildSalesProfitabilityQueryRange({
      from: '2026-06-24',
      to: '2026-09-21',
      timezone: 'America/Mexico_City'
    });

    expect(range).toEqual({
      calendar: { from: '2026-06-24', to: '2026-09-21' },
      timezone: 'America/Mexico_City',
      fromInclusiveUtc: '2026-06-24T06:00:00.000Z',
      toExclusiveUtc: '2026-09-22T06:00:00.000Z'
    });
  });

  it.each([
    ['2026-09-01', 30, '2026-10-01'],
    ['2026-09-01', 90, '2026-11-30'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-02-28', 1, '2026-03-01']
  ])('adds calendar days without timezone drift: %s + %s', (from, days, expected) => {
    expect(addCalendarDays(from, days)).toBe(expected);
  });

  it.each([
    ['2026-08-23', '2026-09-21', '2026-08-23T06:00:00.000Z', '2026-09-22T06:00:00.000Z'],
    ['2026-06-24', '2026-09-21', '2026-06-24T06:00:00.000Z', '2026-09-22T06:00:00.000Z']
  ])('builds exact selectable 30/90-day calendar query bounds from %s to %s', (from, to, expectedFrom, expectedTo) => {
    const range = buildSalesProfitabilityQueryRange({
      from,
      to,
      timezone: 'America/Mexico_City'
    });
    expect(range.fromInclusiveUtc).toBe(expectedFrom);
    expect(range.toExclusiveUtc).toBe(expectedTo);
  });

  it('handles DST boundaries using the requested IANA timezone', () => {
    const beforeSpring = buildSalesProfitabilityQueryRange({
      from: '2026-03-07',
      to: '2026-03-08',
      timezone: 'America/New_York'
    });
    const afterFall = buildSalesProfitabilityQueryRange({
      from: '2026-10-31',
      to: '2026-11-01',
      timezone: 'America/New_York'
    });

    expect(beforeSpring.fromInclusiveUtc).toBe('2026-03-07T05:00:00.000Z');
    expect(beforeSpring.toExclusiveUtc).toBe('2026-03-09T04:00:00.000Z');
    expect(afterFall.fromInclusiveUtc).toBe('2026-10-31T04:00:00.000Z');
    expect(afterFall.toExclusiveUtc).toBe('2026-11-02T05:00:00.000Z');
  });

  it('keeps adjacent comparable periods without gaps or overlaps', () => {
    const previous = buildSalesProfitabilityQueryRange({
      from: '2026-08-25',
      to: '2026-08-31',
      timezone: 'America/Mexico_City'
    });
    const current = buildSalesProfitabilityQueryRange({
      from: '2026-09-01',
      to: '2026-09-07',
      timezone: 'America/Mexico_City'
    });

    expect(previous.toExclusiveUtc).toBe(current.fromInclusiveUtc);
  });

  it('uses movement cost as definitive and snapshot cost as estimated', () => {
    expect(normalizeSalesProfitLine({
      quantity: 2,
      line_total: 100,
      movement_cost: 50,
      unit_cost: 999,
      cost_source: 'inventory_movement',
      profit_status: 'definitive'
    })).toMatchObject({
      lineCost: 50,
      unitCost: 25,
      costKnown: true,
      costStatus: 'definitive'
    });

    expect(normalizeSalesProfitLine({
      quantity: 2,
      line_total: 100,
      unit_cost: 30,
      cost_source: 'sale_item_snapshot',
      profit_status: 'estimated'
    })).toMatchObject({
      lineCost: 60,
      unitCost: 30,
      costKnown: true,
      costStatus: 'estimated'
    });
  });

  it('never treats cogs zero as real cost when cost source is missing', () => {
    expect(normalizeSalesProfitLine({
      quantity: 2,
      line_total: 100,
      cogs: 0,
      gross_profit: 100,
      gross_margin_percent: 100,
      cost_source: 'missing',
      profit_status: 'incomplete'
    })).toMatchObject({
      lineCost: null,
      unitCost: null,
      costKnown: false,
      costStatus: 'incomplete',
      costSource: 'missing'
    });
  });

  it.each([
    ['inventory_movement', {
      movement_cost: 0,
      unit_cost: null,
      cost_source: 'inventory_movement',
      profit_status: 'definitive'
    }],
    ['sale_item_snapshot', {
      movement_cost: null,
      unit_cost: 0,
      cost_source: 'sale_item_snapshot',
      profit_status: 'estimated'
    }]
  ])('fails closed for unverified zero cost from %s because the current contract has no capture provenance', (_source, fields) => {
    expect(normalizeSalesProfitLine({
      quantity: 2,
      line_total: 100,
      cogs: 0,
      gross_profit: 100,
      gross_margin_percent: 100,
      ...fields
    })).toMatchObject({
      lineCost: null,
      unitCost: null,
      costKnown: false,
      costStatus: 'incomplete',
      costSource: 'missing',
      profitStatus: 'incomplete'
    });
  });

  it('keeps full item coverage but incomplete cost coverage when one line of the same product has unverified zero cost', () => {
    const dataset = buildSalesProfitabilityDataset({
      history: {
        rows: [{
          id: 'sale-mixed-cost',
          status: 'closed',
          total: 100,
          itemsCount: 2,
          itemsQuantity: 2
        }],
        paginationComplete: true,
        sourceComplete: true,
        sourceMode: 'cloud_final',
        warnings: []
      },
      profit: {
        rows: [{
          sale_id: 'sale-mixed-cost',
          product_name: 'Producto sintético',
          quantity: 1,
          line_total: 50,
          movement_cost: 20,
          cost_source: 'inventory_movement',
          profit_status: 'definitive'
        }, {
          sale_id: 'sale-mixed-cost',
          product_name: 'Producto sintético',
          quantity: 1,
          line_total: 50,
          unit_cost: 0,
          cost_source: 'sale_item_snapshot',
          profit_status: 'estimated'
        }],
        paginationComplete: true,
        sourceComplete: true,
        sourceMode: 'cloud_final',
        warnings: []
      },
      queryRange: {}
    });

    expect(dataset.metadata).toMatchObject({
      expectedDetailLines: 2,
      matchedDetailLines: 2,
      itemCoverage: 1,
      detailComplete: true,
      knownCost: 20,
      knownSales: 50,
      detailedSales: 100,
      costCoverage: 0.5,
      costComplete: false,
      costStatus: 'incomplete'
    });
    expect(dataset.metadata.products).toEqual([
      expect.objectContaining({
        name: 'Producto sintético',
        knownCost: 20,
        knownSales: 50,
        detailLines: 2,
        missingCostLines: 1,
        costKnown: false,
        costStatus: 'incomplete',
        costSource: 'missing'
      })
    ]);
    expect(dataset.history.rows[0].items).toEqual([
      expect.objectContaining({ cost: 20, cost_source: 'inventory_movement', profit_status: 'definitive' }),
      expect.objectContaining({ cost: null, cost_source: 'missing', profit_status: 'incomplete' })
    ]);
  });

  it('marks sales with missing product detail as incomplete instead of zero-cost complete', () => {
    const dataset = buildSalesProfitabilityDataset({
      history: {
        rows: [
          { id: 's1', status: 'closed', total: 30, itemsCount: 1, itemsQuantity: 1 },
          { id: 's2', status: 'closed', total: 30, itemsCount: 1, itemsQuantity: 1 },
          { id: 's3', status: 'closed', total: 30, itemsCount: 1, itemsQuantity: 1 },
          { id: 's4', status: 'closed', total: 30, itemsCount: 1, itemsQuantity: 1 }
        ],
        paginationComplete: true,
        sourceComplete: true,
        sourceMode: 'cloud_final',
        warnings: []
      },
      profit: {
        rows: [],
        paginationComplete: true,
        sourceComplete: true,
        sourceMode: 'cloud_final',
        warnings: []
      },
      queryRange: {}
    });

    expect(dataset.metadata).toMatchObject({
      expectedDetailLines: 4,
      matchedDetailLines: 0,
      itemCoverage: 0,
      detailComplete: false,
      costComplete: false,
      costCoverage: 0,
      costStatus: 'incomplete'
    });
  });

  it('marks partial detail or pagination truncation as incomplete', () => {
    const dataset = buildSalesProfitabilityDataset({
      history: {
        rows: [{ id: 's1', status: 'closed', total: 200, itemsCount: 2, itemsQuantity: 2 }],
        paginationComplete: true,
        sourceComplete: true,
        sourceMode: 'cloud_final',
        warnings: []
      },
      profit: {
        rows: [{
          sale_id: 's1',
          product_name: 'A',
          quantity: 1,
          line_total: 100,
          movement_cost: 60,
          cost_source: 'inventory_movement',
          profit_status: 'definitive'
        }],
        paginationComplete: false,
        truncated: true,
        sourceComplete: true,
        sourceMode: 'cloud_final',
        warnings: []
      },
      queryRange: {}
    });

    expect(dataset.metadata.detailComplete).toBe(false);
    expect(dataset.metadata.paginationComplete).toBe(false);
    expect(dataset.metadata.detailTruncated).toBe(true);
    expect(dataset.metadata.costComplete).toBe(false);
  });

  it('paginates both RPC-backed repositories with explicit UTC bounds', async () => {
    const historyPages = [
      historyReport([{ id: 's1', status: 'closed', total: 100, itemsCount: 1, itemsQuantity: 1 }], { has_more: true, total_count: 2 }),
      historyReport([{ id: 's2', status: 'closed', total: 80, itemsCount: 1, itemsQuantity: 1 }], { offset: 1, total_count: 2 })
    ];
    const profitPages = [
      profitReport([{
        sale_id: 's1', product_name: 'A', quantity: 1, line_total: 100,
        unit_cost: 40, cost_source: 'sale_item_snapshot', profit_status: 'estimated'
      }], { has_more: true, total_count: 2 }),
      profitReport([{
        sale_id: 's2', product_name: 'B', quantity: 1, line_total: 80,
        movement_cost: 30, cost_source: 'inventory_movement', profit_status: 'definitive'
      }], { offset: 1, total_count: 2 })
    ];
    const getSalesFinalHistory = vi.fn(async ({ offset }) => historyPages[offset]);
    const getSalesProfitReport = vi.fn(async ({ offset }) => profitPages[offset]);

    const dataset = await loadSalesProfitabilityDataset({
      repository: { getSalesFinalHistory, getSalesProfitReport },
      period: { from: '2026-09-01', to: '2026-09-07', timezone: 'America/Mexico_City' },
      scope: 'license',
      pageSize: 1
    });

    expect(getSalesFinalHistory).toHaveBeenCalledTimes(2);
    expect(getSalesProfitReport).toHaveBeenCalledTimes(2);
    expect(getSalesProfitReport.mock.calls[0][0]).toMatchObject({
      dateFrom: '2026-09-01T06:00:00.000Z',
      dateTo: '2026-09-08T06:00:00.000Z',
      scope: 'license',
      limit: 1,
      offset: 0
    });
    expect(dataset.metadata).toMatchObject({
      paginationComplete: true,
      detailComplete: true,
      costComplete: true,
      costStatus: 'estimated'
    });
    expect(dataset.metadata.products.map((product) => product.name)).toEqual(['A', 'B']);
  });

  it('exposes every eligible period product and explains why other products cannot be simulated', () => {
    const dataset = {
      metadata: {
        products: [
          { name: 'A', quantity: 2, netSales: 100, knownCost: 40, costKnown: true, costStatus: 'definitive' },
          { name: 'B', quantity: 1, netSales: 60, knownCost: 25, costKnown: true, costStatus: 'estimated' },
          { name: 'Sin ventas', quantity: 0, netSales: 0, knownCost: 0, costKnown: true },
          { name: 'Sin costo', quantity: 1, netSales: 20, knownCost: 0, costKnown: false }
        ]
      }
    };

    expect(buildSalesProfitabilityProductOptionsFromDataset(dataset).map((product) => product.name)).toEqual(['A', 'B']);
    expect(buildSalesProfitabilityProductExclusionsFromDataset(dataset)).toEqual([
      { name: 'Sin ventas', reason: 'sin ventas válidas o precio histórico suficiente' },
      { name: 'Sin costo', reason: 'sin costo unitario completo para simular utilidad y margen' }
    ]);
  });
});
