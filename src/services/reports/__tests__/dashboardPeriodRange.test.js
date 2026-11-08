import { describe, expect, it } from 'vitest';
import {
  CLOUD_STATS_PERIODS, buildCloudStatsRange, cloudReportMatchesRange, describeCloudStatsRange
} from '../dashboardPeriodRange';

describe('Períodos Dashboard Cloud', () => {
  const at = new Date(2026, 10, 8, 15, 30);

  it.each([['today', 8, 10], ['last7', 2, 10], ['last15', 25, 9], ['thisMonth', 1, 10]])('calcula %s por días completos locales', (key, day, month) => {
    const { dateFrom, dateTo } = buildCloudStatsRange(key, at);
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    expect(start.getDate()).toBe(day);
    expect(start.getMonth()).toBe(month);
    expect(start.getHours()).toBe(0);
    expect(end.getDate()).toBe(9);
    expect(end.getMonth()).toBe(10);
    expect(end.getHours()).toBe(0);
    expect(end.getMinutes()).toBe(0);
  });

  it('rechaza el rango diferente o ausente, nunca sustituye 30 días por Hoy', () => {
    const requested = buildCloudStatsRange('today', at);
    expect(cloudReportMatchesRange({ date_range: { date_from: requested.dateFrom, date_to: requested.dateTo } }, requested)).toBe(true);
    expect(cloudReportMatchesRange({ dateRange: { date_from: new Date(2026, 9, 1).toISOString(), date_to: requested.dateTo } }, requested)).toBe(false);
    expect(cloudReportMatchesRange({ success: true }, requested)).toBe(false);
    expect(describeCloudStatsRange(requested)).toContain('08/11/2026');
  });

  it('no presenta Total histórico en Cloud sin respaldo del RPC', () => {
    expect(CLOUD_STATS_PERIODS.map(({ key }) => key)).toEqual(['today', 'last7', 'last15', 'thisMonth']);
    expect(() => buildCloudStatsRange('all', at)).toThrow('DASHBOARD_PERIOD_UNSUPPORTED');
  });
});
