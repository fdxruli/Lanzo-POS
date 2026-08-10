import { describe, expect, it } from 'vitest';
import { getDaysUntilBatchExpiry } from '../../services/products/fefoUtils';
import { extractCalendarDate } from '../dateUtils';
import { calculateShelfLifeTargetDate } from '../expirationPolicy';

const localDate = (hour = 12, minute = 0) => new Date(2026, 7, 9, hour, minute, 0);

describe('calculateShelfLifeTargetDate', () => {
  it('adds days as calendar days and preserves the matching expiry countdown', () => {
    const target = calculateShelfLifeTargetDate({
      baseDate: localDate(),
      shelfLifeValue: 5,
      shelfLifeUnit: 'days'
    });

    expect(extractCalendarDate(target)).toBe('2026-08-14');
    expect(getDaysUntilBatchExpiry({ expiryDate: target }, localDate())).toBe(5);
  });

  it('adds weeks explicitly as seven calendar days each', () => {
    const oneWeek = calculateShelfLifeTargetDate({
      baseDate: localDate(),
      shelfLifeValue: 1,
      shelfLifeUnit: 'weeks'
    });
    const twoWeeks = calculateShelfLifeTargetDate({
      baseDate: localDate(),
      shelfLifeValue: 2,
      shelfLifeUnit: 'weeks'
    });

    expect(extractCalendarDate(oneWeek)).toBe('2026-08-16');
    expect(getDaysUntilBatchExpiry({ expiryDate: oneWeek }, localDate())).toBe(7);
    expect(extractCalendarDate(twoWeeks)).toBe('2026-08-23');
    expect(getDaysUntilBatchExpiry({ expiryDate: twoWeeks }, localDate())).toBe(14);
  });

  it('does not move a late local date to the following calendar day when serialized', () => {
    const target = calculateShelfLifeTargetDate({
      baseDate: localDate(23, 59),
      shelfLifeValue: 5,
      shelfLifeUnit: 'days'
    });

    expect(target).toBe('2026-08-14T00:00:00.000Z');
    expect(getDaysUntilBatchExpiry({ expiryDate: target }, localDate(23, 59))).toBe(5);
  });
});
