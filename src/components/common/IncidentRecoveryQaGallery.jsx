import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutDashboard, Moon, RefreshCw, Sun } from 'lucide-react';
import IncidentRecoveryPanel from './IncidentRecoveryPanel';
import './IncidentRecoveryQaGallery.css';

const RECOVERY_STATES = Object.freeze([
  ['detected', 'Problema identificado'],
  ['recovering', 'Recuperación en curso'],
  ['failed', 'Reintento fallido'],
  ['blocked', 'Acción bloqueada']
]);

const STATUS_COPY = Object.freeze({
  detected: 'Puedes intentar recuperar esta vista. Las demás funciones disponibles siguen en pantalla.',
  recovering: 'Estamos intentando recuperar esta vista. El resultado se mostrará cuando pueda verificarse.',
  failed: 'El intento no resolvió el problema. Solicita ayuda antes de volver a intentarlo.',
  blocked: 'La acción permanece bloqueada hasta verificar que sea seguro continuar.'
});

export default function IncidentRecoveryQaGallery() {
  const [level, setLevel] = useState('2');
  const [theme, setTheme] = useState('light');
  const [recoveryState, setRecoveryState] = useState('detected');
  const retryTimer = useRef(null);
  const headingRef = useRef(null);
  const isCritical = level === '3';

  useEffect(() => {
    const previousTheme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    return () => {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      if (previousTheme) document.documentElement.setAttribute('data-theme', previousTheme);
      else document.documentElement.removeAttribute('data-theme');
    };
  }, [theme]);

  useEffect(() => {
    if (!isCritical) return undefined;
    const root = document.getElementById('root');
    if (!root) return undefined;
    const previousInert = Boolean(root.inert);
    const previousAriaHidden = root.getAttribute('aria-hidden');
    root.inert = true;
    root.setAttribute('aria-hidden', 'true');
    const focusFrame = window.requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      root.inert = previousInert;
      if (previousAriaHidden === null) root.removeAttribute('aria-hidden');
      else root.setAttribute('aria-hidden', previousAriaHidden);
    };
  }, [isCritical]);

  const numericLevel = Number(level);
  const severity = numericLevel === 1
    ? 'recoverable'
    : numericLevel === 3
      ? 'critical_blocker'
      : 'section_failure';
  const timestamp = new Date().toISOString();
  const metadata = {
    code: numericLevel === 3 ? 'FINANCIAL_RESULT_UNKNOWN' : 'UI_RECOVERY_PREVIEW',
    categoryLabel: numericLevel === 3 ? 'Operación financiera' : 'Interfaz',
    section: numericLevel === 1 ? 'Gráfica de ventas' : numericLevel === 2 ? 'Ventas' : 'Cobro',
    timestamp,
    formattedTimestamp: new Date(timestamp).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
    appVersion: 'Vista local de QA',
    online: true,
    recoveryStatus: recoveryState
  };

  const handleRetry = () => {
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    setRecoveryState('recovering');
    retryTimer.current = window.setTimeout(() => {
      setRecoveryState('failed');
      retryTimer.current = null;
    }, 1100);
  };

  const primaryAction = recoveryState === 'recovering'
    ? {
      label: 'Recuperando…',
      busy: true,
      disabled: true
    }
    : recoveryState === 'failed'
      ? {
        label: 'Reintento agotado',
        disabled: true,
        disabledReason: 'Este intento ya se utilizó. Solicita ayuda antes de continuar.'
      }
      : recoveryState === 'blocked'
        ? {
          label: numericLevel === 3 ? 'Reintentar operación' : 'Reintentar sección',
          disabled: true,
          disabledReason: 'La acción está bloqueada mientras no se verifique el estado.'
        }
        : {
          label: numericLevel === 1 ? 'Reintentar' : numericLevel === 3 ? 'Reintentar operación' : 'Reintentar sección',
          onClick: handleRetry,
          icon: <RefreshCw size={17} aria-hidden="true" />,
          disabled: numericLevel === 3,
          disabledReason: numericLevel === 3 ? 'El resultado del cobro requiere verificación.' : undefined
        };

  const panel = (
    <IncidentRecoveryPanel
      severity={severity}
      title={numericLevel === 1
        ? 'No pudimos cargar esta información'
        : numericLevel === 2
          ? 'No pudimos mostrar esta sección'
          : 'Necesitamos verificar esta operación'}
      description={numericLevel === 1
        ? 'Puedes intentarlo nuevamente. El resto de Lanzo POS sigue disponible.'
        : numericLevel === 2
          ? 'Ocurrió un problema inesperado. Puedes intentar recuperar esta sección sin reiniciar todo Lanzo POS.'
          : 'No pudimos confirmar el resultado. Para evitar duplicaciones, algunas acciones permanecerán temporalmente bloqueadas.'}
      metadata={metadata}
      recoveryNotice={isCritical
        ? `Escenario sintético de QA: no representa un cobro real. ${STATUS_COPY[recoveryState]}`
        : STATUS_COPY[recoveryState]}
      operationDetails={numericLevel === 3 ? {
        title: 'Resultado de cobro no confirmado',
        description: 'No vuelvas a registrar ni a repetir esta operación hasta comprobar su resultado.',
        blockedActions: ['Repetir el cobro', 'Confirmar la operación por segunda vez'],
        verification: 'Consulta el recibo o ledger canónico con soporte antes de continuar.'
      } : null}
      primaryAction={primaryAction}
      titleRef={headingRef}
    />
  );

  return (
    <div className="incident-qa">
      <header className="incident-qa__toolbar">
        <div className="incident-qa__brand">
          <span className="incident-qa__brand-mark" aria-hidden="true"><LayoutDashboard size={20} /></span>
          <div><strong>Lanzo POS</strong><span>Vista sintética de QA · solo desarrollo</span></div>
        </div>
        <div className="incident-qa__controls" aria-label="Controles de escenario">
          <label>
            Nivel
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="1">1 · Recuperable</option>
              <option value="2">2 · Sección</option>
              <option value="3">3 · Bloqueo crítico</option>
            </select>
          </label>
          <label>
            Estado
            <select value={recoveryState} onChange={(event) => setRecoveryState(event.target.value)}>
              {RECOVERY_STATES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="ui-button ui-button--secondary incident-qa__theme"
            onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
            aria-label={theme === 'light' ? 'Activar tema oscuro' : 'Activar tema claro'}
          >
            {theme === 'light' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
            {theme === 'light' ? 'Oscuro' : 'Claro'}
          </button>
        </div>
      </header>

      <p className="incident-qa__disclaimer" role="status">
        Errores y datos de muestra: no ejecuta operaciones, no envía reportes y no confirma recuperaciones.
      </p>

      {numericLevel === 3 ? (
        <main className="incident-qa__critical-stage">
          <div className="incident-qa__critical-context">
            <p className="incident-qa__eyebrow">Operación afectada · cobro pendiente de verificación</p>
            <h1>Centro de recuperación</h1>
            <p>El acceso a la operación permanece bloqueado hasta confirmar su resultado.</p>
          </div>
          {createPortal(panel, document.body)}
        </main>
      ) : (
        <div className="incident-qa__shell">
          <aside className="incident-qa__sidebar" aria-label="Navegación de muestra">
            <div className="incident-qa__sidebar-title"><LayoutDashboard size={18} aria-hidden="true" /> Lanzo</div>
            <span>POS</span><span>Ventas</span><span>Productos</span><span>Configuración</span>
          </aside>
          <main className="incident-qa__workspace">
            <div className="incident-qa__page-heading">
              <div><p className="incident-qa__eyebrow">Administración</p><h1>{numericLevel === 1 ? 'Resumen de ventas' : 'Ventas'}</h1></div>
              <span>Vista de muestra</span>
            </div>
            {numericLevel === 1 ? (
              <div className="incident-qa__dashboard-grid">
                <section className="incident-qa__sample-card">
                  <p className="incident-qa__eyebrow">Últimos 7 días</p>
                  <h2>Actividad reciente</h2>
                  <div className="incident-qa__chart-placeholder" aria-label="Gráfica de ventas de muestra" />
                </section>
                <section className="incident-qa__widget">
                  <h2>Ventas por día</h2>
                  {panel}
                </section>
              </div>
            ) : (
              <section className="incident-qa__section-content">
                <p className="incident-qa__breadcrumb">Inicio <span aria-hidden="true">/</span> Ventas</p>
                {panel}
              </section>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
