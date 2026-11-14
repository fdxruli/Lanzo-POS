import { describe, expect, it } from 'vitest';
import { prepareDevConsoleExport, redactDevConsoleExport } from '../diagnostics/devConsoleExport';

const entry = (technical, overrides = {}) => ({
  timestamp: '2026-11-14T15:43:17.979Z',
  level: 'error',
  source: 'console',
  code: 'INCIDENT_UNKNOWN',
  category: 'unknown',
  severity: 'section_failure',
  text: 'Error inesperado · Causa no identificada · INCIDENT_UNKNOWN · TypeError',
  count: 1,
  technical,
  ...overrides
});

describe('reviewed diagnostic export', () => {
  it('keeps TypeError, stack indentation, PostgREST and browser details for review', () => {
    const typeError = Object.freeze({
      name: 'TypeError', code: '', message: 'LANZO_QA_STAGE2_EXPORT',
      stack: 'TypeError: LANZO_QA_STAGE2_EXPORT\n    at checkout (src/checkout.js:42:9)',
      details: '', hint: '', status: null, filename: '', line: null, column: null
    });
    const postgrest = Object.freeze({
      name: 'PostgREST', code: 'PGRST202', message: 'Function not found',
      stack: '', details: 'Missing signature', hint: 'Reload schema cache',
      status: 404, filename: '', line: null, column: null
    });
    const browser = { name: 'Error', message: 'Failed loading asset',
      filename: 'https://lanzo.test/assets/app.js', line: 17, column: 4, resourceError: true
    };
    const report = prepareDevConsoleExport([
      entry(typeError),
      entry(postgrest, { source: 'unhandledrejection', code: 'PGRST202' }),
      entry(browser, { source: 'window.error' })
    ]);
    expect(report).toMatchObject({ included: 3, omitted: 0 });
    expect(report.text).toContain('LANZO_QA_STAGE2_EXPORT');
    expect(report.text).toContain('    at checkout (src/checkout.js:42:9)');
    expect(report.text).toContain('Clasificación LANZO: INCIDENT_UNKNOWN');
    expect(report.text).toContain('Detalles PostgREST:\nMissing signature');
    expect(report.text).toContain('Hint PostgREST:\nReload schema cache');
    expect(report.text).toContain('HTTP: 404');
    expect(report.text).toContain('Línea: 17');
    expect(report.text).toContain('Columna: 4');
    expect(report.text.indexOf('PGRST202')).toBeGreaterThan(report.text.indexOf('LANZO_QA_STAGE2_EXPORT'));
  });

  it('redacts synthetic credentials and identities without erasing source line and function', () => {
    const synthetic = [
      'TypeError: LANZO_QA_STAGE2_EXPORT',
      'at checkout (app.js:45:8)',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.signature123',
      'refresh_token=refresh-secret-123',
      'password: "long synthetic password"',
      'apikey=some-api-secret-value',
      'https://user:pass@lanzo.test/api/orders?access_token=param-secret#fragment',
      'email=ana@example.invalid',
      'user_id=f41fcb6d-718c-4a6b-9c3e-e65d3d6c9999',
      'phone=5512345678',
      'amount=9876.55'
    ].join('\n');
    const output = redactDevConsoleExport(synthetic);
    expect(output).toContain('TypeError: LANZO_QA_STAGE2_EXPORT');
    expect(output).toContain('at checkout (app.js:45:8)');
    expect(output).toContain('Authorization: Bearer [REDACTADO]');
    expect(output).not.toMatch(/eyJhbGci|refresh-secret|synthetic password|some-api-secret|param-secret|user:pass|ana@example|f41fcb6d|5512345678|9876\.55/);
    expect(output).toContain('[CORREO_REDACTADO]');
    expect(output).toContain('?[PARAMETROS_REDACTADOS]');
  });

  it('does not invoke arbitrary getters, mutate the original, or cut stacks to satisfy the total limit', () => {
    const technical = { name: 'TypeError', message: 'safe text', stack: 'TypeError: safe text\n' + '  at safe (file.js:2:7)\n'.repeat(450) };
    Object.defineProperty(technical, 'details', { get() { throw new Error('getter must not run'); } });
    Object.freeze(technical);
    const sample = Object.freeze(entry(technical));
    const input = Array.from({ length: 30 }, (_, index) => ({ ...sample, timestamp: '2026-11-14T15:43:' + String(index).padStart(2, '0') + '.000Z' }));
    const report = prepareDevConsoleExport(input);
    expect(report.included).toBeGreaterThan(0);
    expect(report.omitted).toBeGreaterThan(0);
    expect(report.included + report.omitted).toBe(30);
    expect(report.text).toContain('Registros anteriores omitidos por límite de tamaño');
    expect(report.text).toContain('  at safe (file.js:2:7)');
    expect(technical.message).toBe('safe text');
    expect(Object.isFrozen(technical)).toBe(true);
  });
});
