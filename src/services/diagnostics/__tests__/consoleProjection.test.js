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
  it('preserves an unknown TypeError, actual stack and an absent stack', () => {
    const error = new TypeError('exact technical message');
    Object.defineProperty(error, 'stack', { value: 'TypeError: exact technical message\\n    at test.js:1:2' });
    const entry = projectDiagnosticEvent('error', [error]);
    expect(entry).toMatchObject({ category: 'unknown', code: 'INCIDENT_UNKNOWN', errorType: 'TypeError' });
    expect(entry.technical).toMatchObject({ name: 'TypeError', message: 'exact technical message', stack: error.stack });
    const withoutStack = new RangeError('no stack supplied');
    Object.defineProperty(withoutStack, 'stack', { value: undefined });
    expect(projectDiagnosticEvent('error', [withoutStack]).technical.stack).toBe('');
  });

  it('retains an uncatalogued PostgREST SQLSTATE, original message, hint and status', () => {
    const entry = projectDiagnosticEvent('error', [{
      code: '42703', message: 'column does not exist', details: null,
      hint: 'Check the field name', status: 400
    }]);
    expect(entry.code).toBe('INCIDENT_SUPABASE_RPC');
    expect(entry.technical).toMatchObject({
      code: '42703', message: 'column does not exist', hint: 'Check the field name', status: 400
    });
    expect(entry.text).not.toContain('column does not exist');
  });

  it('ignores hostile getters and application payloads', () => {
    const error = new Error('trusted message');
    Object.defineProperties(error, {
      stack: { get() { throw new Error('stack getter executed'); } },
      code: { get() { throw new Error('code getter executed'); } },
      cause: { value: { customer: 'PRIVATE_CUSTOMER' } }
    });
    const entry = projectDiagnosticEvent('error', [error, { amount: 123456, customer: 'PRIVATE_CUSTOMER' }]);
    expect(entry.technical.message).toBe('trusted message');
    expect(entry.technical.stack).toBe('');
    expect(JSON.stringify(entry)).not.toContain('PRIVATE_CUSTOMER');
    expect(JSON.stringify(entry)).not.toContain('123456');
  });

  it('preserves native DOMException fields without invoking application getters', () => {
    const entry = projectDiagnosticEvent('error', [new DOMException('native exception details', 'NotAllowedError')]);
    expect(entry.technical).toMatchObject({ name: 'NotAllowedError', message: 'native exception details' });
  });

  it('keeps global locations and rejection strings without exposing log strings', () => {
    expect(projectDiagnosticEvent('error', ['rejection reason'], 'unhandledrejection').technical.message)
      .toBe('rejection reason');
    const event = projectDiagnosticEvent('error', ['script problem'], 'window.error', {
      filename: 'https://host.invalid/app.js?token=SECRET', line: 22, column: 9
    });
    expect(event.technical).toMatchObject({
      message: 'script problem', filename: 'https://host.invalid/app.js', line: 22, column: 9
    });
    expect(JSON.stringify(event)).not.toContain('SECRET');
    expect(projectDiagnosticEvent('error', ['customer-only log'], 'console').technical).toBeNull();
  });
});
