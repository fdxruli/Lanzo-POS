import { describe, expect, it } from 'vitest';
import {
  businessLocalDateTimeToIso,
  formatBusinessTime,
  getAvailabilityDetail,
  getAvailabilityLabel,
  getAvailabilityRefreshDelay
} from '../ecommerceAvailability';

describe('ecommerceAvailability', () => {
  it('formats the same instant in the business timezone, not the device timezone', () => {
    const instant = '2026-07-15T03:00:00.000Z';
    expect(formatBusinessTime(instant, 'America/Mexico_City')).toBe('9:00 p.m.');
    expect(formatBusinessTime(instant, 'America/Tijuana')).toBe('8:00 p.m.');
  });

  it('produces accessible Spanish copy for open, closed and paused states', () => {
    expect(getAvailabilityLabel({ code: 'OPEN', acceptingOrders: true })).toBe('Abierto');
    expect(getAvailabilityDetail({
      code: 'OUTSIDE_BUSINESS_HOURS',
      acceptingOrders: false,
      timezone: 'America/Mexico_City',
      localDate: '2026-07-14',
      nextOpenAt: '2026-07-15T15:00:00.000Z'
    })).toContain('mañana');
    expect(getAvailabilityDetail({ code: 'ORDERS_PAUSED', pauseUntil: '' }))
      .toContain('manualmente');
  });

  it('converts a business wall time and schedules refresh without real Date dependence', () => {
    expect(businessLocalDateTimeToIso('2026-07-14T21:00', 'America/Mexico_City'))
      .toBe('2026-07-15T03:00:00.000Z');
    expect(getAvailabilityRefreshDelay(
      { nextChangeAt: '2026-07-15T03:00:10.000Z' },
      { now: Date.parse('2026-07-15T03:00:00.000Z'), fallbackMs: 60_000 }
    )).toBe(10_500);
  });
});
