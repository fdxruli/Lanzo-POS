import React from 'react';
import { AlertTriangle, CheckCircle, Clock, Info, RotateCcw } from 'lucide-react';
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

export default function ExpirationWasteHistoryPanel() {
  const {
    items,
    summary,
    loading,
    error,
    source,
    hasReportsPermission,
    limit,
    isLimited,
    visibleRecords,
    totalRecords,
    refresh
  } = useExpirationWasteHistory({ limit: 100 });

  const sourceLabel = source === 'cloud' ? 'Cloud oficial' : 'Local del dispositivo';

  return (
    <section className="expiry-subview" aria-label="Historial de mermas por caducidad">
      <header className="expiry-subview-header">
        <div>
          <h3>Historial de mermas</h3>
          <p>Productos y lotes retirados del inventario por caducidad.</p>
        </div>
        <div className="expiry-subview-toolbar">
          <span className="expiry-source">{sourceLabel}</span>
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
          <strong>No tienes acceso al historial</strong>
          <p>Solicita permiso de reportes para consultar mermas.</p>
        </div>
      ) : error ? (
        <div className="expiry-state" role="alert">
          <AlertTriangle size={22} aria-hidden="true" />
          <strong>No se pudo cargar el historial</strong>
          <p>{error}</p>
        </div>
      ) : loading ? (
        <div className="expiry-state" role="status">
          <Clock size={20} className="expiry-spinner" aria-hidden="true" />
          Cargando movimientos registrados...
        </div>
      ) : (
        <>
          <div className="expiry-subview-summary">
            <span><strong>{formatCurrency(summary.total_loss_amount)}</strong> pérdidas registradas</span>
            <span><strong>{formatNumber(summary.total_quantity)}</strong> unidades retiradas</span>
            <span><strong>{formatNumber(summary.total_records)}</strong> movimientos</span>
          </div>
          {isLimited && (
            <p className="expiry-limit-note">
              Mostrando los últimos {formatNumber(visibleRecords || limit)} movimientos.
              {totalRecords > visibleRecords && ' El resumen incluye ' + formatNumber(totalRecords) + ' movimientos.'}
            </p>
          )}
          {items.length === 0 ? (
            <div className="expiry-state">
              <CheckCircle size={28} aria-hidden="true" />
              <strong>No hay mermas por caducidad registradas</strong>
              <p>Las bajas confirmadas de inventario aparecerán aquí.</p>
            </div>
          ) : (
            <div className="expiry-list" aria-label="Movimientos por caducidad">
              {items.map((item) => (
                <details className="expiry-row" key={item.id}>
                  <summary className="expiry-row-toggle">
                    <span className="expiry-row-content">
                      <strong className="expiry-product-name">{item.productName}</strong>
                      <span className="expiry-secondary">Lote {item.batchSku || item.batchId || 'sin código'} · {formatNumber(item.quantity)} {item.unit || 'u'}</span>
                      <span className="expiry-secondary">{formatDateTime(item.timestamp)}</span>
                    </span>
                    <span className="expiry-row-end">
                      <strong className="expiry-history-loss">−{formatCurrency(item.lossAmount)}</strong>
                      <span className="expiry-summary-chevron" aria-hidden="true">⌄</span>
                    </span>
                  </summary>
                  <div className="expiry-row-details">
                    <div className="expiry-row-facts">
                      <span>Merma: <strong>{getWasteTypeLabel(item.wasteType)}</strong></span>
                      <span>Costo unitario: <strong>{formatCurrency(item.costAtTime)}</strong></span>
                      <span>Responsable: <strong>{item.actorName || 'No especificado'}</strong></span>
                      {item.notes && <span>Notas: {item.notes}</span>}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
