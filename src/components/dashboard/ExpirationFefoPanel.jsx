import React from 'react';
import {
  AlertTriangle,
  Barcode,
  CheckCircle,
  Clock,
  DollarSign,
  Info,
  Package,
  RotateCcw,
  TrendingDown
} from 'lucide-react';
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

const SummaryCard = ({ icon: Icon, label, value, helper, tone = 'neutral' }) => (
  <article className={`expiration-fefo-summary-card expiration-fefo-summary-card--${tone}`}>
    <span className="expiration-fefo-summary-icon"><Icon size={18} /></span>
    <div>
      <span className="expiration-fefo-summary-label">{label}</span>
      <strong>{value}</strong>
      {helper && <small>{helper}</small>}
    </div>
  </article>
);

const RiskBadge = ({ level }) => (
  <span className={`expiration-fefo-risk expiration-fefo-risk--${level || 'ok'}`}>
    {RISK_LABELS[level] || RISK_LABELS.ok}
  </span>
);

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
    <section className="expiration-fefo-widget" aria-label="Prevención FEFO">
      <div className="expiration-fefo-header">
        <div className="expiration-fefo-title">
          <span className="expiration-fefo-title-icon"><Package size={22} /></span>
          <div>
            <h3>Prevención FEFO</h3>
            <p>Prioriza el lote que vence antes para reducir pérdidas por caducidad.</p>
          </div>
        </div>

        <div className="expiration-fefo-actions">
          <span className="expiration-fefo-range">{daysAhead} días</span>
          <span className={`expiration-fefo-source expiration-fefo-source--${source}`}>{sourceLabel}</span>
          {hasReportsPermission && (
            <button type="button" className="expiration-fefo-refresh" onClick={refresh} disabled={loading}>
              <RotateCcw size={14} />
              {loading ? 'Cargando...' : 'Actualizar'}
            </button>
          )}
        </div>
      </div>

      {!hasReportsPermission ? (
        <div className="expiration-fefo-state expiration-fefo-state--warning">
          <Info size={24} />
          <div>
            <strong>Prevención limitada</strong>
            <p>Necesitas acceso a reportes para consultar recomendaciones FEFO completas.</p>
          </div>
        </div>
      ) : error ? (
        <div className="expiration-fefo-state expiration-fefo-state--error">
          <AlertTriangle size={24} />
          <div>
            <strong>No se pudieron cargar las recomendaciones</strong>
            <p>{error}</p>
          </div>
        </div>
      ) : loading ? (
        <div className="expiration-fefo-state">
          <Clock className="expiration-fefo-spinner" size={24} />
          <span>Calculando rotación FEFO y stock en riesgo...</span>
        </div>
      ) : (
        <>
          <div className="expiration-fefo-summary-grid">
            <SummaryCard icon={Package} label="Productos en riesgo" value={formatNumber(summary.products_with_risk)} tone={summary.products_with_risk > 0 ? 'warning' : 'success'} />
            <SummaryCard icon={Barcode} label="Lotes en riesgo" value={formatNumber(summary.batches_at_risk)} helper={`Rango: ${daysAhead} días`} tone={summary.batches_at_risk > 0 ? 'warning' : 'success'} />
            <SummaryCard icon={TrendingDown} label="Stock en riesgo" value={formatNumber(summary.stock_at_risk)} helper="Unidades disponibles" tone={summary.stock_at_risk > 0 ? 'warning' : 'success'} />
            <SummaryCard icon={DollarSign} label="Valor estimado en riesgo" value={formatCurrency(summary.value_at_risk)} tone={summary.value_at_risk > 0 ? 'warning' : 'success'} />
            <SummaryCard icon={AlertTriangle} label="Lotes críticos" value={formatNumber(summary.critical_batches)} helper="Vencen en 0 a 3 días" tone={summary.critical_batches > 0 ? 'danger' : 'neutral'} />
            <SummaryCard icon={AlertTriangle} label="Lotes vencidos" value={formatNumber(summary.expired_batches)} tone={summary.expired_batches > 0 ? 'danger' : 'neutral'} />
          </div>

          {items.length === 0 ? (
            <div className="expiration-fefo-empty">
              <CheckCircle size={42} />
              <div>
                <strong>No hay lotes con riesgo inmediato.</strong>
                <p>La rotación FEFO no detectó productos próximos a caducar en el rango configurado.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="expiration-fefo-table-wrap">
                <table className="expiration-fefo-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Lote recomendado</th>
                      <th>Caducidad</th>
                      <th>Días restantes</th>
                      <th>Stock</th>
                      <th>Valor</th>
                      <th>Riesgo</th>
                      <th>Recomendación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={`${item.productId}-${item.recommendedBatchId}`}>
                        <td><strong>{item.productName}</strong></td>
                        <td>{item.recommendedBatchSku || item.recommendedBatchId || 'Lote'}</td>
                        <td>{formatDate(item.recommendedExpiryDate)}</td>
                        <td>{formatDays(item.daysRemaining)}</td>
                        <td>{formatNumber(item.availableStock)} {item.unit || 'u'}</td>
                        <td>{formatCurrency(item.valueAtRisk)}</td>
                        <td><RiskBadge level={item.riskLevel} /></td>
                        <td>
                          <span className="expiration-fefo-recommendation">{item.recommendation}</span>
                          {item.newerBatchesCount > 0 && (
                            <small className="expiration-fefo-fefo-note">FEFO: hay lotes más nuevos con stock.</small>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="expiration-fefo-mobile-list">
                {items.map((item) => (
                  <article key={`${item.productId}-${item.recommendedBatchId}`} className={`expiration-fefo-mobile-card expiration-fefo-mobile-card--${item.riskLevel}`}>
                    <div className="expiration-fefo-mobile-head">
                      <div>
                        <h4>{item.productName}</h4>
                        <span>{item.recommendedBatchSku || item.recommendedBatchId || 'Lote'}</span>
                      </div>
                      <RiskBadge level={item.riskLevel} />
                    </div>
                    <div className="expiration-fefo-mobile-grid">
                      <span>Caducidad</span><b>{formatDate(item.recommendedExpiryDate)}</b>
                      <span>Días</span><b>{formatDays(item.daysRemaining)}</b>
                      <span>Stock</span><b>{formatNumber(item.availableStock)} {item.unit || 'u'}</b>
                      <span>Valor</span><b>{formatCurrency(item.valueAtRisk)}</b>
                    </div>
                    {item.newerBatchesCount > 0 && (
                      <p className="expiration-fefo-mobile-note">FEFO: vender primero este lote antes de usar lotes nuevos.</p>
                    )}
                    <p className="expiration-fefo-mobile-recommendation">{item.recommendation}</p>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
