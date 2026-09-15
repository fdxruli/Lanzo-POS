// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GLOBAL_ALERT,
  getGlobalAlertStorageKey,
  isGlobalAlertEligible,
} from '../botContext';

const publishedAt = '2026-03-11T04:38:42.000Z';
const beforePublication = {
  license_key: 'OLD-LICENSE',
  created_at: '2026-03-01T12:00:00.000Z',
};

const alert = (overrides = {}) => ({
  ...GLOBAL_ALERT,
  active: true,
  publishedAt,
  expiresAt: '2026-04-01T00:00:00.000Z',
  ...overrides,
});

describe('isGlobalAlertEligible', () => {
  const now = new Date('2026-03-20T12:00:00.000Z').getTime();

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('retires the current historical alert without removing its metadata or eligibility infrastructure', () => {
    expect(GLOBAL_ALERT).toMatchObject({
      id: 'update_soporte_07',
      active: false,
      publishedAt,
      expiresAt: null,
    });
    expect(isGlobalAlertEligible(GLOBAL_ALERT, {
      licenseDetails: beforePublication,
      now: new Date('2026-09-14T12:00:00.000Z').getTime(),
    })).toBe(false);
  });

  it('shows an active, unseen, unexpired alert to a license created before publication', () => {
    expect(isGlobalAlertEligible(alert(), {
      licenseDetails: beforePublication,
      now,
    })).toBe(true);
  });

  it('does not show the alert to a license created after publication', () => {
    expect(isGlobalAlertEligible(alert(), {
      licenseDetails: { created_at: '2026-03-12T00:00:00.000Z' },
      now,
    })).toBe(false);
  });

  it.each([
    [{ acknowledged: true }, 'acknowledged'],
    [{ now: new Date('2026-04-01T00:00:00.000Z').getTime() }, 'expired'],
    [{ alert: { ...alert(), active: false } }, 'inactive'],
    [{ licenseDetails: { license_key: 'LEGACY-WITHOUT-DATE' } }, 'missing license metadata'],
    [{ alert: { ...alert(), publishedAt: undefined } }, 'missing publication metadata'],
  ])('fails closed when the alert is %s', (overrides) => {
    const candidate = overrides.alert || alert();
    expect(isGlobalAlertEligible(candidate, {
      licenseDetails: overrides.licenseDetails || beforePublication,
      acknowledged: overrides.acknowledged || false,
      now: overrides.now || now,
    })).toBe(false);
  });

  it('keeps the legacy acknowledgement key scoped to the alert id without reading localStorage at module import', () => {
    expect(getGlobalAlertStorageKey(alert())).toBe('lanzo_alert_update_soporte_07');
    localStorage.setItem('lanzo_license', JSON.stringify({ license_key: 'NEW-LICENSE' }));

    expect(isGlobalAlertEligible(alert(), {
      licenseDetails: beforePublication,
      now,
    })).toBe(true);
  });
});
