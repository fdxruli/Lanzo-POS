import { createIncidentReporter, INCIDENT_REPORT_STATUS } from '../services/diagnostics/incidentReporter';
import { createContextSnapshotGuard } from '../services/diagnostics/contextSnapshotGuard';
import {
  buildIncidentCommunicationMessage,
  buildIncidentSupportMessage
} from '../services/diagnostics/incidentCommunication';
import { copyTextToClipboard } from '../services/support/supportContact';

export const QA_LABEL = 'SIMULACIÓN — NO ENVIADO A SUPABASE';
export const QA_SCENARIOS = Object.freeze([
  ['QA-01', 'Error React', 'react'], ['QA-02', 'Fallo de sección', 'section'],
  ['QA-03', 'Bloqueo financiero ambiguo', 'financial'], ['QA-04', 'Error de conexión', 'network'],
  ['QA-05', 'Fallo RPC', 'rpc'], ['QA-06', 'Fallo de almacenamiento', 'storage'],
  ['QA-07', 'Formulario real', 'report'], ['QA-08', 'Recepción ficticia', 'receipt'],
  ['QA-09', 'Telegram', 'telegram'], ['QA-10', 'Correo alternativo', 'email'],
  ['QA-11', 'Cambio de actor y tenant', 'context'], ['QA-12', 'Reintentos y deduplicación', 'dedupe'],
  ['QA-13', 'Fallo del reporter', 'reporter'], ['QA-14', 'Accesibilidad y responsive', 'visual']
]);

export const createLabFault = (kind, variant = '') => {
  const codes = {
    financial: 'FINANCIAL_RESULT_UNKNOWN', network: 'NETWORK_TIMEOUT',
    rpc: variant || 'PGRST202', storage: variant || 'DB_UNAVAILABLE'
  };
  return Object.assign(new Error('Excepción determinista del fixture QA; detalle privado omitido'), {
    code: codes[kind] || undefined,
    ...(variant === 'AUTH_DENIED' ? { status: 403 } : {})
  });
};

// No Supabase client, auth runtime, IndexedDB, commercial store or financial
// operation is reachable here. Transport is a closed, in-memory function.
export function createIncidentLabAdapters({ copyText = copyTextToClipboard, onEvent = () => {} } = {}) {
  let context = { actorStatus: 'granted', actorKey: 'QA-OWNER', sessionId: 'QA-SESSION', actorGeneration: 1,
    tenantReady: true, tenantOpaqueId: 'QA-A', tenantDatabaseName: 'QA-MEMORY-ONLY', tenantGeneration: 1 };
  let fixtureRepaired = false;
  let online = true;
  let outcome = 'unavailable';
  let copyMode = 'browser';
  let lastCopied = '';
  let emailDraft = '';
  let simulatedReceipts = 0;
  let transportCalls = 0;
  const submissions = new Map();
  const environment = () => ({ pathname: '/ventas', online, userAgent: navigator.userAgent,
    appVersion: import.meta.env.VITE_APP_VERSION, buildCommit: import.meta.env.VITE_BUILD_COMMIT });
  const reporter = createIncidentReporter({ environment, transport: async () => {
    const selectedOutcome = outcome;
    transportCalls += 1;
    onEvent('Transporte QA en memoria');
    // Promise boundary permits exercising double-click and stale-context races.
    await new Promise((resolve) => globalThis.setTimeout(resolve, 180));
    if (selectedOutcome === 'receipt') return { success: true, report_reference: 'IR-0000000000000001' };
    if (selectedOutcome === 'invalid') return { success: true, report_reference: 'QA-INVALID' };
    if (selectedOutcome === 'throw') throw new Error('QA reporter exception');
    const errors = {
      unavailable: { code: 'PGRST202' }, temporary: { code: 'SUPABASE_TEMPORARY', status: 503 },
      authorization: { code: 'AUTH_DENIED', status: 403 }, unexpected: { code: 'QA_UNEXPECTED' },
      timeout: { code: 'NETWORK_TIMEOUT', status: 408 }, server: { code: 'SUPABASE_SERVER', status: 500 }
    };
    throw errors[selectedOutcome] || errors.unavailable;
  }});
  const guard = () => createContextSnapshotGuard({ capture: () => context });
  const copy = async (text) => {
    // Defense in depth: mock references never reach any clipboard or channel.
    const safe = `${QA_LABEL}\n${text}`.replace(/IR-[A-F0-9]{16}/g, '[FOLIO FICTICIO OMITIDO]');
    if (copyMode === 'failure') { onEvent('Portapapeles QA: fallo simulado'); return false; }
    const copied = copyMode === 'memory' || await copyText(safe) === true;
    if (copied) { lastCopied = safe; onEvent('Copia manual de texto QA'); }
    return copied;
  };
  const services = Object.freeze({
    getOnlineState: () => online,
    copyText: copy,
    supportEmail: 'qa-no-enviar@example.invalid',
    buildSupportMessage: (options) => `${QA_LABEL}\nPRUEBA QA. No se envió ningún mensaje.\n${buildIncidentSupportMessage(options)}`,
    buildCommunication: (options) => `${QA_LABEL}\nPRUEBA QA. No es una incidencia registrada.\n${buildIncidentCommunicationMessage({
      ...options, reportReference: undefined, reportStatus: INCIDENT_REPORT_STATUS.UNAVAILABLE, contextIsCurrent: false
    })}`,
    inspectEmail: (url) => { emailDraft = url; onEvent('Borrador local inspeccionado; sin abrir aplicación externa'); },
    describeStatus: (status, code) => {
      if (code === 'QA_SIMULATED_ACK') return 'Confirmación ficticia validada internamente. No hay folio real ni recepción de Supabase.';
      if (code === 'INCIDENT_REPORT_CONTEXT_CHANGED') return 'El contexto cambió. Abre una incidencia nueva; el reporte anterior no se puede compartir.';
      if (status === 'sending') return 'Probando el adaptador QA en memoria…';
      if (status === 'offline') return 'Sin conexión simulada. Copia local disponible; no se envió el reporte.';
      if (status === 'unavailable') return 'Backend no disponible (simulado). No se registró el reporte.';
      if (status === 'failed') return `No se confirmó recepción. Código seguro: ${code || 'INCIDENT_REPORT_DELIVERY_FAILED'}`;
      return 'Adaptador QA aislado. El consentimiento permite únicamente una prueba local.';
    },
    submit: (incident, options) => {
      const key = `${context.actorGeneration}:${context.tenantGeneration}:${outcome}:${incident.incident_id}`;
      if (submissions.has(key)) return submissions.get(key);
      const operation = (async () => {
        const result = await reporter.submit(incident, options);
        if (!options.isContextCurrent()) return { status: 'failed', code: 'INCIDENT_REPORT_CONTEXT_CHANGED' };
        if (result.status === 'sent') {
          simulatedReceipts += 1;
          onEvent('Recepción ficticia validada; referencia interna suprimida');
          // Never pass a mock receipt to the real form's production SENT state.
          return { status: 'unavailable', code: 'QA_SIMULATED_ACK' };
        }
        return result;
      })();
      submissions.set(key, operation);
      operation.then((result) => { if (result.code !== 'QA_SIMULATED_ACK') submissions.delete(key); }, () => submissions.delete(key));
      return operation;
    }
  });
  return Object.freeze({
    reporter, services, guard, copy,
    armFixture: () => { fixtureRepaired = false; },
    fixtureShouldThrow: (repair) => { if (repair) fixtureRepaired = true; return !fixtureRepaired; },
    snapshot: () => ({ ...context }),
    metrics: () => ({ transportCalls, simulatedReceipts, lastCopied, emailDraft }),
    configure: (options) => {
      online = options.online !== false;
      outcome = options.outcome || 'unavailable';
      copyMode = options.copyMode || 'browser';
    },
    changeContext: (tenant, actor) => {
      context = { ...context, tenantOpaqueId: tenant, actorKey: actor,
        actorGeneration: context.actorGeneration + 1, tenantGeneration: context.tenantGeneration + 1 };
      reporter.clearForTests();
      lastCopied = ''; emailDraft = '';
      onEvent('Contexto ficticio cambiado; guardas anteriores invalidadas');
    },
    // Same implementation as production, with no imports of its runtime.
    boundaryRuntime: {
      getOnlineState: () => online,
      appStore: { getState: () => ({ updateAvailable: false, isUpdating: false }), subscribe: () => () => {} },
      createRecoveryContextGuard: guard,
      captureIncident: (error, ctx) => { const incident = reporter.capture(error, ctx); onEvent(incident?.deduplicated ? 'Captura deduplicada' : 'Captura real del ErrorBoundary'); return incident; },
      areActorOperationsIdle: () => true
    }
  });
}
