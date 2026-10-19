import { describe, expect, it } from 'vitest';
import {
  formatIncidentChannelSummary,
  INCIDENT_REPORT_STATUS
} from '../incidentReporter';
import {
  buildIncidentSupportMessage,
  buildIncidentCommunicationMessage,
  MAX_INCIDENT_COMMUNICATION_CODEPOINTS,
  MAX_INCIDENT_SUPPORT_DESCRIPTION_CODEPOINTS,
  MAX_INCIDENT_SUPPORT_MESSAGE_CODEPOINTS
} from '../incidentCommunication';

const incident = Object.freeze({
  incident_id: '00000000-0000-4000-8000-000000000001',
  safe_code: 'DB_BLOCKED',
  category: 'indexeddb',
  safe_route: '/caja?token=route-secret'
});

describe('incidentCommunication', () => {
  it('TG-01: includes a folio only for a confirmed receipt of this incident', () => {
    const message = buildIncidentCommunicationMessage({
      incident,
      reportStatus: INCIDENT_REPORT_STATUS.SENT,
      reportReference: 'IR-0011223344556677',
      reportIncidentId: incident.incident_id,
      contextIsCurrent: true
    });

    expect(message).toContain('IR-0011223344556677');
    expect(message).toContain('DB_BLOCKED');
    expect(message).toContain('Categoría: Almacenamiento local');
    expect(message).toContain('Área funcional: Caja');
    expect(message).toContain('Pantalla afectada: Operación de caja');
    expect(message).toContain('Componente supervisado: No determinado');
    expect(message).toContain('/caja');
    expect(message).not.toContain('route-secret');
    expect(message).toContain('Solicito seguimiento de esta incidencia.');
  });

  it.each([
    INCIDENT_REPORT_STATUS.NOT_STARTED,
    INCIDENT_REPORT_STATUS.READY,
    INCIDENT_REPORT_STATUS.SENDING,
    INCIDENT_REPORT_STATUS.FAILED,
    INCIDENT_REPORT_STATUS.OFFLINE,
    INCIDENT_REPORT_STATUS.UNAVAILABLE
  ])('TG-02: omits a folio for report status %s', (reportStatus) => {
    const message = buildIncidentCommunicationMessage({
      incident,
      reportStatus,
      reportReference: 'IR-0011223344556677',
      reportIncidentId: incident.incident_id,
      contextIsCurrent: true
    });

    expect(message).not.toContain('IR-0011223344556677');
    expect(message).toContain('diagnóstico local no registrado');
    expect(message).toContain('no es un reporte registrado');
  });

  it('TG-03: labels an offline report as local and unreceived', () => {
    const message = buildIncidentCommunicationMessage({ incident, reportStatus: INCIDENT_REPORT_STATUS.OFFLINE });

    expect(message).toContain('diagnóstico local no registrado');
    expect(message).not.toMatch(/IR-[A-F0-9]{16}/);
  });

  it('TG-04: an unavailable RPC response cannot become a receipt', () => {
    const message = buildIncidentCommunicationMessage({
      incident,
      reportStatus: INCIDENT_REPORT_STATUS.UNAVAILABLE,
      reportReference: 'IR-0011223344556677',
      reportIncidentId: incident.incident_id,
      contextIsCurrent: true
    });

    expect(message).not.toContain('IR-0011223344556677');
    expect(formatIncidentChannelSummary({
      incident,
      reportReference: 'IR-0011223344556677',
      receiptConfirmed: false
    })).toContain('diagnóstico local no registrado');
  });

  it('TG-05: emits only the allowlisted technical summary fields', () => {
    const message = buildIncidentCommunicationMessage({
      incident: {
        ...incident,
        safe_code: 'PGRST202',
        category: 'supabase_rpc',
        license_key: 'LANZO-SYNTHETIC-SECRET',
        device_fingerprint: 'fingerprint-synthetic',
        security_token: 'token-synthetic',
        tenant_id: 'tenant-synthetic',
        actor_id: 'actor-synthetic',
        customer_name: 'Cliente Sintético',
        total: 99123.45,
        stack: 'stack-synthetic',
        rpc_body: 'rpc-body-synthetic',
        fingerprint: 'v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        query: '?token=secret-query'
      },
      reportStatus: INCIDENT_REPORT_STATUS.FAILED,
      userDescription: 'descripción libre con secreto-sintético'
    });

    expect(message).toContain('PGRST202');
    expect(message).not.toMatch(/LANZO-SYNTHETIC-SECRET|fingerprint-synthetic|token-synthetic|tenant-synthetic|actor-synthetic|Cliente Sintético|99123\.45|stack-synthetic|rpc-body-synthetic|secret-query|secreto-sintético/);
    expect(Array.from(message).length).toBeLessThanOrEqual(MAX_INCIDENT_COMMUNICATION_CODEPOINTS);
  });

  it('TG-06: never attaches a user-authored description to external communication', () => {
    const message = buildIncidentCommunicationMessage({
      incident: { ...incident, user_description: 'texto escrito libremente' },
      description: 'texto escrito libremente',
      userDescription: 'texto escrito libremente',
      reportStatus: INCIDENT_REPORT_STATUS.READY
    });

    expect(message).not.toContain('texto escrito libremente');
  });

  it('TG-12: a receipt from another incident or stale actor context is not reused', () => {
    const otherIncident = buildIncidentCommunicationMessage({
      incident,
      reportStatus: INCIDENT_REPORT_STATUS.SENT,
      reportReference: 'IR-0011223344556677',
      reportIncidentId: '00000000-0000-4000-8000-000000000099',
      contextIsCurrent: true
    });
    const staleContext = buildIncidentCommunicationMessage({
      incident,
      reportStatus: INCIDENT_REPORT_STATUS.SENT,
      reportReference: 'IR-0011223344556677',
      reportIncidentId: incident.incident_id,
      contextIsCurrent: false
    });

    expect(otherIncident).not.toContain('IR-0011223344556677');
    expect(staleContext).not.toContain('IR-0011223344556677');
    expect(otherIncident).toContain('diagnóstico local no registrado');
    expect(staleContext).toContain('diagnóstico local no registrado');
  });

  it('CONTACT-06/07/23: builds readable, allowlisted content for Telegram and email', () => {
    const message = buildIncidentSupportMessage({
      incident: {
        ...incident,
        safe_code: 'INCIDENT_REACT_RENDER',
        category: 'react_render',
        safe_route: '/ventas?token=route-secret',
        app_version: '4.0.0',
        network_status: 'offline',
        incident_id: '00000000-0000-4000-8000-000000000001',
        correlation_id: '00000000-0000-4000-8000-000000000002',
        customer_name: 'Cliente privado',
        total: 99123.45,
        stack: 'stack-secret',
        security_token: 'token-secret',
        license_key: 'license-secret'
      },
      description: 'Texto libre excluido por omisión'
    });

    expect(message).toContain('Hola, soporte de Lanzo POS.');
    expect(message).toContain('Código del problema: INCIDENT_REACT_RENDER');
    expect(message).toContain('Área funcional: Ventas');
    expect(message).toContain('Pantalla afectada: Panel de Ventas');
    expect(message).toContain('Ruta de navegación: /ventas');
    expect(message).toContain('Categoría: Render de interfaz');
    expect(message).toContain('Versión de Lanzo: 4.0.0');
    expect(message).toContain('Conexión: Sin conexión');
    expect(message).not.toMatch(/\{|\}|"schema_version"|00000000-0000|Cliente privado|99123\.45|stack-secret|token-secret|license-secret|route-secret|Texto libre/);
    expect(Array.from(message).length).toBeLessThanOrEqual(MAX_INCIDENT_SUPPORT_MESSAGE_CODEPOINTS);
  });

  it('DIAG-12/13: shares the same allowlisted Welcome context in Telegram and email preparation', () => {
    const message = buildIncidentSupportMessage({
      incident: {
        ...incident,
        safe_code: 'INCIDENT_REACT_RENDER',
        category: 'react_render',
        safe_route: 'inicio',
        navigation_path: '/',
        recovery_surface: 'welcome',
        app_version: '4.0.0',
        stack: 'src/pages/private/customer.jsx',
        customer_name: 'Cliente privado',
        total: 99123.45
      }
    });

    expect(message).toContain('Área funcional: Acceso a Lanzo POS');
    expect(message).toContain('Pantalla afectada: Bienvenida y activación de licencia');
    expect(message).toContain('Ruta de navegación: /');
    expect(message).toContain('Componente supervisado: WelcomeModal');
    expect(message).not.toMatch(/private\/customer|Cliente privado|99123\.45/);
  });

  it('DIAG-12/13: keeps Welcome context in the brief legacy Telegram/email summary', () => {
    const message = buildIncidentCommunicationMessage({
      incident: {
        ...incident,
        safe_code: 'INCIDENT_REACT_RENDER',
        category: 'react_render',
        safe_route: 'inicio',
        navigation_path: '/',
        recovery_surface: 'welcome',
        component_stack: 'src/pages/private/customer.jsx',
        customer_name: 'Cliente privado',
        total: 99123.45
      }
    });

    expect(message).toContain('Área funcional: Acceso a Lanzo POS');
    expect(message).toContain('Pantalla afectada: Bienvenida y activación de licencia');
    expect(message).toContain('Ruta de navegación: /');
    expect(message).toContain('Componente supervisado: WelcomeModal');
    expect(message).not.toContain('Archivo asociado conocido');
    expect(message).not.toMatch(/private\/customer|Cliente privado|99123\.45/);
    expect(Array.from(message).length).toBeLessThanOrEqual(MAX_INCIDENT_COMMUNICATION_CODEPOINTS);
  });

  it('CONTACT-08/09: includes user text only after explicit opt-in and preserves it as entered', () => {
    const description = '  Estaba abriendo Ventas.\nEl texto conserva su formato.  ';
    const defaultMessage = buildIncidentSupportMessage({
      incident,
      description,
      includeDescription: false
    });
    const includedMessage = buildIncidentSupportMessage({
      incident,
      description,
      includeDescription: true
    });

    expect(defaultMessage).not.toContain(description);
    expect(includedMessage).toContain(`Descripción:\n${description}`);
    expect(Array.from(includedMessage).length).toBeLessThanOrEqual(MAX_INCIDENT_SUPPORT_MESSAGE_CODEPOINTS);
  });

  it('CONTACT-09: caps explicitly included text at 500 Unicode code points', () => {
    const description = '😀'.repeat(MAX_INCIDENT_SUPPORT_DESCRIPTION_CODEPOINTS + 15);
    const message = buildIncidentSupportMessage({ incident, description, includeDescription: true });
    const included = message.split('Descripción:\n')[1].split('\n\nAgradecería')[0];

    expect(Array.from(included).length).toBe(MAX_INCIDENT_SUPPORT_DESCRIPTION_CODEPOINTS);
  });
});
