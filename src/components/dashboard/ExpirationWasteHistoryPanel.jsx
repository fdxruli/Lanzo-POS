import React from 'react';
import {
  AlertTriangle,
  Barcode,
  BarChart3,
  CheckCircle,
  Clock,
  DollarSign,
  Info,
  Package,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { useExpirationWasteHistory } from '../../hooks/useExpirationWasteHistory';
import './ExpirationWasteHistoryPanel.css';

const formatCurrency = (value) => `$${Number(value || 0).toFixed(2)}`;

const formatNumber = (value) => {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
};

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';

  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })}`;
};

const getWasteTypeLabel = (type) => {
  if (type === 'partial') return 'Parcial';
  if (type === 'total') return 'Total';
  return 'Sin clasificar';
};

const SummaryCard = ({ icon: Icon, label, value, helper }) => (
  <article className="expiration-history-summary-card">
    <span className="expiration-history-summary-icon">
      <Icon size={18} />
    </span>
    <div>
      <span className="expiration-history-summary-label">{label}</span>
      <strong>{value}</strong>
      {helper && <small>{helper}</small>}
    </div>
  </article>
);

export default function ExpirationWasteHistoryPanel() {
  const {
    items,
    summary,
    loading,
    error,
    source,
    hasReportsPermission,
    refresh
  } = useExpirationWasteHistory({ limit: 100 });

  const sourceLabel = source === 'cloud' ? 'Cloud oficial' : 'Local del dispositivo';

  return (
    <section className="expiration-history-widget" aria-label="Historial de mermas por caducidad">
      <div className="expiration-history-header">
        <div className="expiration-history-title">
          <span className="expiration-history-title-icon">
            <Trash2 size={22} />
          </span>
          <div>
            <h3>Historial de mermas por caducidad</h3>
            <p>Consulta pérdidas por producto, lote, responsable y tipo de merma.</p>
          </div>
        </div>

        <div className="expiration-history-actions">
          <span className={`expiration-history-source expiration-history-source--${source}`}>
            {sourceLabel}
          </span>
          {hasReportsPermission && (
            <button
              type="button"
              className="expiration-history-refresh"
              onClick={refresh}
              disabled={loading}
            >
              <RotateCcw size={14} />
              {loading ? 'Cargando...' : 'Actualizar'}
            </button>
          )}
        </div>
      </div>

      {!hasReportsPermission ? (
        <div className="expiration-history-state expiration-history-state--warning">
          <Info size={24} />
          <div>
            <strong>Historial limitado</strong>
            <p>Necesitas acceso a reportes para consultar este historial.</p>
          </div>
        </div>
      ) : error ? (
        <div className="expiration-history-state expiration-history-state--error">
          <AlertTriangle size={24} />
          <div>
            <strong>No se pudo cargar el historial</strong>
            <p>{error}</p>
          </div>
        </div>
      ) : loading ? (
        <div className="expiration-history-state">
          <Clock className="expiration-history-spinner" size={24} />
          <span>Cargando historial de mermas por caducidad...</span>
        </div>
      ) : (
        <>
          <div className="expiration-history-summary-grid">
            <SummaryCard
              icon={DollarSign}
              label="Total perdido"
              value={formatCurrency(summary.total_loss_amount)}
              helper={`${formatNumber(summary.total_records)} registros`}
            />
            <SummaryCard
              icon={BarChart3}
              label="Cantidad mermada"
              value={formatNumber(summary.total_quantity)}
              helper="Unidades registradas"
            />
            <SummaryCard
              icon={Package}
              label="Productos afectados"
              value={formatNumber(summary.total_products)}
            />
            <SummaryCard
              icon={Barcode}
              label="Lotes afectados"
              value={formatNumber(summary.total_batches)}
            />
            <SummaryCard
              icon={Trash2}
              label="Mermas totales"
              value={formatNumber(summary.total_count)}
            />
            <SummaryCard
              icon={Info}
              label="Mermas parciales"
              value={formatNumber(summary.partial_count)}
            />
          </div>

          {items.length === 0 ? (
            <div className="expiration-history-empty">
              <CheckCircle size={42} />
              <div>
                <strong>Aún no hay mermas por caducidad registradas.</strong>
                <p>Cuando mandes un lote a merma, aparecerá aquí.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="expiration-history-table-wrap">
                <table className="expiration-history-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Producto</th>
                      <th>Lote</th>
                      <th>Cantidad</th>
                      <th>Costo unitario</th>
                      <th>Pérdida</th>
                      <th>Tipo</th>
                      <th>Responsable</th>
                      <th>Notas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.timestamp)}</td>
                        <td>{item.productName}</td>
                        <td>{item.batchSku || item.batchId || 'Lote'}</td>
                        <td>{formatNumber(item.quantity)} {item.unit || 'u'}</td>
                        <td>{formatCurrency(item.costAtTime)}</td>
                        <td className="expiration-history-loss">-{formatCurrency(item.lossAmount)}</td>
                        <td>
                          <span className={`expiration-history-type expiration-history-type--${item.wasteType}`}>
                            {getWasteTypeLabel(item.wasteType)}
                          </span>
                        </td>
                        <td>{item.actorName || 'No especificado'}</td>
                        <td>{item.notes || 'Sin notas'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="expiration-history-mobile-list">
                {items.map((item) => (
                  <article key={item.id} className="expiration-history-mobile-card">
                    <div className="expiration-history-mobile-head">
                      <div>
                        <h4>{item.productName}</h4>
                        <span>{formatDateTime(item.timestamp)}</span>
                      </div>
                      <strong>-{formatCurrency(item.lossAmount)}</strong>
                    </div>
                    <div className="expiration-history-mobile-grid">
                      <span>Lote</span><b>{item.batchSku || item.batchId || 'Lote'}</b>
                      <span>Cantidad</span><b>{formatNumber(item.quantity)} {item.unit || 'u'}</b>
                      <span>Costo</span><b>{formatCurrency(item.costAtTime)}</b>
                      <span>Tipo</span><b>{getWasteTypeLabel(item.wasteType)}</b>
                      <span>Responsable</span><b>{item.actorName || 'No especificado'}</b>
                    </div>
                    {item.notes && <p className="expiration-history-mobile-notes">{item.notes}</p>}
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
