import { CheckCircle, Clock, Eye, History, Loader2, Sparkles } from 'lucide-react';
import './AIAgentHistoryPanel.css';

const formatToolSummary = (toolRunSummary = {}) => {
  const executed = Number(toolRunSummary.executedToolCount || 0);
  const available = Number(toolRunSummary.availableToolCount || 0);

  if (executed > 0 && available > 0) return `${executed}/${available} herramientas`;
  if (available > 0) return `${available} herramientas`;
  return null;
};

const EMPTY_ANALYSES = [];

export default function AIAgentHistoryPanel({
  analyses = EMPTY_ANALYSES,
  isLoading = false,
  message = null,
  error = null,
  onOpen,
  selectedAgent = null
}) {
  return (
    <section className="ai-analysis-history" aria-label="Historial local de analisis IA">
      <div className="ai-analysis-history-header">
        <div>
          <span className="ai-analysis-history-kicker">
            <History size={14} />
            Historial
          </span>
          <h3>Analisis guardados</h3>
          <p>Consulta resultados anteriores sin generar una nueva solicitud.</p>
        </div>
        {selectedAgent && (
          <span className="ai-analysis-history-filter">
            Agente actual
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
          <History size={16} />
          <span>{error}</span>
        </div>
      )}

      {isLoading && (
        <div className="ai-analysis-history-loading">
          <Loader2 size={18} className="spin-icon" />
          <span>Cargando historial...</span>
        </div>
      )}

      {!isLoading && analyses.length === 0 && (
        <div className="ai-analysis-history-empty">
          <History size={22} />
          <p>Aun no hay analisis guardados para esta vista.</p>
        </div>
      )}

      {!isLoading && analyses.length > 0 && (
        <div className="ai-analysis-history-list">
          {analyses.map(analysis => {
            const toolSummary = formatToolSummary(analysis.toolRunSummary);

            return (
              <article key={analysis.id} className="ai-analysis-history-row">
                <div className="ai-analysis-history-main">
                  <div className="ai-analysis-history-title-row">
                    <h4 className="ai-analysis-history-agent">{analysis.agentName}</h4>
                    <span className="ai-analysis-history-format">
                      {analysis.resultFormat === 'structured_json' ? 'Estructurado' : 'Texto'}
                    </span>
                  </div>

                  <p className="ai-analysis-history-summary">
                    {analysis.resultSummary}
                  </p>

                  <div className="ai-analysis-history-meta">
                    <span>
                      <Clock size={13} />
                      {analysis.generatedAtLabel}
                    </span>
                    <span>{analysis.dateRangeLabel}</span>
                    {toolSummary && <span>{toolSummary}</span>}
                    <span className="ai-analysis-history-saved">
                      <CheckCircle size={13} />
                      Guardado
                    </span>
                  </div>
                </div>

                <button type="button" className="history-primary-action" onClick={() => onOpen?.(analysis.id)}>
                  <Eye size={16} />
                  Ver
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
