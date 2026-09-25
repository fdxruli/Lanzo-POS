import { describe, expect, it } from 'vitest';
import { mapEdgeErrorMessage, normalizeUsageStatus } from '../../aiService';

describe('AI Edge error mapping', () => {
  it('gives an actionable message for an invalid commercial request without echoing payload details', () => {
    expect(mapEdgeErrorMessage({
      code: 'INVALID_REQUEST',
      message: 'secret context should not be shown'
    })).toBe('No pudimos procesar esta consulta. Revisa las opciones seleccionadas e inténtalo nuevamente.');
  });

  it('preserves finite usage counters without inventing values', () => {
    expect(normalizeUsageStatus({ limit: 15, used: 4, remaining: 11, period_end: '2026-10-01T00:00:00Z' })).toMatchObject({
      limit: 15,
      used: 4,
      remaining: 11,
      isUnlimited: false,
      isLimitConfigured: true,
      isLimitReached: false
    });
  });

  it('does not render missing or unlimited limits as misleading 0 / 0 values', () => {
    expect(normalizeUsageStatus({ used: 3 })).toMatchObject({
      limit: null,
      used: 3,
      remaining: null,
      isUnlimited: false,
      isLimitConfigured: false
    });
    expect(normalizeUsageStatus({ limit: null, used: 8 })).toMatchObject({
      limit: null,
      used: 8,
      remaining: null,
      isUnlimited: true,
      isLimitConfigured: false,
      isLimitReached: false
    });
  });
});
