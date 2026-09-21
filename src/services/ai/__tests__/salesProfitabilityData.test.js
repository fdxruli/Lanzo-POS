import { describe, expect, it, vi } from 'vitest';
import {
  addCalendarDays,
  buildSalesProfitabilityDataset,
  buildSalesProfitabilityQueryRange,
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
});
