import { Activity, AlertTriangle } from 'lucide-react';

const DataPreviewBanner = ({ preview, isCalculating, isDataEmpty }) => {
  if (!preview) return null;

  if (isCalculating) {
    return <div className="data-preview loading">Recopilando datos...</div>;
  }

  return (
    <div className={`data-preview-banner ${isDataEmpty ? 'warning-empty' : ''}`}>
      <div className="preview-header">
        {isDataEmpty ? <AlertTriangle size={16} /> : <Activity size={16} />}
        <span>Datos a inyectar en la IA:</span>
      </div>
      <ul className="preview-metrics">
        {preview.map((metric, idx) => (
          <li key={idx}>
            <span className="metric-label">{metric.label}:</span>
            <span className="metric-value">{metric.value}</span>
          </li>
        ))}
      </ul>
      {isDataEmpty && (
        <p className="empty-warning-text">Faltan datos base en el sistema para realizar un análisis válido con este agente.</p>
      )}
    </div>
  );
};

export default DataPreviewBanner;