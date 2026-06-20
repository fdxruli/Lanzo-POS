import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { getAIAgentUsage } from '../../services/aiAgentUsageService';
import './AIAgentUsageLegend.css';

const POLL_INTERVAL_MS = 15000;

const getUsageText = (usage) => {
  if (!usage?.success) return usage?.message || 'No se pudo consultar el uso de agentes IA.';
  if (usage.remaining <= 0) return 'Ya usaste todos los análisis IA disponibles para esta licencia Pro.';
  if (usage.remaining === 1) return 'Te queda 1 análisis IA disponible para esta licencia Pro.';
  return `Te quedan ${usage.remaining} análisis IA disponibles para esta licencia Pro.`;
};

export default function AIAgentUsageLegend({ enabled = true }) {
  const [usage, setUsage] = useState(null);
  const [isLoading, setIsLoading] = useState(enabled);
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

  return (
    <section className={`ai-agent-usage-legend ${isLoading ? 'is-loading' : ''} ${isError ? 'is-error' : ''}`}>
      <div className="ai-agent-usage-main">
        <div className="ai-agent-usage-icon">
          {isError ? <AlertCircle size={20} /> : <ShieldCheck size={20} />}
        </div>
        <div className="ai-agent-usage-copy">
          <h3 className="ai-agent-usage-title">Uso de Agentes IA Pro</h3>
          <p className="ai-agent-usage-text">
            {isLoading && !usage ? 'Consultando análisis disponibles...' : getUsageText(usage)}
          </p>
          {lastUpdated && (
            <p className="ai-agent-usage-text">
              Actualizado: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>

      {usage?.success && (
        <div className="ai-agent-usage-panel">
          <div className="ai-agent-usage-numbers">
            <div className="ai-agent-usage-stat">
              <span>Total</span>
              <strong>{usage.limit}</strong>
            </div>
            <div className="ai-agent-usage-stat">
              <span>Usados</span>
              <strong>{usage.used}</strong>
            </div>
            <div className="ai-agent-usage-stat">
              <span>Disponibles</span>
              <strong>{usage.remaining}</strong>
            </div>
          </div>
          <div className="ai-agent-usage-progress" aria-hidden="true">
            <div className="ai-agent-usage-progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <button className="ai-agent-usage-refresh" type="button" onClick={() => loadUsage()} disabled={isLoading}>
        <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
        Actualizar uso
      </button>
    </section>
  );
}
