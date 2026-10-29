import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import IncidentErrorBoundary from './IncidentErrorBoundary';
import IncidentRecoveryPanel from './IncidentRecoveryPanel';
import { createIncidentLabAdapters, createLabFault, QA_LABEL, QA_SCENARIOS } from '../../qa/incidentLabAdapters';
import { classifyIncident, getSafeIncidentMetadata } from '../../services/diagnostics/incidentDiagnostics';
import { normalizeBackendError } from '../../services/diagnostics/incidentCapture';
import './IncidentRecoveryQaGallery.css';

function RenderFixture({ fault, fail, shouldFail }) {
  if (fail || shouldFail?.()) throw fault;
  return <div className="incident-qa__fixture"><h3 tabIndex={-1} data-recovery-focus-target>Ventas ficticias disponibles</h3><p>Fixture aislado. Sin catálogo, ventas, pagos ni almacenamiento comercial.</p></div>;
}
const OUTCOMES = [ ['unavailable', 'Backend no disponible · PGRST202'], ['temporary', 'Error temporal'],
  ['authorization', 'Error de autorización'], ['unexpected', 'Error inesperado'], ['timeout', 'Timeout de servicio'],
  ['server', 'Error de servidor'], ['receipt', 'Confirmación ficticia'], ['invalid', 'Folio inválido'], ['throw', 'Excepción del reporter'] ];

export default function IncidentRecoveryQaGallery() {
  const [events, setEvents] = useState([]);
  const [lab] = useState(() => createIncidentLabAdapters({ onEvent: (event) => setEvents((current) => [...current.slice(-29), event]) }));
  const [scenario, setScenario] = useState('QA-01');
  const [theme, setTheme] = useState('light');
  const [online, setOnline] = useState('online');
  const [outcome, setOutcome] = useState('unavailable');
  const [copyMode, setCopyMode] = useState('browser');
  const [variant, setVariant] = useState('PGRST202');
  const [storage, setStorage] = useState('DB_UNAVAILABLE');
  const [retryMode, setRetryMode] = useState('persistent');
  const [visualLevel, setVisualLevel] = useState('recoverable');
  const [visualState, setVisualState] = useState('detected');
  const [actionsEnabled, setActionsEnabled] = useState(true);
  const [tenant, setTenant] = useState('QA-A');
  const [actor, setActor] = useState('QA-OWNER');
  const [generation, setGeneration] = useState(0);
  const [fault, setFault] = useState(null);
  const [fired, setFired] = useState(false);
  const [incident, setIncident] = useState(null);
  const [incidentGuard, setIncidentGuard] = useState(null);
  const [normalization, setNormalization] = useState(null);
  const [results, setResults] = useState({});
  const [exportStatus, setExportStatus] = useState('');
  const [emailStatus, setEmailStatus] = useState('');
  const [host] = useState(() => { const element = document.createElement('div'); element.className = 'incident-qa incident-qa__portal'; return element; });
  const scenarioSelect = useRef(null);
  const boundary = useRef(null);
  const [qaId, name, kind] = QA_SCENARIOS.find(([id]) => id === scenario);
  const isRender = ['react', 'section', 'dedupe', 'financial'].includes(kind);
  const critical = fired && kind === 'financial';
  const currentResult = results[qaId] || { result: 'NOT RUN', notes: '', code: '', recovery: '', actions: [] };
  const effectiveOutcome = online === 'timeout' ? 'timeout' : online === 'server' ? 'server' : outcome;
  lab.configure({ online: online !== 'offline', outcome: effectiveOutcome, copyMode });

  useLayoutEffect(() => {
    document.body.appendChild(host);
    return () => host.remove();
  }, [host]);
  useEffect(() => {
    const previous = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', theme);
    return () => { if (previous) document.documentElement.setAttribute('data-theme', previous); else document.documentElement.removeAttribute('data-theme'); };
  }, [theme]);
  const reset = () => {
    setFired(false); setFault(null); setIncident(null); setIncidentGuard(null); setNormalization(null); setEmailStatus(''); setGeneration((n) => n + 1);
    requestAnimationFrame(() => scenarioSelect.current?.focus());
  };
  useEffect(() => {
    if (!critical) return undefined;
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); reset(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...host.querySelectorAll('button:not(:disabled), a[href], textarea, input:not(:disabled), select')]
        .filter((el) => !el.closest('[hidden]'));
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [critical, host]);

  const start = () => {
    const nextFault = createLabFault(kind, kind === 'storage' ? storage : kind === 'rpc' ? variant : '');
    const context = { source: isRender ? 'react' : kind === 'storage' ? 'indexeddb' : 'backend_service',
      pathname: kind === 'section' ? '/configuracion' : '/ventas',
      recoverySurface: kind === 'section' ? 'settings' : 'sales', online: online !== 'offline',
      ...(kind === 'react' || kind === 'dedupe' ? { severity: 'recoverable' } : {}) };
    const guard = lab.guard();
    setIncidentGuard(() => guard);
    lab.armFixture();
    setFault({ error: nextFault, context });
    if (!isRender) {
      setNormalization(kind === 'rpc' || kind === 'network' ? normalizeBackendError(nextFault, context) : null);
      setIncident(lab.reporter.capture(nextFault, context));
    } else {
      setIncident(null);
    }
    setFired(true);
    setEvents((current) => [...current.slice(-29), isRender ? 'Acción QA: excepción de render' : 'Fallo de infraestructura simulado']);
    setGeneration((n) => n + 1);
  };
  const changeScenario = (value) => {
    reset(); setScenario(value);
    if (value === 'QA-08') setOutcome('receipt');
    else if (value === 'QA-13') setOutcome('throw');
    else setOutcome('unavailable');
  };
  const changeContext = (nextTenant, nextActor) => {
    lab.changeContext(nextTenant, nextActor); setTenant(nextTenant); setActor(nextActor);
  };
  const captureFromBoundary = (error, context) => {
    const captured = lab.boundaryRuntime.captureIncident(error, context);
    setIncident(captured);
    return captured;
  };
  const runtime = { ...lab.boundaryRuntime, captureIncident: captureFromBoundary };
  const metadata = fault ? getSafeIncidentMetadata(classifyIncident(fault.error, fault.context), {
    pathname: fault.context.pathname, recoverySurface: fault.context.recoverySurface, online: online !== 'offline'
  }) : null;
  const metrics = lab.metrics();
  const updateResult = (patch) => setResults((current) => ({ ...current, [qaId]: { ...currentResult, ...patch,
    code: incident?.safe_code || '', recovery: boundary.current?.state.recoveryStatus || (fired ? visualState : 'not_started'), actions: [...events] } }));
  const exportResults = async () => {
    const text = ['LANZO-POS — QA INCIDENT RECOVERY', 'PR: 357', `HEAD: ${import.meta.env.VITE_BUILD_COMMIT}`,
      `ENVIRONMENT: ${import.meta.env.DEV ? 'DEVELOPMENT' : 'PREVIEW'}`, 'DATA: SYNTHETIC', 'SCOPE: LAB_QA', QA_LABEL,
      ...QA_SCENARIOS.map(([id, title]) => {
        const r = results[id];
        return `${id}: ${r?.result || 'NOT RUN'} · ${title}\nCódigo: ${r?.code || '-'} · Recuperación: ${r?.recovery || '-'}\nAcciones: ${r?.actions?.join('; ') || '-'}\nObservaciones QA (revisar antes de compartir): ${r?.notes || '-'}`;
      })].join('\n');
    setExportStatus(await lab.copy(text) ? 'Resumen QA copiado.' : 'No se pudo copiar el resumen. Cambia a portapapeles local para inspeccionarlo.');
  };
  const recovery = fired && fault && (isRender ? (
    <IncidentErrorBoundary key={generation} ref={boundary} runtime={runtime}
      criticalPortalTarget={host} recoveryControls={critical ? (<div className="incident-qa__escape"><strong>{QA_LABEL} · Bloqueo ficticio</strong><button className="ui-button ui-button--secondary" onClick={reset}>Salir de la prueba</button><button disabled>Reintentar operación</button><p>Escape también cierra esta prueba. No verifica ni reintenta una operación.</p></div>) : null} incidentContext={fault.context}
      recoverySurface={fault.context.recoverySurface}
      createRecoveryContextGuard={() => incidentGuard} reportServices={lab.services} copyText={(text) => incidentGuard?.() ? lab.copy(text) : Promise.resolve(false)}
      openSupportMailto={() => setEvents((current) => [...current.slice(-29), 'Correo interceptado localmente; sin aplicación externa'])}
      navigateToPos={reset}>
      <RenderFixture fault={fault.error} shouldFail={() => {
        return fired && lab.fixtureShouldThrow(retryMode === 'recover' && boundary.current?._renderRecoveryAttempts === 1);
      }} />
    </IncidentErrorBoundary>
  ) : (
    <IncidentRecoveryPanel severity={kind === 'visual' ? visualLevel : incident?.severity || 'section_failure'}
      title={kind === 'storage' ? 'Necesitamos revisar el almacenamiento local' : 'Incidencia controlada de prueba'}
      description={kind === 'storage' ? 'Adaptador ficticio. No borres datos del navegador; ninguna base comercial fue abierta.' : 'Fallo de infraestructura simulado. No se contactó al servicio real.'}
      metadata={{ ...metadata, recoveryStatus: visualState }} recoveryNotice={QA_LABEL}
      primaryAction={{ label: 'Reintentar simulación', disabled: !actionsEnabled || visualState === 'blocked', onClick: start }}
      incidentRecord={incident} reportServices={lab.services} isContextCurrent={incidentGuard} />
  ));

  return <div className="incident-qa">
    <header className="incident-qa__header"><div><p className="incident-qa__eyebrow">Lanzo POS · PR #357 · {import.meta.env.VITE_BUILD_COMMIT}</p><h1>Centro de Recuperación — Laboratorio QA</h1><p>Pruebas controladas del sistema de recuperación. No se utilizan ventas ni datos reales.</p></div>
      <button className="ui-button ui-button--secondary" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>Tema {theme === 'light' ? 'oscuro' : 'claro'}</button>
    </header>
    <div className="incident-qa__banner"><strong>ENTORNO DE PRUEBAS — DATOS FICTICIOS</strong><span>{QA_LABEL}. Recepción real del backend no disponible.</span></div>
    <main className="incident-qa__grid">
      <section className="incident-qa__controls" aria-labelledby="qa-scenarios"><h2 id="qa-scenarios">Escenarios</h2>
        <label>Tipo de incidencia<select ref={scenarioSelect} value={scenario} onChange={(e) => changeScenario(e.target.value)}>{QA_SCENARIOS.map(([id, title]) => <option value={id} key={id}>{id} · {title}</option>)}</select></label>
        <label>Conectividad simulada<select value={online} onChange={(e) => { setOnline(e.target.value); reset(); }}><option value="online">En línea</option><option value="offline">Sin conexión</option><option value="timeout">Timeout de servicio</option><option value="server">Error de servidor</option></select></label>
        <label>Resultado del adaptador<select value={outcome} onChange={(e) => { setOutcome(e.target.value); reset(); }}>{OUTCOMES.map(([id, title]) => <option value={id} key={id}>{title}</option>)}</select></label>
        {kind === 'rpc' && <label>Error RPC<select value={variant} onChange={(e) => { setVariant(e.target.value); reset(); }}>{['PGRST202', 'SUPABASE_TEMPORARY', 'AUTH_DENIED', 'SUPABASE_UNEXPECTED', 'SUPABASE_UNAVAILABLE'].map((v) => <option key={v}>{v}</option>)}</select></label>}
        {kind === 'storage' && <label>Error de almacenamiento<select value={storage} onChange={(e) => { setStorage(e.target.value); reset(); }}>{['DB_UNAVAILABLE', 'DB_OPEN_REJECTED', 'DB_SCHEMA_INCOMPATIBLE', 'IDB_ACCESS_ERROR'].map((v) => <option key={v}>{v}</option>)}</select></label>}
        <label>Recuperación del fixture<select value={retryMode} onChange={(e) => setRetryMode(e.target.value)}><option value="persistent">Persiste el fallo (agotar reintento)</option><option value="recover">Retirar fallo y recuperar</option></select></label>
        {kind === 'visual' && <><label>Gravedad visual<select value={visualLevel} onChange={(e) => setVisualLevel(e.target.value)}><option value="recoverable">Componente</option><option value="section_failure">Sección</option></select></label><label>Estado visual<select value={visualState} onChange={(e) => setVisualState(e.target.value)}>{['detected', 'recovering', 'failed', 'blocked'].map((v) => <option key={v}>{v}</option>)}</select></label><label><input type="checkbox" checked={actionsEnabled} onChange={(e) => setActionsEnabled(e.target.checked)}/> Acciones visuales disponibles</label></>}
        <label>Portapapeles<select value={copyMode} onChange={(e) => setCopyMode(e.target.value)}><option value="browser">Copia manual al navegador</option><option value="memory">Adaptador local en memoria</option><option value="failure">Fallo simulado</option></select></label>
        <button className="ui-button ui-button--primary" onClick={start}>{isRender ? 'Provocar error de componente' : 'Generar incidencia controlada'}</button>
        <button className="ui-button ui-button--secondary" onClick={reset}>Restablecer prueba</button>
      </section>
      <div className="incident-qa__work">
        <section aria-labelledby="qa-system"><h2 id="qa-system">Estado del sistema</h2><div className="incident-qa__context">
          <label>Tenant ficticio<select value={tenant} onChange={(e) => changeContext(e.target.value, actor)}><option>QA-A</option><option>QA-B</option></select></label>
          <label>Actor ficticio<select value={actor} onChange={(e) => changeContext(tenant, e.target.value)}><option>QA-OWNER</option><option>QA-STAFF</option></select></label>
        </div><p>{qaId} · {name} · {isRender ? 'Excepción auténtica de React en fixture' : kind === 'visual' ? 'Demostración visual' : 'Falla simulada de infraestructura'}</p>
          <p role="status">Conexión simulada: {online} · Transporte QA en memoria: {metrics.transportCalls} llamadas · Recepciones ficticias internas: {metrics.simulatedReceipts}</p>
          {incidentGuard && !incidentGuard() && <p role="alert">El actor o tenant cambió. El incidente anterior está bloqueado; genera uno nuevo.</p>}
        </section>
        <section aria-labelledby="qa-recovery"><h2 id="qa-recovery">Vista de recuperación</h2><p>Shell de prueba · Configuración y navegación ficticias permanecen disponibles.</p>
          {recovery || <RenderFixture fail={false}/>}
        </section>
        <section aria-labelledby="qa-diagnostic"><h2 id="qa-diagnostic">Diagnóstico</h2><p>{incident ? `${incident.safe_code} · ${incident.category} · ${incident.severity}` : 'Provoca el fallo para capturar un diagnóstico seguro.'}</p>
          {normalization && <p>Normalizador real: {normalization.failureKind} · {normalization.reportable ? 'Reportable' : 'Rechazo esperado; sin aviso global'}</p>}
          <details><summary>Inspeccionar última copia local</summary><pre>{metrics.lastCopied || 'Aún no hay copia.'}</pre></details>
        </section>
        <section aria-labelledby="qa-report"><h2 id="qa-report">Reporte y comunicación</h2><p>Abre «Reportar problema» en la vista afectada. El consentimiento prueba el transporte local. Telegram abre el canal público como referencia; el mensaje no se adjunta ni se envía. Para contactar a soporte, copia el texto y envíalo manualmente por un medio verificado, o inspecciona el correo local hacia example.invalid.</p>
          {!fired && <p>Formulario disponible después de crear una incidencia.</p>}

          <details><summary>Inspeccionar borrador de correo</summary><pre>{metrics.emailDraft ? decodeURIComponent(metrics.emailDraft) : 'Prepara el mensaje y pulsa «Inspeccionar borrador local».'}</pre></details>
          {metrics.emailDraft && incidentGuard?.() && <><p>Opcional: el borrador externo usa un destinatario de prueba no entregable. No lo envíes.</p><a className="ui-button ui-button--secondary" href={metrics.emailDraft} onClick={() => setEmailStatus('Se solicitó abrir un borrador de prueba. Si no aparece, puede que no haya un cliente de correo asociado; la inspección local sigue disponible.')}>Abrir borrador de prueba en correo</a></>}
          {emailStatus && <p role="status">{emailStatus}</p>}
        </section>
        <section aria-labelledby="qa-results"><h2 id="qa-results">Resultados</h2><p>Registrar un resultado es una decisión manual; abrir un escenario nunca lo aprueba.</p>
          <label>Resultado de {qaId}<select value={currentResult.result} onChange={(e) => updateResult({ result: e.target.value })}>{['NOT RUN', 'PASS', 'FAIL', 'BLOCKED'].map((v) => <option key={v}>{v}</option>)}</select></label>
          <label>Observaciones opcionales (solo datos QA)<textarea value={currentResult.notes} maxLength={500} onChange={(e) => updateResult({ notes: e.target.value })}/></label>
          <button className="ui-button ui-button--secondary" onClick={exportResults}>Copiar resumen QA</button><p role="status">{exportStatus}</p>
          <ul className="incident-qa__results">{QA_SCENARIOS.map(([id, title]) => <li key={id}><strong>{id}</strong> {title}: {results[id]?.result || 'NOT RUN'}</li>)}</ul>
          <details><summary>Acciones observadas (máximo 30)</summary><ol>{events.map((event, i) => <li key={i}>{event}</li>)}</ol></details>
        </section>
        <footer><strong>LAB_QA</strong> · ISOLATED_INTEGRATION_QA pendiente. PRODUCTION_QA no autorizada. Sin migraciones ni cambios productivos.</footer>
      </div>
    </main>

  </div>;
}
