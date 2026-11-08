import React from 'react';
import { AlertTriangle, CheckCircle, Clock, Info, RotateCcw } from 'lucide-react';
import { useExpirationFefoRecommendations } from '../../hooks/useExpirationFefoRecommendations';
import './ExpirationFefoPanel.css';

const RISK_LABELS = Object.freeze({
  expired: 'Vencido',
  critical: 'Crítico',
  warning: 'Advertencia',
  watch: 'Vigilancia',
  ok: 'OK'
});

const formatCurrency = (value) => `$${Number(value || 0).toFixed(2)}`;

const formatNumber = (value) => {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
};

const formatDate = (value) => {
  if (!value) return 'Sin fecha';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleDateString();
};

const formatDays = (value) => {
  const days = Number(value);
  if (!Number.isFinite(days)) return 'Sin fecha';
  if (days < 0) return `Venció hace ${Math.abs(days)} día${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  return `${days} días`;
};

export default function ExpirationFefoPanel() {
  const {
    items,
    summary,
    loading,
    error,
    source,
    hasReportsPermission,
    daysAhead,
    refresh
  } = useExpirationFefoRecommendations({ daysAhead: 30, limit: 100 });

  const sourceLabel = source === 'cloud' ? 'Cloud oficial' : 'Local del dispositivo';

  return (
    <section className="expiry-subview" aria-label="Rotación preventiva de lotes">
      <header className="expiry-subview-header">
        <div>
          <h3>Rotación preventiva</h3>
          <p>Revisa primero el lote que vence antes. Los vencidos quedan fuera de la venta.</p>
        </div>
        <div className="expiry-subview-toolbar">
          <span className="expiry-source">{daysAhead} días · {sourceLabel}</span>
          {hasReportsPermission && (
            <button type="button" className="expiry-link" onClick={refresh} disabled={loading}>
              <RotateCcw size={15} aria-hidden="true" /> Actualizar
            </button>
          )}
        </div>
      </header>
      {!hasReportsPermission ? (
        <div className="expiry-state" role="status">
          <Info size={22} aria-hidden="true" />
          <strong>No tienes acceso a estas recomendaciones</strong>
          <p>Solicita el permiso de reportes para consultar rotación.</p>
        </div>
      ) : error ? (
        <div className="expiry-state" role="alert">
          <AlertTriangle size={22} aria-hidden="true" />
          <strong>No se pudo cargar la rotación</strong>
          <p>{error}</p>
        </div>
      ) : loading ? (
        <div className="expiry-state" role="status">
          <Clock size={20} className="expiry-spinner" aria-hidden="true" />
          Calculando prioridades por lote...
        </div>
      ) : (
        <>
          <div className="expiry-subview-summary">
            <span><strong>{formatNumber(summary.products_with_risk)}</strong> productos con riesgo</span>
            <span><strong>{formatNumber(summary.stock_at_risk)}</strong> unidades en riesgo</span>
            <span><strong>{formatCurrency(summary.value_at_risk)}</strong> valor estimado</span>
          </div>
          {items.length === 0 ? (
            <div className="expiry-state">
              <CheckCircle size={28} aria-hidden="true" />
              <strong>Sin lotes que priorizar</strong>
              <p>No hay riesgos de rotación detectados en el período consultado.</p>
            </div>
          ) : (
            <div className="expiry-list" aria-label="Lotes a priorizar">
              {items.map((item) => {
                const isExpired = item.riskLevel === 'expired';
                return (
                  <details key={String(item.productId) + ':' + String(item.recommendedBatchId)} className={'expiry-row expiry-row--' + (isExpired ? 'expired' : 'upcoming')}>
                    <summary className="expiry-row-toggle">
                      <span className="expiry-row-content">
                        <strong className="expiry-product-name">{item.productName}</strong>
                        <span className="expiry-secondary">Lote {item.recommendedBatchSku || item.recommendedBatchId || 'sin código'} · {formatNumber(item.availableStock)} {item.unit || 'u'}</span>
                        <span className="expiry-secondary">Caducidad: {formatDate(item.recommendedExpiryDate)}</span>
                      </span>
                      <span className="expiry-row-end">
                        <span className={'expiry-status expiry-status--' + (isExpired ? 'expired' : 'upcoming')}>
                          {isExpired ? 'No vender · vencido' : formatDays(item.daysRemaining)}
                        </span>
                        <span className="expiry-summary-chevron" aria-hidden="true">⌄</span>
                      </span>
                    </summary>
                    <div className="expiry-row-details">
                      <p className="expiry-row-hint">{isExpired
                        ? 'Este lote ya venció: no lo incluyas en la rotación de venta. Revisa su merma en Por atender.'
                        : item.recommendation}</p>
                      <div className="expiry-row-facts">
                        <span>Valor estimado: <strong>{formatCurrency(item.valueAtRisk)}</strong></span>
                        <span>Riesgo: <strong>{RISK_LABELS[item.riskLevel] || 'Revisión'}</strong></span>
                        {item.newerBatchesCount > 0 && <span>Hay {item.newerBatchesCount} lotes con fecha posterior.</span>}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
