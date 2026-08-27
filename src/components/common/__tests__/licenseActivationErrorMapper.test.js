import { describe, expect, it } from 'vitest';
import { mapLicenseActivationResult } from '../licenseActivationErrorMapper';

const userFacingText = (feedback) => [feedback.title, feedback.message, feedback.action]
  .filter(Boolean)
  .join(' ');

describe('mapLicenseActivationResult', () => {
  it('uses neutral wording for a missing license', () => {
    expect(mapLicenseActivationResult({
      code: 'LICENSE_NOT_FOUND',
      message: 'Esta licencia no existe.'
    })).toMatchObject({
      kind: 'error',
      code: 'LICENSE_NOT_FOUND',
      title: 'Licencia no disponible',
      message: 'Revisa que hayas escrito la clave correctamente e inténtalo de nuevo.',
      action: 'correct_and_retry',
      retryable: true,
      supportRecommended: false
    });
  });

  it('keeps inactive-license details neutral and actionable', () => {
    expect(mapLicenseActivationResult({ code: 'LICENSE_NOT_ACTIVE' })).toMatchObject({
      kind: 'error',
      title: 'Licencia no disponible',
      message: 'No pudimos usar esta licencia. Verifica que esté vigente o contacta a soporte.',
      action: 'verify_or_contact_support',
      supportRecommended: true
    });
  });

  it('maps rate limiting without exposing backend details and preserves bounded retry metadata', () => {
    const feedback = mapLicenseActivationResult({
      code: 'LICENSE_ACTIVATION_RATE_LIMITED',
      retry_after_seconds: 99999,
      message: 'Rate limit interno'
    });

    expect(feedback).toMatchObject({
      kind: 'error',
      title: 'Demasiados intentos',
      message: 'Espera unos minutos antes de volver a intentarlo.',
      action: 'retry_later',
      retryable: true,
      retry_after_seconds: 3600
    });
    expect(userFacingText(feedback)).not.toMatch(/rate|PGRST|SQL|stack/i);
  });

  it('maps unauthorized enrollment to a safe administrator-facing message', () => {
    expect(mapLicenseActivationResult({ code: 'ADMIN_ENROLLMENT_NOT_ALLOWED' })).toMatchObject({
      kind: 'error',
      title: 'Activación no disponible',
      message: 'Este dispositivo no puede completar esta activación. Usa un acceso autorizado o contacta al administrador.',
      action: 'contact_admin',
      supportRecommended: true
    });
  });

  it('maps offline and network failures to the same safe retry instruction', () => {
    expect(mapLicenseActivationResult({ code: 'NETWORK_ERROR' })).toMatchObject({
      kind: 'error',
      title: 'Sin conexión',
      message: 'Conéctate a internet e inténtalo nuevamente.',
      action: 'retry_when_online'
    });

    expect(mapLicenseActivationResult(new Error('Failed to fetch'), { isOnline: true })).toMatchObject({
      kind: 'error',
      title: 'Sin conexión',
      message: 'Conéctate a internet e inténtalo nuevamente.'
    });
  });

  it('maps browser storage failures without exposing IndexedDB diagnostics', () => {
    const feedback = mapLicenseActivationResult({
      code: 'DB_BROWSER_STORAGE_UNAVAILABLE',
      message: 'native IndexedDB failure'
    });

    expect(feedback).toMatchObject({
      kind: 'error',
      title: 'Almacenamiento no disponible',
      message: 'Lanzo no pudo usar el almacenamiento local de este navegador. Cierra otras pestañas de Lanzo e inténtalo nuevamente.',
      action: 'close_other_lanzo_tabs'
    });
    expect(userFacingText(feedback)).not.toMatch(/IndexedDB|DB_BROWSER_STORAGE_UNAVAILABLE|DB_OPEN_TIMEOUT|TENANT_/i);
  });

  it('maps database-open timeouts to closing other tabs', () => {
    const feedback = mapLicenseActivationResult({
      code: 'DB_OPEN_TIMEOUT',
      message: 'IndexedDB capability probe timed out after 3000ms.'
    });

    expect(feedback).toMatchObject({
      kind: 'error',
      title: 'Almacenamiento ocupado',
      message: 'Cierra otras pestañas de Lanzo e inténtalo nuevamente.',
      action: 'close_other_lanzo_tabs'
    });
    expect(userFacingText(feedback)).not.toMatch(/IndexedDB capability probe|DB_OPEN_TIMEOUT/i);
  });

  it('maps transport and server failures to a generic support-safe message', () => {
    const feedback = mapLicenseActivationResult({
      code: 'PGRST500',
      status: 500,
      message: 'SQL statement failed; stack trace follows'
    });

    expect(feedback).toMatchObject({
      kind: 'error',
      title: 'No pudimos validar la licencia',
      message: 'Inténtalo nuevamente. Si el problema continúa, contacta a soporte.',
      action: 'retry_or_contact_support',
      supportRecommended: true
    });
    expect(userFacingText(feedback)).not.toMatch(/PGRST|SQL|stack|500/i);
  });

  it('uses a safe fallback for unknown failures', () => {
    const feedback = mapLicenseActivationResult({
      code: 'UNEXPECTED_INTERNAL_FAILURE',
      message: 'TENANT_secret SQL stack'
    });

    expect(feedback).toMatchObject({
      kind: 'error',
      title: 'Ocurrió un problema',
      message: 'No pudimos validar la licencia. Inténtalo nuevamente.',
      action: 'retry_or_contact_support',
      supportRecommended: true
    });
    expect(userFacingText(feedback)).not.toMatch(/TENANT_|SQL|stack|UNEXPECTED_INTERNAL_FAILURE/i);
  });

  it('keeps access and enrollment states as transitions rather than errors', () => {
    expect(mapLicenseActivationResult({
      code: 'ADMIN_OR_STAFF_LOGIN_REQUIRED',
      accessChoiceRequired: true
    })).toMatchObject({ kind: 'transition', action: 'continue' });

    expect(mapLicenseActivationResult({
      code: 'ADMIN_ENROLLMENT_REQUIRED',
      adminEnrollmentRequired: true
    })).toMatchObject({ kind: 'transition', action: 'continue' });

    expect(mapLicenseActivationResult({
      code: 'STAFF_LOGIN_REQUIRED',
      staffLoginRequired: true
    })).toMatchObject({ kind: 'transition', action: 'continue' });

    expect(mapLicenseActivationResult({ localTenantMismatch: true })).toMatchObject({
      kind: 'transition',
      action: 'continue'
    });
  });
});
