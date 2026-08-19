import { describe, expect, it, vi } from 'vitest';
import {
  buildAdminBootSupportReport,
  buildDatabaseRecoverySupportReport,
  buildSupportEmailPayload,
  buildSupportMailtoUrl,
  getSupportEmail
} from '../../support/supportContact';
import { CURRENT_NATIVE_DATABASE_VERSION } from '../../db/databaseSchema';

describe('supportContact', () => {
  it('construye payload de soporte por correo con contexto comercial', () => {
    vi.setSystemTime(new Date('2026-07-09T12:30:00'));

    const payload = buildSupportEmailPayload({
      licenseDetails: {
        plan_code: 'free_trial',
        plan_name: 'Lanzo Local',
        license_key: 'LZ-123'
      },
      companyProfile: {
        name: 'Abarrotes Centro'
      },
      appVersion: '4.0.0',
      issueType: 'Respaldo local',
      description: 'No encuentro mi carpeta de respaldo.'
    });

    expect(payload.subject).toContain('Respaldo local');
    expect(payload.body).toContain('Plan comercial: Lanzo Local');
    expect(payload.body).toContain('Codigo interno del plan: free_trial');
    expect(payload.body).toContain('Licencia: LZ-123');
    expect(payload.body).toContain('Nombre del negocio: Abarrotes Centro');
    expect(payload.body).toContain('Version de app: 4.0.0');
    expect(payload.body).toContain('Tipo de problema: Respaldo local');
    expect(payload.body).toContain('No encuentro mi carpeta de respaldo.');
  });

  it('construye URL mailto codificada sin abrir canales externos', () => {
    const url = buildSupportMailtoUrl({
      to: 'soporte@example.com',
      subject: 'Ayuda con Lanzo',
      body: 'Linea 1\nLinea 2'
    });

    expect(url).toBe('mailto:soporte@example.com?subject=Ayuda%20con%20Lanzo&body=Linea%201%0ALinea%202');
  });

  it('centraliza el correo de soporte y conserva el fallback configurado por Lanzo', () => {
    expect(getSupportEmail()).toBeTruthy();
    expect(buildSupportMailtoUrl({ subject: 'Diagnóstico', body: 'Detalle' }))
      .toMatch(new RegExp(`^mailto:${getSupportEmail()}\\?`));
  });

  it('construye un reporte de recovery útil sin exponer secretos ni el id opaco del tenant', () => {
    const report = buildDatabaseRecoverySupportReport({
      status: 'failed',
      errorCode: 'DB_UNSUPPORTED_NATIVE_VERSION',
      message: 'La base fue creada por una versión más reciente.',
      databaseName: 'LanzoDB_t_opaque-tenant-id',
      detectedNativeVersion: CURRENT_NATIVE_DATABASE_VERSION + 10,
      expectedNativeVersion: CURRENT_NATIVE_DATABASE_VERSION,
      isRetryable: false,
      requiresMigration: false,
      affectedStores: ['sales']
    }, {
      appVersion: '4.0.0',
      userAgent: 'Lanzo Test Browser',
      platform: 'TestOS',
      language: 'es-MX',
      online: false,
      path: '/pos',
      now: new Date('2026-08-13T06:00:00.000Z')
    });

    expect(report).toContain('DB_UNSUPPORTED_NATIVE_VERSION');
    expect(report).toContain('Versión de Lanzo: 4.0.0');
    expect(report).toContain('Navegador/entorno: Lanzo Test Browser');
    expect(report).toContain('Estado de red: Offline');
    expect(report).toContain('Fecha y hora: 2026-08-13T06:00:00.000Z');
    expect(report).toContain(`Versión local detectada: ${CURRENT_NATIVE_DATABASE_VERSION + 10}`);
    expect(report).toContain(`Versión compatible con esta instalación: ${CURRENT_NATIVE_DATABASE_VERSION}`);
    expect(report).toContain('identificador redactado');
    expect(report).not.toContain('opaque-tenant-id');
    expect(report).not.toMatch(/license key|token|password|\bpin\b/i);
  });

  it('construye un reporte de inicio administrativo con metadatos acotados y sin secretos', () => {
    const report = buildAdminBootSupportReport({
      errorCode: 'TENANT_RUNTIME_NOT_READY',
      message: 'token: abcdefghijkl license_key LZ-SECRET-12345 LanzoDB_t_t_12345678901234567890',
      classification: 'application_runtime',
      stage: 'ready_runtime_loading',
      databaseRecoveryStatus: 'ready',
      tenantRuntimeReady: false,
      assetRecoveryAttempted: false,
      assetRecoveryResult: 'No intentada para error de runtime'
    }, {
      appVersion: '4.0.0',
      buildCommit: 'abcdef1',
      buildDate: '2026-08-19T00:00:00.000Z',
      userAgent: 'Lanzo Test Browser',
      platform: 'TestOS',
      language: 'es-MX',
      online: false,
      path: '/ventas',
      now: new Date('2026-08-19T06:00:00.000Z')
    });

    expect(report).toContain('TENANT_RUNTIME_NOT_READY');
    expect(report).toContain('Etapa de inicio: ready_runtime_loading');
    expect(report).toContain('Tenant runtime listo: No');
    expect(report).toContain('Commit de build: abcdef1');
    expect(report).toContain('Fecha de build: 2026-08-19T00:00:00.000Z');
    expect(report).toContain('Estado de red: Offline');
    expect(report).not.toContain('LZ-SECRET-12345');
    expect(report).not.toContain('t_12345678901234567890');
    expect(report).not.toContain('abcdefghijkl');
  });
});
