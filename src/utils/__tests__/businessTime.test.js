import { describe, expect, it } from 'vitest';
import {
  addBusinessCalendarDays,
  businessDateKeyToStart,
  formatBusinessInstant,
  getBusinessDateKey,
  startOfBusinessDay
} from '../businessTime';

describe('business time', () => {
  it.each([
    ['America/Merida', '2026-11-18T06:00:00.000Z'],
    ['UTC', '2026-11-18T00:00:00.000Z'],
    ['America/Tijuana', '2026-11-18T08:00:00.000Z']
  ])('starts a business calendar day in %s', (timeZone, expected) => {
    const value = new Date('2026-11-18T15:00:00.000Z');
    expect(startOfBusinessDay(value, timeZone).toISOString()).toBe(expected);
    expect(businessDateKeyToStart('2026-11-18', timeZone).toISOString()).toBe(expected);
  });

  it('uses calendar day boundaries across a daylight saving transition', () => {
    const start = businessDateKeyToStart('2026-03-08', 'America/New_York');
    const nextStart = addBusinessCalendarDays(start, 1, 'America/New_York');
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(nextStart.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(nextStart.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('formats one immutable instant using the configured business timezone', () => {
    const instant = '2026-11-18T09:30:00.000Z';
    const expected = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Merida' }).format(new Date(instant));
    expect(formatBusinessInstant(instant, 'America/Merida')).toBe(expected);
    expect(formatBusinessInstant(instant, 'not-a-timezone')).toBe(
      new Intl.DateTimeFormat('es-MX').format(new Date(instant))
    );
  });

  it('groups transaction instants under the business calendar date', () => {
    expect(getBusinessDateKey('2026-11-18T05:30:00.000Z', 'America/Merida')).toBe('2026-11-17');
    expect(getBusinessDateKey('2026-11-18T05:30:00.000Z', 'UTC')).toBe('2026-11-18');
  });
});
