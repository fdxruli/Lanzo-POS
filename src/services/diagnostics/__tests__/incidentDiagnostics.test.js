import { describe, expect, it } from 'vitest';
import {
  buildSafeIncidentReport,
  classifyIncident,
  INCIDENT_CATEGORY,
  INCIDENT_SEVERITY,
  summarizeDiagnosticEvent
} from '../incidentDiagnostics';

describe('incident diagnostics', () => {
  it('keeps severity independent from category and does not make unknown errors critical', () => {
    expect(classifyIncident(new Error('unexpected'), { source: 'react' })).toMatchObject({
      category: INCIDENT_CATEGORY.REACT_RENDER,
      severity: INCIDENT_SEVERITY.SECTION_FAILURE
    });
    expect(classifyIncident(new Error('unclassified')).severity)
      .toBe(INCIDENT_SEVERITY.SECTION_FAILURE);
    expect(classifyIncident(new Error('result pending'), {
      category: INCIDENT_CATEGORY.FINANCIAL_OPERATION,
      financialOutcome: 'unknown'
    })).toMatchObject({
      category: INCIDENT_CATEGORY.FINANCIAL_OPERATION,
      severity: INCIDENT_SEVERITY.CRITICAL_BLOCKER
    });
    expect(classifyIncident(Object.assign(new Error('receipt check required'), {
      code: 'FINANCIAL_RESULT_UNKNOWN'
    })).severity).toBe(INCIDENT_SEVERITY.CRITICAL_BLOCKER);
    expect(classifyIncident(Object.assign(new Error('unknown failure'), {
      code: 'UNKNOWN_ERROR'
    })).severity).not.toBe(INCIDENT_SEVERITY.CRITICAL_BLOCKER);
  });

  it('classifies supported operational areas without exposing error text', () => {
    expect(classifyIncident(Object.assign(new Error('Failed to fetch dynamically imported module'), {
      name: 'ChunkLoadError'
    })).category).toBe(INCIDENT_CATEGORY.NAVIGATION_RESOURCE);
    expect(classifyIncident(Object.assign(new Error('blocked'), { code: 'DB_BLOCKED' })).category)
      .toBe(INCIDENT_CATEGORY.INDEXEDDB);
    expect(classifyIncident(Object.assign(new Error('rejected'), { code: 'PGRST202' })).category)
      .toBe(INCIDENT_CATEGORY.SUPABASE_RPC);
    expect(classifyIncident(Object.assign(new Error('offline'), { code: 'SYNC_REQUEST_FAILED' })).category)
      .toBe(INCIDENT_CATEGORY.SYNCHRONIZATION);
    expect(classifyIncident(new Error('a React render failed'), { source: 'react' }).category)
      .toBe(INCIDENT_CATEGORY.REACT_RENDER);
    expect(classifyIncident(Object.assign(new Error('missing'), { code: 'ACTOR_CONTEXT_STALE' })).category)
      .toBe(INCIDENT_CATEGORY.AUTHORIZATION_SESSION);
    expect(classifyIncident(new Error('service worker update failed')).category)
      .toBe(INCIDENT_CATEGORY.PWA);
    expect(classifyIncident(new Error('connection timeout')).category)
      .toBe(INCIDENT_CATEGORY.CONNECTIVITY);
    expect(classifyIncident(new Error('unmapped condition')).category)
      .toBe(INCIDENT_CATEGORY.UNKNOWN);
    expect(classifyIncident(Object.assign(new Error('unknown'), { code: 'CHUNK_LOAD_FAILED' })).severity)
      .toBe(INCIDENT_SEVERITY.RECOVERABLE);
    expect(classifyIncident(Object.assign(new Error('unknown'), { code: 'FINANCIAL_RESULT_PENDING' })).severity)
      .toBe(INCIDENT_SEVERITY.CRITICAL_BLOCKER);
  });

  it('bounds and validates report metadata supplied by the environment', () => {
    const report = buildSafeIncidentReport(new Error('private detail'), {}, {
      pathname: `/ventas/${'customer-secret/'.repeat(100)}?token=url-secret`,
      appVersion: 'version-with-untrusted-field-token',
      buildCommit: 'license-secret-'.repeat(20),
      userAgent: 'Chrome/126 customer-device-id'.repeat(20),
      online: true,
      now: 'invalid timestamp'
    });

    expect(report).toContain('Sección: /ventas');
    expect(report).toContain('Versión de Lanzo: No disponible');
    expect(report).toContain('Commit: No disponible');
    expect(report).toContain('Navegador: Chrome 126');
    expect(report).not.toContain('customer-secret');
    expect(report).not.toContain('url-secret');
    expect(report).not.toContain('customer-device-id');
    expect(report).not.toContain('license-secret');
    expect(report.length).toBeLessThan(1_500);
  });

  it('builds bounded reports without secrets, customer data, financial values, or URL parameters', () => {
    const error = new TypeError('license_key=LNZ-FULL-SECRET token=jwt-secret customer=Ana Lopez total=9876.50');
    error.code = 'DB_OPEN_TIMEOUT';
    error.cause = new Error('email=ana@example.com phone=5551234567');
    error.stack = 'TypeError: https://lanzo.test/ventas?access_token=secret\n at /private/path';

    const report = buildSafeIncidentReport(error, { source: 'react' }, {
      pathname: '/clientes/Ana-Lopez?access_token=secret&license=LNZ-FULL-SECRET',
      appVersion: '4.2.1',
      buildCommit: 'abcdef1234567',
      userAgent: 'Mozilla/5.0 Chrome/126.1.1.1',
      online: false,
      now: new Date('2026-10-14T20:00:00.000Z')
    });

    expect(report).toContain('Código de incidencia: DB_OPEN_TIMEOUT');
    expect(report).toContain('Clasificación: Almacenamiento local');
    expect(report).toContain('Gravedad: section_failure');
    expect(report).toContain('Sección: /clientes');
    expect(report).toContain('Navegador: Chrome 126');
    expect(report).toContain('Conectividad: Offline');
    expect(report).not.toContain('LNZ-FULL-SECRET');
    expect(report).not.toContain('jwt-secret');
    expect(report).not.toContain('Ana-Lopez');
    expect(report).not.toContain('Ana Lopez');
    expect(report).not.toContain('ana@example.com');
    expect(report).not.toContain('5551234567');
    expect(report).not.toContain('9876.50');
    expect(report).not.toContain('access_token');
    expect(report).not.toContain('/private/path');
  });

  it('stores only a technical summary in the in-app console', () => {
    const summary = summarizeDiagnosticEvent('error', [
      '[Caja] Error al cobrar',
      Object.assign(new Error('token=secret total=1000'), { code: 'FINANCIAL_RESULT_UNKNOWN' })
    ]);

    expect(summary).toContain('Detalle omitido por privacidad');
    expect(summary).not.toContain('[Caja]');
    expect(summary).not.toContain('token=secret');
    expect(summary).not.toContain('1000');
  });
});
