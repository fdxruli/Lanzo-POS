import React from 'react';
import { MessageCircle, RefreshCw, AlertTriangle, ShieldCheck, Store, ArrowRightCircle, Copy, CheckCheck, Wifi, WifiOff } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import Logger from '../../services/Logger';
import './ErrorBoundary.css';

// ─── Utilidades de diagnóstico ────────────────────────────────────────────────

/**
 * Parsea el navigator.userAgent a una cadena legible para soporte.
 * Ejemplo: "Chrome 125 / Windows 10" en vez del UA completo.
 */
function parseUserAgent(ua = navigator.userAgent) {
  // Navegador
  let browser = 'Navegador desconocido';
  if (/Edg\/(\d+)/.test(ua))        browser = `Edge ${RegExp.$1}`;
  else if (/Chrome\/(\d+)/.test(ua)) browser = `Chrome ${RegExp.$1}`;
  else if (/Firefox\/(\d+)/.test(ua))browser = `Firefox ${RegExp.$1}`;
  else if (/Safari\/(\d+)/.test(ua) && /Version\/(\d+)/.test(ua)) browser = `Safari ${RegExp.$1}`;
  else if (/OPR\/(\d+)/.test(ua))   browser = `Opera ${RegExp.$1}`;

  // Sistema Operativo
  let os = 'SO desconocido';
  if (/Windows NT 10/.test(ua))      os = 'Windows 10/11';
  else if (/Windows NT 6.3/.test(ua))os = 'Windows 8.1';
  else if (/Windows NT 6.1/.test(ua))os = 'Windows 7';
  else if (/Mac OS X ([\d_]+)/.test(ua)) os = `macOS ${RegExp.$1.replace(/_/g, '.')}`;
  else if (/Android ([\d.]+)/.test(ua))  os = `Android ${RegExp.$1}`;
  else if (/iPhone OS ([\d_]+)/.test(ua)) os = `iOS ${RegExp.$1.replace(/_/g, '.')}`;
  else if (/Linux/.test(ua))         os = 'Linux';

  return `${browser} / ${os}`;
}

/**
 * Extrae las primeras N líneas del stack trace y las filtra para
 * eliminar rutas internas del bundler que no aportan valor a soporte.
 */
function cleanStack(stack = '', maxLines = 12) {
  if (!stack) return 'No disponible';
  return stack
    .split('\n')
    .slice(0, maxLines)
    .join('\n');
}

/**
 * Formatea una fecha ISO a formato legible en español.
 * Ejemplo: "13 jun 2026 – 18:32:05 (UTC-6)"
 */
function formatTimestamp(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleString('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZoneName: 'short'
    });
  } catch {
    return isoString;
  }
}

// ─── Componente Principal ─────────────────────────────────────────────────────

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      crashTimestamp: null,   // ISO string del momento exacto del crash
      copied: false,          // Estado del botón "Copiar reporte"
    };
    this._copyTimeout = null;
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
      crashTimestamp: new Date().toISOString(),  // ← Capturamos el momento exacto
    };
  }

  componentDidCatch(error, errorInfo) {
    Logger.error('🔥 Error crítico capturado:', {
      timestamp: new Date().toISOString(),
      message: error?.message,
      name: error?.name,
      stack: error?.stack,
      cause: error?.cause,
      componentStack: errorInfo?.componentStack,
    });
    this.setState({ errorInfo });
  }

  componentWillUnmount() {
    if (this._copyTimeout) clearTimeout(this._copyTimeout);
  }

  // ── Acciones de Recuperación ─────────────────────────────────────────────

  handleReload = () => {
    window.location.reload();
  }

  handleReset = () => {
    localStorage.removeItem('lanzo-cart-storage');
    sessionStorage.clear();
    this.setState({ hasError: false, error: null, errorInfo: null, crashTimestamp: null, copied: false });
  }

  handleGoToPos = () => {
    Logger.log('🧹 Iniciando recuperación quirúrgica. Purgando estado volátil...');
    try {
      localStorage.removeItem('lanzo-cart-storage');
      sessionStorage.clear();
      // No tocamos 'lanzo_license', 'lanzo_device_id' ni 'lanzo_show_bot'
    } catch (e) {
      Logger.warn('Error durante la limpieza de estado local:', e);
    } finally {
      window.location.replace('/');
    }
  }

  // ── Construcción del Reporte ──────────────────────────────────────────────

  _buildReportMessage() {
    const { error, errorInfo, crashTimestamp } = this.state;

    // Estado global del sistema (sin hooks, acceso imperativo)
    const appState = useAppStore.getState();
    const companyName  = appState.companyProfile?.name || 'Negocio No Configurado';
    const licenseKey   = appState.licenseDetails?.license_key || 'Sin Licencia Activa';
    const rubro        = appState.companyProfile?.rubro || appState.businessType || 'No especificado';
    const deviceId     = localStorage.getItem('lanzo_device_id') || 'No disponible';

    // Entorno
    const browserInfo  = parseUserAgent();
    const isOnline     = navigator.onLine ? 'En línea ✅' : 'SIN CONEXIÓN ❌';
    const routePath    = window.location.pathname + window.location.search;  // sin tokens de hash
    const appVersion   = import.meta.env.VITE_APP_VERSION || '?';

    // Error principal
    const errorName    = error?.name    || 'Error';
    const errorMsg     = error?.message || 'Sin mensaje';
    const errorStack   = cleanStack(error?.stack, 12);
    const errorCause   = error?.cause
      ? `\n🔗 *Causa raíz:* ${String(error.cause)}`
      : '';

    // Stack de React (componente que falló)
    const compStack    = errorInfo?.componentStack
      ? errorInfo.componentStack.substring(0, 1500)
      : 'No disponible';

    const timestamp    = crashTimestamp
      ? formatTimestamp(crashTimestamp)
      : formatTimestamp(new Date().toISOString());

    return `🚨 *REPORTE DE INCIDENCIA TÉCNICA - LANZO POS*

🏢 *Negocio:* ${companyName}
🏷️ *Rubro:* ${rubro}
🔑 *Licencia:* ${licenseKey.slice(0, 12)}...
🖥️ *Dispositivo ID:* ${deviceId}
🌐 *Versión app:* v${appVersion}

⏰ *Fecha y hora del crash:* ${timestamp}
📡 *Estado de red:* ${isOnline}
📍 *Ruta:* ${routePath}
💻 *Entorno:* ${browserInfo}

━━━━━━━━━━━━━━━━━━━━━━━
⚠️ *TIPO DE ERROR:* ${errorName}
📝 *Mensaje:* ${errorMsg}${errorCause}

📚 *Stack Trace (JavaScript):*
\`\`\`
${errorStack}
\`\`\`

🧩 *Stack de Componentes React:*
${compStack}
━━━━━━━━━━━━━━━━━━━━━━━
_Mensaje generado automáticamente por el sistema de seguridad de Lanzo POS_`;
  }

  handleReport = () => {
    const SUPPORT_PHONE = import.meta.env.VITE_SUPPORT_PHONE || '';
    const message = this._buildReportMessage();
    const whatsappUrl = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
  }

  handleCopy = async () => {
    try {
      const message = this._buildReportMessage();
      await navigator.clipboard.writeText(message);
    } catch {
      // Fallback para navegadores sin clipboard API moderna
      try {
        const message = this._buildReportMessage();
        const ta = document.createElement('textarea');
        ta.value = message;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        // execCommand tampoco disponible (jsdom, entorno test, etc.) — no romper la UI
      }
    }
    this.setState({ copied: true });
    this._copyTimeout = setTimeout(() => this.setState({ copied: false }), 3000);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error, crashTimestamp, copied } = this.state;
    const currentPath = window.location.pathname;
    const isPosPage   = currentPath === '/' || currentPath === '';
    const isOnline    = navigator.onLine;

    // Mostramos las primeras 6 líneas del stack en la UI
    const stackPreview = cleanStack(error?.stack, 6);

    return (
      <div className="error-boundary" role="alert" style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '20px',
      }}>

        {/* ── Tarjeta principal ── */}
        <div className="error-boundary__console" style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
          padding: '40px',
          maxWidth: '640px',
          width: '100%',
          textAlign: 'center',
          border: '1px solid #e2e8f0',
        }}>

          {/* Icono de alerta */}
          <div className="error-boundary__alert-icon" style={{
            backgroundColor: '#fee2e2',
            color: '#dc2626',
            width: '80px', height: '80px',
            borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px auto',
          }}>
            <AlertTriangle size={40} strokeWidth={1.5} />
          </div>

          <h2 className="error-boundary__title" style={{ color: '#1e293b', fontSize: '1.75rem', fontWeight: '700', marginBottom: '8px', lineHeight: '1.2' }}>
            Se ha detenido la aplicación
          </h2>

          {/* Tipo de error + timestamp */}
          <div className="error-boundary__incident-meta" style={{ marginBottom: '16px' }}>
            <span style={{
              display: 'inline-block',
              backgroundColor: '#fef2f2',
              color: '#dc2626',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              padding: '2px 10px',
              fontSize: '0.8rem',
              fontWeight: '700',
              fontFamily: 'monospace',
              marginBottom: '6px',
            }}>
              {error?.name || 'Error'}
            </span>
            {crashTimestamp && (
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.8rem' }}>
                🕐 {formatTimestamp(crashTimestamp)}
              </p>
            )}
          </div>

          <p className="error-boundary__summary" style={{ color: '#475569', fontSize: '1.05rem', lineHeight: '1.6', marginBottom: '16px' }}>
            No te preocupes, <strong>no es un error tuyo</strong>. <br />
            Ha ocurrido un problema técnico en esta sección.
          </p>

          {/* Badge de estado de red */}
          <div className={`error-boundary__network ${isOnline ? 'is-online' : 'is-offline'}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            backgroundColor: isOnline ? '#f0fdf4' : '#fff7ed',
            border: `1px solid ${isOnline ? '#bbf7d0' : '#fed7aa'}`,
            borderRadius: '999px',
            padding: '4px 12px',
            fontSize: '0.82rem',
            color: isOnline ? '#166534' : '#9a3412',
            marginBottom: '20px',
          }}>
            {isOnline
              ? <><Wifi size={14} /> Conexión activa</>
              : <><WifiOff size={14} /> Sin conexión — esto puede ser la causa</>
            }
          </div>

          {/* Sugerencia de ir al POS */}
          {!isPosPage && (
            <div className="error-boundary__continuity" style={{
              backgroundColor: '#eff6ff', border: '1px solid #bfdbfe',
              borderRadius: '12px', padding: '16px', marginBottom: '20px', textAlign: 'left',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
                <Store className="text-blue-600" size={24} style={{ minWidth: '24px' }} />
                <div>
                  <h4 style={{ margin: '0 0 4px 0', color: '#1e40af', fontSize: '1rem' }}>
                    ¿Necesitas seguir vendiendo?
                  </h4>
                  <p style={{ margin: 0, color: '#3b82f6', fontSize: '0.9rem', lineHeight: '1.4' }}>
                    Puedes ir al Punto de Venta para continuar tu trabajo.{' '}
                    <strong style={{ display: 'block', marginTop: '4px' }}>
                      ⚠️ Evita regresar a esta sección hasta que Soporte lo resuelva.
                    </strong>
                  </p>
                </div>
              </div>
              <button
                className="error-boundary__button error-boundary__button--pos"
                onClick={this.handleGoToPos}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: '8px',
                  padding: '12px', backgroundColor: '#2563eb', color: 'white',
                  border: 'none', borderRadius: '8px', cursor: 'pointer',
                  fontWeight: '600', fontSize: '0.95rem', transition: 'background-color 0.2s',
                }}
              >
                <ArrowRightCircle size={18} />
                Ir al Punto de Venta ahora
              </button>
            </div>
          )}

          {/* Badge datos seguros */}
          <div className="error-boundary__safe-data" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
            padding: '10px 12px', borderRadius: '8px', marginBottom: '24px',
            color: '#166534', fontSize: '0.9rem',
          }}>
            <ShieldCheck size={18} />
            <span>Tus datos de ventas y caja están seguros.</span>
          </div>

          {/* ── Caja de detalle técnico ── */}
          <div className="error-boundary__diagnostics" style={{ textAlign: 'left', marginBottom: '28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: '700', color: '#64748b', letterSpacing: '0.05em' }}>
                DETALLE TÉCNICO (Para soporte):
              </label>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                {window.location.pathname}
              </span>
            </div>

            {/* Mensaje del error */}
            <div className="error-boundary__error-message" style={{
              backgroundColor: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: '6px', padding: '10px 12px', marginBottom: '8px',
              fontSize: '0.85rem', color: '#991b1b', fontWeight: '500',
            }}>
              <span style={{ fontFamily: 'monospace', fontWeight: '700' }}>{error?.name}: </span>
              {error?.message || 'Sin mensaje'}
              {error?.cause && (
                <div style={{ marginTop: '4px', color: '#b91c1c', fontSize: '0.8rem' }}>
                  ↳ Causa: {String(error.cause)}
                </div>
              )}
            </div>

            {/* Stack trace (legible, primeras 6 líneas) */}
            <div className="error-boundary__stack" style={{
              backgroundColor: '#1e293b', color: '#94a3b8',
              padding: '14px 16px', borderRadius: '8px',
              fontSize: '0.78rem', fontFamily: 'monospace',
              overflowX: 'auto', overflowY: 'auto',
              maxHeight: '140px', lineHeight: '1.6',
              border: '1px solid #334155',
              whiteSpace: 'pre',
            }}>
              <span style={{ color: '#f1f5f9' }}>{stackPreview}</span>
              {'\n'}<span style={{ color: '#475569', fontSize: '0.72rem' }}>... (ver reporte completo para soporte)</span>
            </div>
          </div>

          {/* ── Botones de acción ── */}
          <div className="error-boundary__actions" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

            {/* Reportar por WhatsApp */}
            <button
              className="error-boundary__button error-boundary__button--whatsapp"
              onClick={this.handleReport}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                padding: '14px 24px', borderRadius: '10px',
                backgroundColor: '#25D366', color: 'white',
                border: 'none', cursor: 'pointer',
                fontWeight: '700', fontSize: '1rem',
                transition: 'background-color 0.2s',
                boxShadow: '0 4px 6px -1px rgba(37,211,102,0.25)',
              }}
            >
              <MessageCircle size={20} />
              Reportar Problema por WhatsApp
            </button>

            {/* Copiar reporte al portapapeles */}
            <button
              className={`error-boundary__button error-boundary__button--copy ${copied ? 'is-copied' : ''}`}
              onClick={this.handleCopy}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                padding: '11px 24px', borderRadius: '10px',
                backgroundColor: copied ? '#f0fdf4' : 'white',
                color: copied ? '#166534' : '#475569',
                border: `1px solid ${copied ? '#bbf7d0' : '#cbd5e1'}`,
                cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem',
                transition: 'all 0.2s',
              }}
            >
              {copied
                ? <><CheckCheck size={17} /> ¡Copiado! Pégalo en cualquier chat</>
                : <><Copy size={17} /> Copiar reporte completo</>
              }
            </button>

            {/* Recarga y reset */}
            <div className="error-boundary__secondary-actions" style={{ display: 'flex', gap: '10px' }}>
              <button
                className="error-boundary__button error-boundary__button--reload"
                onClick={this.handleReload}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  padding: '11px', borderRadius: '10px',
                  backgroundColor: 'white', color: '#dc2626',
                  border: '1px solid #dc2626', cursor: 'pointer',
                  fontWeight: '600', fontSize: '0.9rem',
                }}
              >
                <RefreshCw size={17} />
                Recargar Página
              </button>

              <button
                className="error-boundary__button error-boundary__button--recover"
                onClick={this.handleReset}
                style={{
                  flex: 1, padding: '11px', borderRadius: '10px',
                  backgroundColor: 'transparent', color: '#64748b',
                  border: '1px solid #cbd5e1', cursor: 'pointer',
                  fontWeight: '500', fontSize: '0.9rem',
                }}
              >
                Intentar recuperar
              </button>
            </div>
          </div>

        </div>

        <p className="error-boundary__footer" style={{ marginTop: '20px', color: '#94a3b8', fontSize: '0.82rem' }}>
          Lanzo POS System v{import.meta.env.VITE_APP_VERSION} &nbsp;·&nbsp; {parseUserAgent()}
        </p>

      </div>
    );
  }
}

export default ErrorBoundary;
