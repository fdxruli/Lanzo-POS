import { describe, expect, it } from 'vitest';
import {
  addBusinessCalendarDays,
  assertLayawayPaymentAllowed,
  getBusinessCalendarDate,
  getLayawayCalendarDate,
  isLayawayDeadlineOverdue,
  isLayawayOverdueForDisplay,
  isValidBusinessTimezone
} from '../layawayCalendar';

const sample = { status: 'active', deadline: '2026-11-15', totalAmount: 1000, paidAmount: 200 };
describe('Apartados: calendario del negocio, sin UTC ni teléfono', () => {
  it('reconoce la fecha civil UTC codificada por Cloud sin desplazarla', () => {
    expect(getLayawayCalendarDate('2026-11-15T00:00:00+00:00')).toBe('2026-11-15');
    expect(getLayawayCalendarDate('2026-02-30')).toBeNull();
    expect(getLayawayCalendarDate('')).toBeNull();
  });

  it('usa la zona IANA, con día completo hasta medianoche local', () => {
    const zone = 'America/Merida';
    expect(isValidBusinessTimezone(zone)).toBe(true);
    expect(getBusinessCalendarDate(zone, new Date('2026-11-16T05:59:59Z'))).toBe('2026-11-15');
    expect(isLayawayDeadlineOverdue(sample.deadline, zone, new Date('2026-11-16T05:59:59Z'))).toBe(false);
    expect(isLayawayDeadlineOverdue(sample.deadline, zone, new Date('2026-11-16T06:00:01Z'))).toBe(true);
    expect(addBusinessCalendarDays('2026-11-12', 30)).toBe('2026-12-12');
  });

  it('permite el último día y bloquea vencido o terminal con zona confirmada', () => {
    expect(() => assertLayawayPaymentAllowed(sample, 'America/Merida', new Date('2026-11-16T05:59:00Z'))).not.toThrow();
    expect(() => assertLayawayPaymentAllowed(sample, 'America/Merida', new Date('2026-11-16T06:01:00Z'))).toThrow(/vencido/);
    expect(() => assertLayawayPaymentAllowed(sample, null)).not.toThrow();
    expect(() => assertLayawayPaymentAllowed({ ...sample, deadline: '2026-02-30' }, 'America/Merida'))
      .toThrow(/fecha límite/);
    expect(() => assertLayawayPaymentAllowed({ ...sample, status: 'cancelled' }, 'America/Merida')).toThrow(/no admite/);
    expect(() => assertLayawayPaymentAllowed({ ...sample, status: 'ready', paidAmount: 1000 }, 'America/Merida')).toThrow(/no admite/);
  });

  it('ningún huso se infiere silenciosamente', () => {
    expect(isValidBusinessTimezone('')).toBe(false);
    expect(isValidBusinessTimezone('America/Fake_City')).toBe(false);
    expect(isLayawayDeadlineOverdue('2026-11-15', null)).toBeNull();
  });
  it('sin zona mantiene la comparación local de presentación anterior, no una autoridad Cloud', () => {
    const localNoon = new Date(2026, 10, 16, 12);
    expect(isLayawayOverdueForDisplay('2026-11-15', null, localNoon)).toBe(true);
    expect(isLayawayOverdueForDisplay('2026-11-16', null, localNoon)).toBe(false);
    expect(isLayawayOverdueForDisplay('2026-11-15', 'America/Merida', new Date('2026-11-16T05:59:00Z'))).toBe(false);
    expect(isLayawayDeadlineOverdue('2026-11-15', null)).toBeNull();
  });
});
