import { describe, expect, it } from 'vitest';
import { projectDiagnosticEvent } from '../incidentDiagnostics';

describe('safe diagnostic console projection', () => {
  it.each(['log', 'info', 'debug', 'trace', 'table'])('keeps %s without error semantics', level => {
    expect(projectDiagnosticEvent(level, ['customer private text'])).toMatchObject({
      category: 'unclassified', code: 'CONSOLE_EVENT_UNCLASSIFIED',
      severity: 'unspecified', errorType: null, groupable: false
    });
    expect(projectDiagnosticEvent(level, []).text).not.toMatch(/Error|INCIDENT_UNKNOWN/);
  });

  it('keeps warnings distinct and does not infer a cause from operation context', () => {
    expect(projectDiagnosticEvent('warn', [{ diagnosticOperation: 'sync.pull' }])).toMatchObject({
      category: 'unclassified', severity: 'unspecified', code: 'CONSOLE_WARNING_UNCLASSIFIED'
    });
    const error = projectDiagnosticEvent('error', [new Error('private'), { diagnosticOperation: 'sync.pull' }]);
    expect(error).toMatchObject({ category: 'unknown', code: 'INCIDENT_UNKNOWN', groupable: false });
    expect(error.text).toContain('Causa no identificada');
    expect(error.text).toContain('Módulo: Sincronización · Operación: Pull incremental');
  });

  it.each(['FINANCIAL_RESULT_UNKNOWN', 'FINANCIAL_RESULT_PENDING', 'PAYMENT_OUTCOME_UNKNOWN', 'SALE_OUTCOME_UNKNOWN'])(
    'preserves the blocker for %s', code => {
      expect(projectDiagnosticEvent('error', [{ code }, { diagnosticOperation: 'pos.checkout' }])).toMatchObject({
        code, category: 'financial_operation', severity: 'critical_blocker', groupable: false
      });
    }
  );

  it('retains normalized severity and native Dexie failures without reading their payload', () => {
    const error = Object.assign(new Error('private tenant contents'), { name: 'TransactionInactiveError' });
    expect(projectDiagnosticEvent('error', [error])).toMatchObject({ category: 'indexeddb', errorType: 'TransactionInactiveError' });
    expect(projectDiagnosticEvent('warn', [{ category: 'synchronization', severity: 'recoverable', safeCode: 'SYNC_REQUEST_FAILED' }]))
      .toMatchObject({ category: 'synchronization', severity: 'recoverable' });
  });

  it('explains exact service evidence without attributing an unrelated timeout', () => {
    expect(projectDiagnosticEvent('error', [{ code: 'PGRST003' }]).evidence).toContain('pool de PostgREST');
    expect(projectDiagnosticEvent('error', [{ code: '57014' }]).evidence).toContain('no confirma por sí solo un timeout');
    expect(projectDiagnosticEvent('error', [new Error('private unknown')]).evidence).toBe('');
    expect(projectDiagnosticEvent('warn', [{ code: 'DB_OPERATION_FAILED', diagnosticOperation: 'db.operation' }]).groupable).toBe(false);
  });

  it('accepts only closed operation/state vocabulary and ignores malicious getters', () => {
    const getter = () => { throw new Error('getter invoked'); };
    const hostile = Object.defineProperties({}, {
      diagnosticOperation: { get: getter }, diagnosticState: { get: getter }
    });
    expect(() => projectDiagnosticEvent('info', [hostile])).not.toThrow();
    const event = projectDiagnosticEvent('info', [{
      diagnosticOperation: 'sync.status', diagnosticState: 'degraded',
      token: 'private', amount: 12345, payload: { customer: 'private' }
    }]);
    expect(event.text).toContain('Estado: Degradado');
    expect(JSON.stringify(event)).not.toMatch(/private|12345|token|payload/);
    expect(projectDiagnosticEvent('info', [{ diagnosticOperation: '__proto__', diagnosticState: 'private' }]).operation).toBe('');
  });
});
