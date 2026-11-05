import { describe, expect, it } from 'vitest';
import {
  buildSafeIncidentAdvancedDetails,
  buildSafeIncidentReport,
  classifyIncident,
  getSafeIncidentMetadata,
  getIncidentRecoverySurfaceForPath,
  getSafeIncidentLocation,
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

    expect(report).toContain('Ruta de navegación: No determinada');
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
    expect(report).toContain('Ruta de navegación: No determinada');
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

  it('DIAG-01/02/03/04/05: resolves only known boundaries and exact registered routes', () => {
    expect(getSafeIncidentLocation('welcome', '/?invite=private').functionalArea)
      .toBe('Acceso a Lanzo POS');
    expect(getSafeIncidentLocation('welcome', '/').affectedScreen)
      .toBe('Bienvenida y activación de licencia');
    expect(getSafeIncidentLocation('welcome', '/').navigationPath).toBe('/');
    expect(getSafeIncidentLocation('welcome', '/').supervisedComponent).toBe('WelcomeModal');

    expect(getSafeIncidentLocation('pos', '/')).toMatchObject({
      functionalArea: 'Punto de Venta',
      affectedScreen: 'Operación del POS',
      navigationPath: '/',
      supervisedComponent: 'No determinado'
    });
    expect(getSafeIncidentLocation('sales', '/ventas').affectedScreen).toBe('Panel de Ventas');
    expect(getSafeIncidentLocation('sales', '/ventas').supervisedComponent).toBe('No determinado');
    expect(getSafeIncidentLocation('application', '/').functionalArea).toBe('Aplicación general');
    expect(getSafeIncidentLocation('settings', '/configuracion').functionalArea).toBe('Configuración');
    expect(getIncidentRecoverySurfaceForPath('/')).toBe('pos');
    expect(getIncidentRecoverySurfaceForPath('/ventas')).toBe('sales');
    expect(getIncidentRecoverySurfaceForPath('/configuracion')).toBe('settings');
  });

  it('DIAG-06/07/08/10/11: rejects arbitrary paths and never guesses an exact exception origin', () => {
    const unsafePath = '/clientes/private-name?jwt=secret#account';
    const location = getSafeIncidentLocation('section', unsafePath);
    const report = buildSafeIncidentReport(new Error('private exception'), {
      source: 'react',
      recoverySurface: 'section'
    }, { pathname: unsafePath });
    const advanced = buildSafeIncidentAdvancedDetails('welcome', '/');

    expect(location.navigationPath).toBe('No determinada');
    expect(location.supervisedComponent).toBe('No determinado');
    expect(report).not.toContain('private-name');
    expect(report).not.toContain('jwt=secret');
    expect(report).not.toContain('account');
    expect(advanced).toContain('Componente supervisado: WelcomeModal');
    expect(advanced).toContain('Archivo asociado conocido: src/components/common/WelcomeModal.jsx');
    expect(advanced).toContain('Origen exacto de la excepción: No determinado');
    expect(advanced).not.toContain('C:\\');
  });

  it('DIAG-12/13/14: uses consistent safe context in the technical copy for Telegram and email', () => {
    const report = buildSafeIncidentReport(new ReferenceError('stack has /private/user/profile'), {
      source: 'react',
      recoverySurface: 'welcome'
    }, {
      pathname: '/?token=private',
      appVersion: '4.0.0',
      buildCommit: '59196cca',
      userAgent: 'Chrome/152',
      now: new Date('2026-10-19T20:09:52.861Z')
    });

    expect(report).toContain('Área funcional: Acceso a Lanzo POS');
    expect(report).toContain('Pantalla afectada: Bienvenida y activación de licencia');
    expect(report).toContain('Ruta de navegación: /');
    expect(report).toContain('Componente supervisado: WelcomeModal');
    expect(report).not.toContain('token=private');
    expect(report).not.toContain('/private/user/profile');
  });

  it('DIAG-15/16: preserves critical finance classification and keeps legacy root events generic', () => {
    const financial = classifyIncident(Object.assign(new Error('unknown'), {
      code: 'FINANCIAL_RESULT_UNKNOWN'
    }));
    const legacyRoot = getSafeIncidentLocation('', 'inicio');

    expect(financial.severity).toBe(INCIDENT_SEVERITY.CRITICAL_BLOCKER);
    expect(legacyRoot).toMatchObject({
      functionalArea: 'Aplicación general',
      affectedScreen: 'No determinada',
      navigationPath: 'No determinada',
      supervisedComponent: 'No determinado'
    });
  });

  it('stores only a technical summary in the in-app console', () => {
    const summary = summarizeDiagnosticEvent('error', [
      '[Caja] Error al cobrar',
      Object.assign(new Error('token=secret total=1000'), { code: 'FINANCIAL_RESULT_UNKNOWN' })
    ]);

    expect(summary).toContain('Operación financiera');
    expect(summary).toContain('FINANCIAL_RESULT_UNKNOWN');
    expect(summary).not.toContain('[Caja]');
    expect(summary).not.toContain('token=secret');
    expect(summary).not.toContain('1000');
  });
});

describe('console diagnostic normalization', () => {
  it.each([
    [new TypeError('Failed to fetch'), 'Conectividad', 'NETWORK_REQUEST_FAILED'],
    ['TypeError: Failed to fetch', 'Conectividad', 'NETWORK_REQUEST_FAILED'],
    ['NETWORK_TIMEOUT', 'Conectividad', 'NETWORK_TIMEOUT'],
    [{ code: 'PGRST202', message: 'private server detail', details: null, hint: '' }, 'Servicio remoto', 'PGRST202'],
    [{ code: '', message: 'TypeError: Failed to fetch', details: '', hint: '' }, 'Conectividad', 'NETWORK_REQUEST_FAILED'],
    [{ code: 'XX000', message: 'private internal error', details: '', hint: '' }, 'Servicio remoto', 'INCIDENT_SUPABASE_RPC'],
    [{ code: 'PGRST301' }, 'Autorización o sesión', 'PGRST301'],
    [{ code: 'refresh_token_not_found', message: 'private token' }, 'Autorización o sesión', 'refresh_token_not_found'],
    [{ code: '23505', message: 'private key', details: '', hint: '' }, 'Servicio remoto', '23505'],
    [{ code: '42501', message: 'private policy', details: '', hint: null }, 'Autorización o sesión', '42501'],
    [new DOMException('private storage content', 'QuotaExceededError'), 'Almacenamiento local', 'INCIDENT_INDEXEDDB'],
    [new Error('IndexedDB blocked'), 'Almacenamiento local', 'INCIDENT_INDEXEDDB'],
    [new Error('service worker update failed'), 'Aplicación instalada', 'INCIDENT_PWA'],
    [new TypeError('Failed to fetch dynamically imported module: https://private.invalid/?token=private'), 'Navegación o carga de recursos', 'INCIDENT_NAVIGATION_RESOURCE'],
    [{ code: 'DB_BROWSER_STORAGE_UNAVAILABLE' }, 'Almacenamiento local', 'DB_BROWSER_STORAGE_UNAVAILABLE'],
    [getSafeIncidentMetadata({ code: 'SYNC_REQUEST_FAILED', category: 'synchronization' }), 'Sincronización', 'SYNC_REQUEST_FAILED']
  ])('retains only recognized technical evidence %#', (error, category, code) => {
    const text = summarizeDiagnosticEvent('error', [new Error('unmapped'), error]);
    expect(text).toContain(category);
    expect(text).toContain(code);
    expect(text).not.toContain('private');
  });

  it('uses exact existing operation labels and fixed license codes without copying keys', () => {
    const text = summarizeDiagnosticEvent('error', ['Error al crear licencia Lanzo Local:', {
      code: 'FREE_LICENSE_TRANSPORT_ERROR', licenseKey: 'LNZ-FULL-PRIVATE', outcome: 'created'
    }]);
    expect(text).toContain('Conectividad');
    expect(text).toContain('FREE_LICENSE_TRANSPORT_ERROR');
    expect(text).toContain('Módulo: Licencias · Operación: Crear licencia FREE');
    expect(text).toContain('Resultado: No confirmado');
    expect(text).not.toContain('LNZ-FULL-PRIVATE');
    expect(text).not.toContain('Creación confirmada');
    expect(summarizeDiagnosticEvent('error', [{ code: 'FREE_LICENSE_INVALID_RESPONSE' }]))
      .toContain('Servicio remoto');
    expect(summarizeDiagnosticEvent('error', [{ code: 'FREE_LICENSE_UNCONFIRMED' }]))
      .toContain('Causa no identificada');
    expect(summarizeDiagnosticEvent('error', [{ code: 'FREE_LICENSE_LOCAL_SAVE_FAILED' }]))
      .toContain('Creación confirmada; guardado local fallido');
  });

  it('supports normalized backend and capture records without trusting their free fields', () => {
    expect(summarizeDiagnosticEvent('error', [{
      category: 'authorization_session', severity: 'section_failure', safeCode: 'INCIDENT_AUTHORIZATION_SESSION',
      errorType: 'TypeError', categoryLabel: 'private label'
    }])).toContain('Autorización o sesión · Diagnóstico técnico · INCIDENT_AUTHORIZATION_SESSION · TypeError');
    const text = summarizeDiagnosticEvent('error', [{
      schema_version: 1, category: 'indexeddb', severity: 'section_failure', safe_code: 'DB_OPEN_TIMEOUT',
      module: 'configuracion', incident_id: 'private-id', navigation_path: '/private-route'
    }]);
    expect(text).toContain('Módulo: Configuración');
    expect(text).not.toContain('private');
  });

  it.each([
    'unclassified private message',
    'customer says network timeout while paying',
    { message: 'Failed to fetch', amount: 200 },
    { category: 'connectivity', message: 'private' },
    Object.assign(new Error('email=private@example.invalid'), { code: 'NETWORK_ABC123PRIVATE' }),
    { code: 'PGRST202_PRIVATE' }, { code: 'DB_OPEN_TIMEOUT_PRIVATE' },
    { code: 'FREE_LICENSE_ABC123PRIVATE' }, { name: 'UnknownError', message: 'unknown' }
  ])('does not invent a cause from malformed or arbitrary input %#', (error) => {
    const text = summarizeDiagnosticEvent('error', [error], 'window.error');
    expect(text).toBe('Error inesperado · Causa no identificada · INCIDENT_UNKNOWN · Error');
  });

  it('never invokes getters or serialization hooks and tolerates revoked proxies', () => {
    let accesses = 0;
    const hostile = Object.defineProperties({}, Object.fromEntries(
      ['code', 'message', 'name', 'category', 'severity', 'details', 'hint', 'status', 'toJSON', 'toString']
        .map((key) => [key, { get() { accesses += 1; throw new Error('private getter'); } }])
    ));
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => summarizeDiagnosticEvent('error', [hostile, proxy])).not.toThrow();
    expect(accesses).toBe(0);
  });

  it('drops all extra data even when the diagnostic is recognized', () => {
    const secrets = {
      licenseKey: 'LNZ-FULL-PRIVATE', jwt: 'eyJhbGciOiJIUzI1NiJ9.private.signature', password: 'hunter-private',
      email: 'ana@example.invalid', phone: '5551234567', customer: 'Ana Private', amount: 9876.50,
      body: { p_license_key: 'rpc-private-body' }, url: 'https://private.invalid/?access_token=url-private',
      deviceFingerprint: 'device-private', state: { balance: 'state-private' }
    };
    const text = summarizeDiagnosticEvent('error', [
      JSON.stringify(secrets), { ...secrets, code: 'PGRST202', message: JSON.stringify(secrets),
        details: JSON.stringify(secrets), hint: JSON.stringify(secrets), stack: 'private stack' }
    ]);
    expect(text).toBe('Servicio remoto · Diagnóstico técnico · PGRST202 · Error');
    expect(summarizeDiagnosticEvent('error', ['Error revisando licencia: private', { code: 'PGRST202' }]))
      .not.toContain('Módulo:');
  });
});
