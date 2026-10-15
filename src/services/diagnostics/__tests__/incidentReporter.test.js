import { describe, expect, it, vi } from 'vitest';
import {
  captureBackendIncident,
  createIncidentReporter,
  createIncidentReportPayload,
  formatIncidentDiagnostic,
  INCIDENT_REPORT_STATUS,
  normalizeBackendError,
  resetIncidentReporterForTests
} from '../incidentReporter';

const makeUuidFactory = () => {
  let value = 0;
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}`;
};

const createTestReporter = ({ transport = vi.fn(), online = true } = {}) => {
  const clock = 1_000;
  return createIncidentReporter({
    environment: () => ({
      pathname: '/caja/venta-cliente?token=route-secret',
      online,
      appVersion: '4.2.1',
      buildCommit: 'abcdef1234567',
      userAgent: 'Mozilla/5.0 Chrome/126.1',
      now: new Date('2026-10-15T12:00:00.000Z')
    }),
    transport,
    now: () => clock,
    idFactory: makeUuidFactory()
  });
};

describe('incidentReporter', () => {
  it('captures a React exception as an allowlisted report without raw error data', () => {
    const reporter = createTestReporter();
    const error = Object.assign(new TypeError('token=very-secret customer=Ana'), {
      stack: 'at /ventas/private?access_token=stack-secret'
    });
    const incident = reporter.capture(error, { source: 'react', pathname: '/pedidos/123?secret=q' });
    const payload = reporter.prepare(incident);

    expect(payload).toMatchObject({
      schema_version: 1,
      category: 'react_render',
      severity: 'section_failure',
      safe_code: 'INCIDENT_REACT_RENDER',
      safe_route: '/pedidos',
      module: 'pedidos'
    });
    expect(JSON.stringify(payload)).not.toMatch(/very-secret|Ana|stack-secret|access_token|route-secret|\/pedidos\/123/);
    expect(payload.incident_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(payload.correlation_id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('normalizes lazy navigation and resource failures as recoverable', () => {
    const reporter = createTestReporter();
    const incident = reporter.capture(Object.assign(new Error('Failed to load chunk'), {
      code: 'CHUNK_LOAD_FAILED'
    }), { source: 'navigation_resource', category: 'navigation_resource' });
    expect(incident).toMatchObject({ category: 'navigation_resource', severity: 'recoverable' });
  });

  it('does not turn warnings or expected business rejections into incidents', () => {
    const reporter = createTestReporter();
    expect(reporter.capture(new Error('ordinary warning'), { level: 'warn' })).toBeNull();
    expect(reporter.capture(Object.assign(new Error('not allowed'), { code: 'PERMISSION_DENIED' }), {
      source: 'backend_service'
    })).toBeNull();
    expect(normalizeBackendError({ code: 'VALIDATION_INVALID_PRICE', status: 400 }).expectedBusiness).toBe(true);
  });

  it('offers an explicit backend capture adapter while excluding expected SQL permissions', () => {
    const incident = captureBackendIncident(Object.assign(new Error('RPC unavailable'), {
      code: 'PGRST444'
    }), { category: 'supabase_rpc' });
    expect(incident).toMatchObject({ category: 'supabase_rpc', source: 'backend_service' });
    expect(captureBackendIncident(Object.assign(new Error('permission denied'), {
      code: '42501'
    }), { category: 'authorization_session' })).toBeNull();
    resetIncidentReporterForTests();
  });

  it('normalizes RPC, authorization, IndexedDB, connectivity, sync, and ambiguous financial failures', () => {
    expect(normalizeBackendError({ code: 'PGRST202' })).toMatchObject({
      category: 'supabase_rpc', failureKind: 'service_failure'
    });
    expect(normalizeBackendError({ code: 'DEVICE_TOKEN_EXPIRED', status: 403 })).toMatchObject({
      category: 'authorization_session', failureKind: 'authorization'
    });
    expect(normalizeBackendError({ code: 'NETWORK_TIMEOUT', status: 408 })).toMatchObject({
      category: 'connectivity', failureKind: 'transient_connectivity'
    });
    expect(normalizeBackendError({ code: '23505', status: 409 })).toMatchObject({
      failureKind: 'integrity', expectedBusiness: false
    });
    expect(normalizeBackendError({ code: 'SYNC_PULL_FAILED' }).category).toBe('synchronization');
    expect(normalizeBackendError({ code: 'PAYMENT_OUTCOME_UNKNOWN' })).toMatchObject({
      category: 'financial_operation',
      severity: 'critical_blocker',
      failureKind: 'financial_outcome_ambiguous'
    });
    expect(normalizeBackendError({ code: 'PGRST202' }).safeCode).toBe('PGRST202');
  });

  it('keeps authorization credentials and storage contents out of payloads and copies', () => {
    const reporter = createTestReporter();
    const incident = reporter.capture(Object.assign(new Error(
      'license_key=LNZO-SECRET password=pw cookie=cookie-value customer=Ana total=99.90'
    ), {
      code: 'DEVICE_TOKEN_EXPIRED',
      stack: 'IndexedDB customer record body'
    }), {
      source: 'backend_service',
      status: 403,
      pathname: '/clientes/Ana?jwt=secret'
    });
    const payload = reporter.prepare(incident);
    const copy = formatIncidentDiagnostic(incident);

    expect(payload.safe_code).toBe('INCIDENT_AUTHORIZATION_SESSION');
    expect(JSON.stringify(payload) + copy).not.toMatch(/LNZO-SECRET|pw|cookie-value|Ana|99\.90|record body|jwt=secret/);
  });

  it('deduplicates equivalent incidents briefly and separates them after the window', () => {
    let clock = 10_000;
    const reporter = createIncidentReporter({
      environment: { pathname: '/caja', online: true },
      now: () => clock,
      idFactory: makeUuidFactory()
    });
    const error = Object.assign(new Error('DB blocked'), { code: 'DB_BLOCKED' });
    const first = reporter.capture(error, { source: 'indexeddb' });
    clock += 1_000;
    const duplicate = reporter.capture(error, { source: 'indexeddb' });
    clock += 31_000;
    const later = reporter.capture(error, { source: 'indexeddb' });

    expect(duplicate).toMatchObject({ incident_id: first.incident_id, deduplicated: true });
    expect(later.incident_id).not.toBe(first.incident_id);
  });

  it('provides an offline diagnostic without calling the transport', async () => {
    const transport = vi.fn();
    const reporter = createTestReporter({ transport, online: false });
    const incident = reporter.capture(Object.assign(new Error('blocked'), { code: 'DB_BLOCKED' }), {
      source: 'indexeddb'
    });

    const result = await reporter.submit(incident, { consent: true, licenseDetails: { plan: 'free' } });
    expect(result).toEqual({ status: INCIDENT_REPORT_STATUS.OFFLINE, code: 'INCIDENT_REPORT_OFFLINE' });
    expect(transport).not.toHaveBeenCalled();
    expect(reporter.format(incident)).toContain('"schema_version": 1');
  });

  it('returns the backend authorization rejection without treating it as a receipt', async () => {
    const transport = vi.fn().mockResolvedValue({
      success: false,
      code: 'INCIDENT_REPORT_AUTHORIZATION_FAILED'
    });
    const reporter = createTestReporter({ transport });
    const incident = reporter.capture(new Error('report attempt'), { source: 'react' });
    const result = await reporter.submit(incident, { consent: true });

    expect(result).toEqual({
      status: INCIDENT_REPORT_STATUS.FAILED,
      code: 'INCIDENT_REPORT_AUTHORIZATION_FAILED'
    });
    expect(result).not.toHaveProperty('reportReference');
  });

  it('requires consent, a current tenant context, and server receipt before showing sent', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce({ success: true, report_reference: 'IR-0011223344556677' })
      .mockResolvedValueOnce({ success: true, report_reference: 'not-a-server-folio' })
      .mockResolvedValueOnce({ status: 'sent' });
    const reporter = createTestReporter({ transport });
    const incident = reporter.capture(Object.assign(new Error('failed'), { code: 'PGRST202' }), {
      source: 'backend_service'
    });

    expect(await reporter.submit(incident)).toMatchObject({
      status: INCIDENT_REPORT_STATUS.READY,
      code: 'INCIDENT_REPORT_CONSENT_REQUIRED'
    });
    expect(await reporter.submit(incident, { consent: true, isContextCurrent: () => false }))
      .toMatchObject({ status: INCIDENT_REPORT_STATUS.FAILED, code: 'INCIDENT_REPORT_CONTEXT_CHANGED' });
    expect(transport).not.toHaveBeenCalled();
    expect(await reporter.submit(incident, { consent: true, licenseDetails: { plan: 'free' } }))
      .toMatchObject({ status: INCIDENT_REPORT_STATUS.SENT, reportReference: 'IR-0011223344556677' });
    expect(await reporter.submit(incident, { consent: true }))
      .toMatchObject({ status: INCIDENT_REPORT_STATUS.FAILED });
    expect(await reporter.submit(incident, { consent: true }))
      .toMatchObject({ status: INCIDENT_REPORT_STATUS.FAILED });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('keeps the same incident ID for retry idempotency and does not require a PRO plan', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce({ success: false, code: 'INCIDENT_REPORT_DELIVERY_FAILED' })
      .mockResolvedValueOnce({ success: true, report_reference: 'IR-ABCDEF0011223344' });
    const reporter = createTestReporter({ transport });
    const incident = reporter.capture(Object.assign(new Error('timeout'), { code: 'NETWORK_TIMEOUT' }), {
      source: 'backend_service'
    });

    await reporter.submit(incident, { consent: true, licenseDetails: { plan: 'free' } });
    await reporter.submit(incident, { consent: true, licenseDetails: { plan: 'free' } });
    expect(transport.mock.calls[0][0].payload.incident_id)
      .toBe(transport.mock.calls[1][0].payload.incident_id);
    expect(transport.mock.calls[0][0].payload).not.toHaveProperty('plan');
  });

  it('rejects long descriptions and bounded payload preparation', () => {
    const reporter = createTestReporter();
    const incident = reporter.capture(new Error('safe'), { source: 'react' });
    expect(() => createIncidentReportPayload(incident, 'x'.repeat(501)))
      .toThrowError(expect.objectContaining({ code: 'INCIDENT_DESCRIPTION_TOO_LONG' }));
    expect(reporter.prepare(incident)).toEqual(expect.objectContaining({ user_description: null }));
  });

  it('keeps reporter failures isolated and classifies ambiguous finance without invoking payment APIs', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('token=secret backend down'));
    const reporter = createTestReporter({ transport });
    const incident = reporter.capture(Object.assign(new Error('unknown'), {
      code: 'PAYMENT_OUTCOME_UNKNOWN'
    }), { source: 'backend_service' });
    const result = await reporter.submit(incident, { consent: true });

    expect(incident).toMatchObject({ category: 'financial_operation', severity: 'critical_blocker' });
    expect(result.status).toBe(INCIDENT_REPORT_STATUS.FAILED);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not persist reports into IndexedDB or a commercial outbox', () => {
    const reporterSource = String(createIncidentReporter);
    expect(reporterSource).not.toMatch(/indexedDB|Dexie|outbox|localStorage|sessionStorage/i);
    expect(reporterSource).not.toMatch(/charge|createSale|processPayment|cashMovement/i);
  });
});
