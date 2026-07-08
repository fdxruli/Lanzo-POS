import { Activity, AlertTriangle } from 'lucide-react';

const DataPreviewBanner = ({ preview, isCalculating, isDataEmpty }) => {
  if (!preview) return null;

  if (isCalculating) {
    return <div className="data-preview loading">Recopilando datos...</div>;
  }

  return (
    <div className={`data-preview-banner ${isDataEmpty ? 'warning-empty' : ''}`}>
      <div className="ai-agent-preview-header">
        {isDataEmpty ? <AlertTriangle size={16} /> : <Activity size={16} />}
        <span>Datos considerados</span>
      </div>
      <ul className="ai-agent-preview-metrics">
        {preview.map((metric) => (
          <li key={`${metric.label}-${metric.value}`}>
            <span className="ai-agent-preview-label">{metric.label}</span>
            <span className="ai-agent-preview-value">{metric.value}</span>
          </li>
        ))}
      </ul>
      {isDataEmpty && (
        <p className="ai-agent-empty-warning">Faltan datos base para generar un analisis valido con este agente.</p>
      )}
    </div>
  );
};

export default DataPreviewBanner;
