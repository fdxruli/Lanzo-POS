import { describe, expect, it } from 'vitest';
import {
  formatIncidentChannelSummary,
  INCIDENT_REPORT_STATUS
} from '../incidentReporter';
import {
  buildIncidentCommunicationMessage,
  MAX_INCIDENT_COMMUNICATION_CODEPOINTS
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
    expect(message).toContain('indexeddb');
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
});
