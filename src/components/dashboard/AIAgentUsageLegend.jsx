import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calendar, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import { getAIAgentUsage } from '../../services/aiAgentUsageService';
import './AIAgentUsageLegend.css';

const POLL_INTERVAL_MS = 15000;

const formatPeriodDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};

const getUsageText = (usage) => {
  if (!usage?.success) return usage?.message || 'No se pudo consultar el uso de agentes IA.';
  if (usage.remaining <= 0) return `Sin consultas disponibles de ${usage.limit}.`;
  if (usage.remaining === 1) return `1 consulta disponible de ${usage.limit}.`;
  return `${usage.remaining} consultas disponibles de ${usage.limit}.`;
};

const getPeriodText = (usage) => {
  if (!usage?.success || !usage.periodStart || !usage.periodEnd) return null;

  const start = formatPeriodDate(usage.periodStart);
  const end = formatPeriodDate(usage.periodEnd);

  if (!start || !end) return null;
  return `${start} - ${end}`;
};

const getStatusContent = (status = {}) => {
  if (status.isChecking) {
    return { className: 'checking', icon: RefreshCw, label: 'Validando asistente' };
  }

  if (status.isApiReady) {
    return { className: 'online', icon: ShieldCheck, label: 'Asistente listo' };
  }

  if (status.isOnline) {
    return { className: 'warning', icon: AlertCircle, label: 'Asistente no disponible' };
  }

  return { className: 'offline', icon: WifiOff, label: 'Sin conexion' };
};

export default function AIAgentUsageLegend({ enabled = true, connectionStatus = null, onRefreshStatus = null }) {
  const [usage, setUsage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadUsage = useCallback(async ({ silent = false } = {}) => {
    if (!enabled) return;

    if (!silent) setIsLoading(true);

    try {
      const response = await getAIAgentUsage();
      setUsage(response);
      setLastUpdated(new Date());
    } catch (error) {
      setUsage({
        success: false,
        limit: 0,
        used: 0,
        remaining: 0,
        message: error.message || 'No se pudo consultar el uso de agentes IA.'
      });
      setLastUpdated(new Date());
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;

    loadUsage();

    const intervalId = window.setInterval(() => {
      loadUsage({ silent: true });
    }, POLL_INTERVAL_MS);

    const handleFocus = () => loadUsage({ silent: true });
    window.addEventListener('focus', handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [enabled, loadUsage]);

  const progress = useMemo(() => {
    if (!usage?.success || !usage.limit) return 0;
    return Math.min(Math.max((usage.used / usage.limit) * 100, 0), 100);
  }, [usage]);

  if (!enabled) return null;

  const isError = usage && !usage.success;
  const periodText = getPeriodText(usage);
  const periodEnd = formatPeriodDate(usage?.periodEnd);
  const statusContent = getStatusContent(connectionStatus || {});
  const StatusIcon = statusContent.icon;

  const handleRefresh = async () => {
    await Promise.all([
      loadUsage(),
      onRefreshStatus ? onRefreshStatus() : Promise.resolve()
    ]);
  };

  return (
    <section className={`ai-agent-usage-legend ${isLoading ? 'is-loading' : ''} ${isError ? 'is-error' : ''}`}>
      <div className="ai-agent-usage-header">
        <div className="ai-agent-usage-main">
          <div className="ai-agent-usage-icon">
            {isError ? <AlertCircle size={18} /> : <ShieldCheck size={18} />}
          </div>
          <div className="ai-agent-usage-copy">
            <span className="ai-agent-usage-kicker">Uso del periodo</span>
            <h3 className="ai-agent-usage-title">{isLoading && !usage ? 'Consultando disponibilidad' : getUsageText(usage)}</h3>
            {periodText && (
              <p className="ai-agent-period-meta">
                <Calendar size={13} />
                {periodText}
              </p>
            )}
          </div>
        </div>

        <div className="ai-agent-usage-controls">
          <span className={`ai-agent-usage-status ${statusContent.className}`}>
            <StatusIcon size={13} className={connectionStatus?.isChecking ? 'spinning' : ''} />
            {statusContent.label}
          </span>
          <button
            className="ai-agent-usage-refresh"
            type="button"
            onClick={handleRefresh}
            disabled={isLoading || connectionStatus?.isChecking}
            aria-label="Actualizar uso y estado"
            title={lastUpdated ? 'Actualizar uso y estado' : 'Consultar uso y estado'}
          >
            <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {usage?.success && (
        <div className="ai-agent-usage-panel">
          <div className="ai-agent-usage-stat">
            <span>Usadas</span>
            <strong>{usage.used}</strong>
          </div>
          <div className="ai-agent-usage-stat">
            <span>Disponibles</span>
            <strong>{usage.remaining}</strong>
          </div>
          <div className="ai-agent-usage-stat">
            <span>Vence</span>
            <strong>{periodEnd || 'N/D'}</strong>
          </div>
          <div className="ai-agent-usage-progress" aria-hidden="true">
            <div className="ai-agent-usage-progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}
