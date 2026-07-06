import React from 'react';
import { Archive, Clock, Eye, History, Loader2, Sparkles } from 'lucide-react';
import './AIAgentHistoryPanel.css';

const formatToolSummary = (toolRunSummary = {}) => {
  const executed = Number(toolRunSummary.executedToolCount || 0);
  const available = Number(toolRunSummary.availableToolCount || 0);

  if (executed > 0 && available > 0) return `${executed}/${available} herramientas usadas`;
  if (available > 0) return `${available} herramientas disponibles`;
  return null;
};

export default function AIAgentHistoryPanel({
  analyses = [],
  isLoading = false,
  message = null,
  error = null,
  onOpen,
  onArchive,
  selectedAgent = null
}) {
  return (
    <section className="ai-analysis-history" aria-label="Historial local de análisis IA">
      <div className="ai-analysis-history-header">
        <div>
          <h3>
            <History size={18} />
            Análisis guardados en este dispositivo
          </h3>
          <p>
            Puedes consultar estos análisis sin consumir una nueva consulta IA. Se guardan solo en este dispositivo.
          </p>
        </div>
        {selectedAgent && (
          <span className="ai-analysis-history-filter">
            Filtrado por agente actual
          </span>
        )}
      </div>

      {message && (
        <div className="ai-analysis-history-alert success" role="status">
          <Sparkles size={16} />
          <span>{message}</span>
        </div>
      )}

      {error && (
        <div className="ai-analysis-history-alert error" role="alert">
          <Archive size={16} />
          <span>{error}</span>
        </div>
      )}

      {isLoading && (
        <div className="ai-analysis-history-loading">
          <Loader2 size={18} className="spin-icon" />
          <span>Cargando historial local...</span>
        </div>
      )}

      {!isLoading && analyses.length === 0 && (
        <div className="ai-analysis-history-empty">
          <History size={28} />
          <p>
            Aún no hay análisis guardados en este dispositivo. Cuando generes un análisis IA, se guardará aquí automáticamente.
          </p>
        </div>
      )}

      {!isLoading && analyses.length > 0 && (
        <div className="ai-analysis-history-grid">
          {analyses.map(analysis => {
            const toolSummary = formatToolSummary(analysis.toolRunSummary);

            return (
              <article key={analysis.id} className="ai-analysis-history-card">
                <div className="ai-analysis-history-card-header">
                  <div>
                    <h4 className="ai-analysis-history-agent">{analysis.agentName}</h4>
                    <p className="ai-analysis-history-range">{analysis.dateRangeLabel}</p>
                  </div>
                  <span className="ai-analysis-history-format">
                    {analysis.resultFormat === 'structured_json' ? 'Estructurado' : 'Texto'}
                  </span>
                </div>

                <p className="ai-analysis-history-date">
                  <Clock size={14} />
                  Generado: {analysis.generatedAtLabel}
                </p>

                <p className="ai-analysis-history-summary">
                  {analysis.resultSummary}
                </p>

                {toolSummary && (
                  <p className="ai-analysis-history-tools">
                    {toolSummary}
                  </p>
                )}

                <div className="ai-analysis-history-actions">
                  <button type="button" className="history-primary-action" onClick={() => onOpen?.(analysis.id)}>
                    <Eye size={16} />
                    Ver análisis
                  </button>
                  <button type="button" className="history-secondary-action" onClick={() => onArchive?.(analysis.id)}>
                    <Archive size={16} />
                    Archivar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
