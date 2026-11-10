import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle, ChevronDown } from 'lucide-react';
import { normalizeBusinessTypes } from '../../utils/businessType';
import './WasteHistory.css';

const EMPTY_ARRAY = [];

const getReasonTone = (reason = '') => {
  const text = String(reason).toLowerCase();
  if (text.includes('venci') || text.includes('caduca')) return 'waste-reason--danger';
  if (['error', 'devolu', 'mal estado', 'dan', 'dano', 'podri'].some((term) => text.includes(term))) {
    return 'waste-reason--warning';
  }
  return '';
};

const formatWasteDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleDateString() + ' · ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function WasteHistory({
  logs,
  wasteLoaded = false,
  wasteError = null,
  onRetry = () => {},
  onNext = () => {},
  onPrev = () => {},
  hasMoreWaste = false,
  currentWastePageIndex = 0,
  isWasteLoading = false,
  activeRubros = EMPTY_ARRAY
}) {
  const pageLoss = logs.reduce((sum, log) => sum + (Number(log.lossAmount) || 0), 0);
  const pageReady = wasteLoaded && !isWasteLoading && !wasteError;
  const rubros = normalizeBusinessTypes(activeRubros);
  const description = rubros.includes('verduleria/fruteria')
    ? 'Consulta las pérdidas y desperdicios de tus productos.'
    : rubros.includes('food_service')
      ? 'Consulta los ingredientes y platillos desperdiciados.'
      : 'Consulta las pérdidas y mermas registradas.';

  return (
    <section className="waste-history-wrapper" aria-label="Historial local de mermas">
      <header className="waste-header">
        <h2>Mermas</h2>
        <p>{description}</p>
      </header>

      <div className="waste-summary" aria-label="Resumen de mermas">
        <div className="waste-summary-item">
          <span>Pérdida en esta página</span>
          <strong className="waste-summary-loss">{pageReady ? '$' + pageLoss.toFixed(2) : '—'}</strong>
        </div>
        <div className="waste-summary-item">
          <span>Registros en esta página</span>
          <strong>{pageReady ? logs.length : '—'}</strong>
        </div>
      </div>

      <p className="waste-source-note" role="note">
        Origen: almacenamiento de este dispositivo. No es un historial consolidado
        de otros dispositivos ni del registro Cloud de Caducidad.
        {pageReady && (hasMoreWaste
          ? ' Hay más registros locales para consultar.'
          : ' No se detectaron más registros en esta consulta local; esto no confirma el historial completo del negocio.')}
      </p>

      <div className="waste-list-meta">
        {isWasteLoading || (!wasteLoaded && !wasteError)
          ? 'Cargando registros...'
          : wasteError
            ? 'Consulta no disponible'
            : logs.length + ' registro' + (logs.length === 1 ? '' : 's') + ' en esta página'}
      </div>

      {isWasteLoading || (!wasteLoaded && !wasteError) ? (
        <div className="waste-empty-state" role="status">
          <strong className="waste-empty-title">Cargando mermas...</strong>
          <p>Consultando los registros de este dispositivo.</p>
        </div>
      ) : wasteError ? (
        <div className="waste-empty-state" role="alert">
          <AlertTriangle size={24} className="waste-state-icon" aria-hidden="true" />
          <strong className="waste-empty-title">Historial no disponible</strong>
          <p>{wasteError}</p>
          <button type="button" className="waste-page-btn" onClick={onRetry}>Reintentar</button>
        </div>
      ) : logs.length === 0 ? (
        <div className="waste-empty-state">
          <CheckCircle size={28} className="waste-state-icon" aria-hidden="true" />
          <strong className="waste-empty-title">Sin mermas registradas</strong>
          <p>No se encontraron mermas en esta página del dispositivo.</p>
        </div>
      ) : (
        <div className="waste-list" aria-label="Registros de mermas">
          {logs.map((log) => (
            <details className="waste-row" key={log.id}>
              <summary className="waste-row-toggle">
                <span className="waste-row-content">
                  <strong className="waste-product-name">{log.productName || 'Producto eliminado'}</strong>
                  <span className="waste-row-secondary">
                    {log.quantity} {log.unit || 'u'} · {formatWasteDate(log.timestamp)}
                  </span>
                </span>
                <span className="waste-row-end">
                  <strong className="waste-loss-amount">{'-$' + Number(log.lossAmount || 0).toFixed(2)}</strong>
                  <ChevronDown size={17} className="waste-row-chevron" aria-hidden="true" />
                </span>
              </summary>
              <div className="waste-row-details">
                <div className="waste-row-facts">
                  <span>Motivo: <strong className={getReasonTone(log.reason)}>{log.reason || 'Sin motivo'}</strong></span>
                  {log.batchSku && <span>Lote: <strong>{log.batchSku}</strong></span>}
                  {log.costAtTime != null && (
                    <span>Costo unitario: <strong>{'$' + Number(log.costAtTime || 0).toFixed(2)}</strong></span>
                  )}
                  {log.notes && <span className="waste-row-notes">Observaciones: {log.notes}</span>}
                </div>
              </div>
            </details>
          ))}
        </div>
      )}

      <nav className="waste-pagination" aria-label="Navegación de mermas">
        <button type="button" className="waste-page-btn" onClick={onPrev}
          disabled={!pageReady || currentWastePageIndex === 0}>
          <ArrowLeft size={16} aria-hidden="true" />
          {isWasteLoading ? 'Cargando...' : 'Anterior'}
        </button>
        <span className="waste-page-info">Página {currentWastePageIndex + 1}</span>
        <button type="button" className="waste-page-btn" onClick={onNext}
          disabled={!pageReady || !hasMoreWaste}>
          {isWasteLoading ? 'Cargando...' : 'Siguiente'}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </nav>
    </section>
  );
}
