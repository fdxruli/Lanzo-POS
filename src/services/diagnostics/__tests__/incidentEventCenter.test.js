import { afterEach, describe, expect, it } from 'vitest';
import {
  captureAsyncIncidentNotice,
  dismissAsyncIncidentNotice,
  getAsyncIncidentNotices,
  resetAsyncIncidentNoticesForTests,
  subscribeAsyncIncidentNotices
} from '../incidentEventCenter';

describe('incidentEventCenter', () => {
  afterEach(() => resetAsyncIncidentNoticesForTests());

  it('does not show ordinary warnings or unknown promise failures', () => {
    expect(captureAsyncIncidentNotice(new Error('background warning'), {
      source: 'console',
      now: 10
    })).toBeNull();
    expect(captureAsyncIncidentNotice(new Error('MetaMask extension unavailable'), {
      source: 'unhandledrejection',
      now: 11
    })).toBeNull();
    expect(getAsyncIncidentNotices()).toEqual([]);
  });

  it('shows only sanitized metadata for a relevant local database error', () => {
    const rawError = Object.assign(new Error('license_key=private-secret'), {
      code: 'DB_OPEN_TIMEOUT',
      stack: 'at /ventas/customer-123?access_token=hidden'
    });

    const notice = captureAsyncIncidentNotice(rawError, {
      source: 'unhandledrejection',
      pathname: '/ventas/customer-123?access_token=query-secret',
      online: false,
      now: 100
    });

    expect(notice.metadata).toMatchObject({
      code: 'DB_OPEN_TIMEOUT',
      category: 'indexeddb',
      section: 'No determinada',
      online: false,
      recoveryStatus: 'action_required'
    });
    expect(JSON.stringify(getAsyncIncidentNotices())).not.toMatch(
      /private-secret|customer-123|access_token|query-secret|hidden/
    );
  });

  it('deduplicates the same event briefly and notifies subscribers once', () => {
    const snapshots = [];
    const unsubscribe = subscribeAsyncIncidentNotices((next) => snapshots.push(next));
    const error = Object.assign(new Error('database blocked'), { code: 'DB_BLOCKED' });

    const first = captureAsyncIncidentNotice(error, {
      source: 'window.error',
      pathname: '/configuracion',
      now: 1_000
    });
    const duplicate = captureAsyncIncidentNotice(error, {
      source: 'window.error',
      pathname: '/configuracion',
      now: 10_000
    });

    expect(first).toBeTruthy();
    expect(duplicate).toBeNull();
    expect(snapshots).toHaveLength(1);
    unsubscribe();
  });

  it('deduplicates equivalent window and promise events from the same incident', () => {
    const error = Object.assign(new Error('IndexedDB blocked'), { code: 'DB_BLOCKED' });
    const first = captureAsyncIncidentNotice(error, {
      source: 'window.error',
      pathname: '/caja',
      now: 20_000
    });
    const duplicate = captureAsyncIncidentNotice(error, {
      source: 'unhandledrejection',
      pathname: '/caja',
      now: 20_250
    });

    expect(first).toBeTruthy();
    expect(duplicate).toBeNull();
  });

  it('marks only an explicitly ambiguous financial result as blocked', () => {
    const notice = captureAsyncIncidentNotice(
      Object.assign(new Error('payment outcome unknown'), { code: 'PAYMENT_OUTCOME_UNKNOWN' }),
      {
        source: 'unhandledrejection',
        pathname: '/caja',
        now: 1
      }
    );

    expect(notice).toMatchObject({
      critical: true,
      metadata: {
        category: 'financial_operation',
        severity: 'critical_blocker',
        recoveryStatus: 'blocked'
      }
    });
  });

  it('dismisses an in-memory notice without keeping its original error', () => {
    const notice = captureAsyncIncidentNotice(
      Object.assign(new Error('IndexedDB failed'), { code: 'DB_OPEN_TIMEOUT' }),
      { source: 'window.error', now: 500 }
    );

    dismissAsyncIncidentNotice(notice.correlationId);
    expect(getAsyncIncidentNotices()).toEqual([]);
  });
});
