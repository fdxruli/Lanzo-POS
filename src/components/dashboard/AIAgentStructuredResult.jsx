import { useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Database,
  FileJson,
  FileText,
  HelpCircle,
  Lightbulb,
  ListChecks,
  ShieldCheck,
  Target
} from 'lucide-react';
import { parseMarkdownResponse } from '../../utils/aiPromptBuilder';
import {
  buildAIReportViewModel,
  buildTechnicalAIReport,
  downloadAIReport,
  EMPTY_COLLECTION_LABEL,
  NO_DATA_LABEL,
  serializeTechnicalAIReport
} from '../../utils/aiReportExport';
import {
  getActionTypeLabel,
  getPriorityLabel,
  getSeverityLabel,
  humanizeAIReportText,
  translateAIReportCode
} from '../../utils/aiReportLabels';
import './AIAgentStructuredResult.css';

const formatFallbackKey = (key = '') => translateAIReportCode(key, 'Dato');

const flattenReadableValue = (value, prefix = '') => {
  if (value === null || value === undefined || value === '') return [];

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = humanizeAIReportText(String(value)).replace(/\s+/g, ' ').trim();
    if (!text) return [];
    return [prefix ? `${prefix}: ${text}` : text];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      const itemPrefix = prefix ? `${prefix} ${index + 1}` : `Punto ${index + 1}`;
      return flattenReadableValue(item, itemPrefix);
    });
  }

  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nestedValue]) => {
      const nextPrefix = prefix ? `${prefix} / ${formatFallbackKey(key)}` : formatFallbackKey(key);
      return flattenReadableValue(nestedValue, nextPrefix);
    });
  }

  return [];
};

const stripCodeFence = (text = '') => String(text)
  .replace(/```(?:json|javascript|js)?/gi, '')
  .replace(/```/g, '')
  .trim();

const buildReadableFallbackLines = (rawResult) => {
  const rawText = stripCodeFence(rawResult)
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .trim();

  if (!rawText) return [];

  try {
    const parsed = JSON.parse(rawText);
    const flattened = flattenReadableValue(parsed);
    if (flattened.length > 0) return flattened;
  } catch {
    // Continue with a text cleanup fallback.
  }

  const looksJsonLike = /^[\s[{]/.test(rawText) || /"\w+"\s*:/.test(rawText);
  const cleaned = looksJsonLike
    ? rawText
      .replace(/[{}[\]]/g, '\n')
      .replace(/,\s*(?="?[A-Za-z0-9_ -]+"?\s*:)/g, '\n')
      .replace(/["']/g, '')
      .replace(/\s*:\s*/g, ': ')
      .replace(/\n{2,}/g, '\n')
    : rawText;

  const lines = cleaned
    .split(/\n+/)
    .map(line => humanizeAIReportText(line.replace(/^\s*[-*]\s*/, '').replace(/\s+/g, ' ').trim()))
    .filter(line => line && /[A-Za-z0-9]/.test(line))
    .filter(line => !/^(formatVersion|confidence)\s*:/i.test(line));

  if (lines.length > 0) return lines;
  return [rawText.replace(/\s+/g, ' ').trim()];
};

const MarkdownAnalysisResult = ({ result }) => {
  const sections = useMemo(() => parseMarkdownResponse(result), [result]);
  const readableLines = useMemo(() => buildReadableFallbackLines(result), [result]);

  if (sections.length === 0) {
    return (
      <div className="analysis-result readable-analysis">
        <div className="result-section">
          <h4 className="section-title">Analisis generado</h4>
          {readableLines.length > 1 ? (
            <ul className="section-items">
              {readableLines.map((line) => (
                <li key={`readable-line-${line}`}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="readable-analysis-text">{readableLines[0] || 'La IA genero una respuesta, pero no incluyo contenido legible.'}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-result">
      {sections.map((section, sectionIndex) => (
        <div key={`${section.title}-${sectionIndex}`} className="result-section">
          <h4 className="section-title">{humanizeAIReportText(section.title)}</h4>
          <ul className="section-items">
            {section.items.map((item, itemIndex) => (
              <li key={`${section.title}-${itemIndex}`}>{humanizeAIReportText(item)}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

const SeverityBadge = ({ severity = 'info' }) => (
  <span className={`structured-badge severity-${severity}`}>
    {getSeverityLabel(severity)}
  </span>
);

const PriorityBadge = ({ priority = 'medium' }) => (
  <span className={`priority-pill priority-${priority}`}>
    {getPriorityLabel(priority)}
  </span>
);

const FindingCard = ({ finding }) => (
  <article className={`structured-card finding-card severity-${finding.severity}`}>
    <div className="structured-card-header">
      <div className="structured-card-title">
        <Target size={18} />
        <h5>{finding.title}</h5>
      </div>
      <SeverityBadge severity={finding.severity} />
    </div>

    {finding.metric && <p className="structured-metric">{finding.metric}</p>}
    {finding.summary && <p className="structured-description">{finding.summary}</p>}

  </article>
);

const ActionCard = ({ action, onAction }) => {
  const hasRoute = Boolean(action.route);
  const buttonLabel = hasRoute
    ? 'Abrir guía y navegar'
    : action.type === 'draft'
      ? 'Abrir borrador guiado'
      : 'Abrir guía';

  return (
    <article className={`structured-card action-card priority-${action.priority}`}>
      <div className="structured-card-header">
        <div className="structured-card-title">
          <ListChecks size={18} />
          <h5>{action.label}</h5>
        </div>
        <PriorityBadge priority={action.priority} />
      </div>

      <div className="action-meta-row">
        <span>{action.actionTypeLabel || getActionTypeLabel(action.type)}</span>
        {action.routeLabel && !action.description?.includes(action.routeLabel) && <span className="action-route-label">{action.routeLabel}</span>}
        {action.confirmationRequired && (
          <span className="confirmation-pill">
            <ShieldCheck size={12} />
            requiere confirmar
          </span>
        )}
      </div>

      {action.description && <p className="structured-description">{action.description}</p>}
      {action.reason && <p className="structured-reason"><strong>Por qué:</strong> {action.reason}</p>}
      {action.expectedImpact && <p className="structured-reason"><strong>Impacto:</strong> {action.expectedImpact}</p>}

      <button className="structured-action-button" type="button" onClick={() => onAction(action)}>
        {buttonLabel}
        <ArrowRight size={14} />
      </button>
    </article>
  );
};

const OpportunityCard = ({ opportunity }) => (
  <article className="structured-card opportunity-card">
    <div className="structured-card-title">
      <Lightbulb size={18} />
      <h5>{opportunity.title}</h5>
    </div>
    {opportunity.description && <p className="structured-description">{opportunity.description}</p>}
    <div className="opportunity-meta">
      {opportunity.impact && <span>Impacto: {opportunity.impactLabel || getPriorityLabel(opportunity.impact)}</span>}
      {opportunity.effort && <span>Esfuerzo: {opportunity.effortLabel || getPriorityLabel(opportunity.effort)}</span>}
    </div>
    {opportunity.firstStep && <p className="structured-reason"><strong>Primer paso:</strong> {opportunity.firstStep}</p>}
  </article>
);

const StatusBadge = ({ status, statusLabel, severity }) => (
  <div className="report-badges" aria-label={`Estado: ${statusLabel}${severity ? `; severidad: ${getSeverityLabel(severity)}` : ''}`}>
    <span className={`report-status-badge status-${status}`}>{statusLabel}</span>
    {severity && <SeverityBadge severity={severity} />}
  </div>
);

const ReportHeader = ({ report, onDownload, downloadFeedback }) => (
  <section className="report-overview" aria-labelledby="ai-report-title">
    <div className="report-overview-copy">
      <span className="report-overview-kicker"><BrainCircuit size={16} />Reporte de análisis IA</span>
      <div className="report-title-row">
        <div>
          <h4 id="ai-report-title">{report.title}</h4>
          <p className="report-date">Generado: {report.date}</p>
        </div>
        <StatusBadge status={report.status} statusLabel={report.statusLabel} severity={report.severity} />
      </div>
    </div>
    <div className="report-download-area">
      <span className="report-download-label">Guardar una copia local</span>
      <div className="report-download-actions">
        <button type="button" className="report-download-button" onClick={() => onDownload('markdown')} aria-label="Descargar reporte en Markdown">
          <FileText size={16} />
          Descargar reporte
        </button>
        <button type="button" className="report-download-button secondary" onClick={() => onDownload('json')} aria-label="Descargar JSON técnico completo">
          <FileJson size={16} />
          Descargar JSON técnico
        </button>
      </div>
      {downloadFeedback && (
        <div className={`report-download-feedback ${downloadFeedback.kind}`} role={downloadFeedback.kind === 'error' ? 'alert' : 'status'}>
          {downloadFeedback.kind === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
          <span>{downloadFeedback.message}</span>
        </div>
      )}
    </div>
  </section>
);

const ReportStatusNotice = ({ report }) => {
  if (!['failed', 'incomplete', 'invalid'].includes(report.status)) return null;
  const message = report.status === 'failed'
    ? 'No se pudo completar la comunicación con el análisis. El intento se conservó localmente.'
    : report.coverageStatus === 'partial'
      ? 'Este análisis se realizó con una parte de los datos disponibles.'
      : 'Este resultado se conserva para consulta, pero no debe interpretarse como un análisis completo.';

  return (
    <section className={`report-status-notice status-${report.status}`} role="status">
      <strong>{report.statusLabel}</strong>
      <span>{message}</span>
    </section>
  );
};

const EmptySectionMessage = ({ children }) => (
  <div className="report-empty-message">
    <span>{children}</span>
  </div>
);

const MetricGroup = ({ title, group }) => {
  if (group.length === 0) return null;
  return (
    <div className="report-metric-group">
      <h5>{title}</h5>
      <div className="report-metric-grid">
        {group.map((metric, index) => (
          <article className="report-metric-card" key={`${metric.label}-${index}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>
    </div>
  );
};

const MetricCards = ({ metrics }) => {
  const localMetrics = metrics.filter(metric => metric.origin === 'local');
  const aiMetrics = metrics.filter(metric => metric.origin !== 'local');
  if (localMetrics.length === 0 && aiMetrics.length === 0) return null;

  return (
    <section className="structured-section report-metrics-section">
      <div className="report-section-heading">
        <div>
          <span className="report-section-kicker"><BarChart3 size={15} />Lectura rápida</span>
          <h4 className="section-title">Métricas importantes</h4>
        </div>
      </div>
      <MetricGroup title="Datos calculados localmente" group={localMetrics} />
      <MetricGroup title="Interpretación de IA" group={aiMetrics} />
    </section>
  );
};

const ListSection = ({ title, icon: Icon, items, present, emptyMessage }) => (
  <section className="structured-section report-list-section">
    <h4 className="section-title"><Icon size={17} />{title}</h4>
    {!items.length
      ? <EmptySectionMessage>{present ? emptyMessage : 'Esta sección no se incluyó en el análisis.'}</EmptySectionMessage>
      : <div className="structured-grid">{items.map((item, index) => <div key={`${title}-${item.id || item.label || index}`}>{item}</div>)}</div>}
  </section>
);

const CoveragePanel = ({ report }) => {
  const { coverage, coverageDetails } = report;
  const coverageClass = coverage.complete === true && coverage.omitted.found && Number(coverage.omitted.value) === 0 ? 'is-complete' : 'is-partial';
  const total = coverage.total?.found ? Number(coverage.total.value) : null;
  const included = coverage.included?.found ? Number(coverage.included.value) : null;
  const omitted = coverage.omitted?.found ? Number(coverage.omitted.value) : null;
  const localAvailable = Number.isFinite(omitted) ? omitted : Number.isFinite(total) && Number.isFinite(included) ? Math.max(0, total - included) : null;
  const hasPartialCounts = Number.isFinite(total) && Number.isFinite(included) && Number.isFinite(localAvailable) && localAvailable > 0;
  const hasOmittedData = Number.isFinite(omitted) && omitted > 0;
  const coveragePercentage = Number.isFinite(total) && total > 0 && Number.isFinite(included)
    ? Math.round((included / total) * 100)
    : null;
  return (
    <section className={`report-coverage-panel ${coverageClass}`}>
      <div className="report-panel-heading"><Database size={16} /><strong>Cobertura de datos</strong></div>
      <div className="report-coverage-score">
        <span><strong>Confianza del modelo:</strong> {report.confidence === null ? NO_DATA_LABEL : `${Math.round(report.confidence * 100)}%`}</span>
        <span><strong>Cobertura de datos:</strong> {coveragePercentage === null ? NO_DATA_LABEL : `${coveragePercentage}%`}</span>
      </div>
      {!coverage.present && <p>{NO_DATA_LABEL}</p>}
      {coverage.present && (
        <>
          {total === 0
            ? <p>{EMPTY_COLLECTION_LABEL}</p>
            : <p>{coverage.complete === true ? 'El conjunto de datos utilizado fue completo.' : coverage.complete === false ? 'El análisis utilizó una parte de los datos disponibles.' : NO_DATA_LABEL}</p>}
          {hasPartialCounts && (
            <div className="report-coverage-warning">
              <strong>Este análisis utiliza una muestra parcial de los datos.</strong>
              <span>{included} de {total} datos fueron enviados al análisis.</span>
              <span>{localAvailable} datos permanecen disponibles localmente.</span>
            </div>
          )}
          <div className="report-coverage-cards">
            {[
              ['Total', coverage.total],
              ['Incluidos', coverage.included],
              ['Omitidos', coverage.omitted]
            ].map(([label, field]) => <span className="report-coverage-card" key={label}><small>{label}</small><strong>{field?.found ? field.value : NO_DATA_LABEL}</strong></span>)}
          </div>
          {(hasOmittedData && coverage.omissionReason.found || coverage.order.found) && <div className="report-coverage-context">
            {hasOmittedData && coverage.omissionReason.found && <span><strong>Motivo:</strong> {coverage.omissionReason.value}</span>}
            {coverage.order.found && <span><strong>Priorización:</strong> {coverage.order.value}</span>}
          </div>}
          {coverage.notes.length > 0 && <ul className="report-panel-list">{coverage.notes.map((note, index) => <li key={`coverage-note-${index}`}>{note}</li>)}</ul>}
        </>
      )}
      {coverageDetails.length > 0 && (
        <details className="coverage-breakdown">
          <summary>Ver desglose de cobertura</summary>
          <div className="coverage-breakdown-list">
            {coverageDetails.map((detail, index) => (
              <div className="coverage-breakdown-row" key={`${detail.label}-${index}`}>
                <strong>{detail.label}</strong>
                {detail.empty
                  ? <span className="coverage-empty-label">{EMPTY_COLLECTION_LABEL}</span>
                  : <>
                    <span>Total {detail.total}</span>
                    <span>Incluidos {detail.included}</span>
                    <span>Omitidos {detail.omitted}</span>
                    {Number(detail.omitted) > 0 && detail.reason !== NO_DATA_LABEL && <span>Motivo: {detail.reason}</span>}
                    {detail.order !== NO_DATA_LABEL && <span>Priorización: {detail.order}</span>}
                  </>}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
};

const UsagePanel = ({ report }) => (
  <section className="report-usage-panel">
    <div className="report-panel-heading"><Activity size={16} /><strong>Uso del análisis</strong></div>
    {report.usage.entries.length === 0 ? <p>{NO_DATA_LABEL}</p> : (
      <div className="report-usage-values">
        {report.usage.entries.map(entry => <span key={`${entry.label}-${entry.value}`}><strong>{entry.label}:</strong> {entry.value}</span>)}
      </div>
    )}
  </section>
);

const ToolRunDetails = ({ agentToolRun }) => {
  const results = Array.isArray(agentToolRun?.results) ? agentToolRun.results : [];
  if (!agentToolRun) return null;
  return (
    <details>
      <summary>Ver ejecución completa de herramientas{results.length > 0 ? ` (${results.length})` : ''}</summary>
      <div className="tool-run-details">
        {agentToolRun.availableToolCount !== undefined && <p className="tool-run-meta">{agentToolRun.availableToolCount} herramientas disponibles</p>}
        {agentToolRun.executedAt && <p className="tool-run-meta">Ejecutadas: {agentToolRun.executedAt}</p>}
        {results.length === 0 && <EmptySectionMessage>No hay resultados de herramientas en este análisis.</EmptySectionMessage>}
        {results.map((tool, index) => (
          <article className="structured-card tool-run-result" key={`${tool.id || 'tool'}-${index}`}>
            <div className="structured-card-title"><Activity size={16} /><h5>{tool.title || tool.id || `Herramienta ${index + 1}`}</h5></div>
            {tool.summary && <p className="structured-description">{tool.summary}</p>}
            {Array.isArray(tool.actions) && tool.actions.length > 0 && <div className="tool-run-list"><strong>Acciones calculadas</strong><ul className="structured-evidence">{tool.actions.map((action, actionIndex) => <li key={`${tool.id || index}-action-${actionIndex}`}>{action}</li>)}</ul></div>}
            {Array.isArray(tool.evidence) && tool.evidence.length > 0 && <div className="tool-run-list"><strong>Evidencia completa</strong><ul className="structured-evidence">{tool.evidence.map((entry, evidenceIndex) => <li key={`${tool.id || index}-evidence-${evidenceIndex}`}>{entry}</li>)}</ul></div>}
          </article>
        ))}
      </div>
    </details>
  );
};

const TechnicalDetails = ({ report }) => {
  const technicalJson = useMemo(() => serializeTechnicalAIReport(report.result), [report.result]);
  const technicalRecord = useMemo(() => buildTechnicalAIReport(report.result), [report.result]);
  return (
    <section className="report-full-details">
      <details>
        <summary>Detalles técnicos</summary>
        <div className="technical-details-content">
          <p>La información técnica permanece disponible para depuración y soporte. No se abre automáticamente.</p>
          <details>
            <summary>Ver JSON completo</summary>
            <pre>{technicalJson}</pre>
          </details>
          <details>
            <summary>Ver respuesta cruda completa</summary>
            <pre>{technicalRecord.rawResultContent || NO_DATA_LABEL}</pre>
          </details>
          {technicalRecord.factSnapshot && <details><summary>Ver hechos completos</summary><pre>{JSON.stringify(technicalRecord.factSnapshot, null, 2)}</pre></details>}
          <ToolRunDetails agentToolRun={report.result?.agentToolRun} />
        </div>
      </details>
    </section>
  );
};

const EvidenceSection = ({ evidence }) => (
  <section className="structured-section report-evidence-section">
    <h4 className="section-title"><ShieldCheck size={17} />Evidencias</h4>
    {evidence.items.length > 0
      ? <ul className="section-items">{evidence.items.map((item, index) => <li key={`evidence-${index}`}>{item}</li>)}</ul>
      : <EmptySectionMessage>{evidence.present ? 'No hay evidencias registradas en este análisis.' : NO_DATA_LABEL}</EmptySectionMessage>}
  </section>
);

export default function StructuredAnalysisResult({ result, onAction }) {
  const [downloadFeedback, setDownloadFeedback] = useState(null);
  const report = useMemo(() => buildAIReportViewModel(result), [result]);

  const handleDownload = format => {
    try {
      const { filename } = downloadAIReport(result, format);
      setDownloadFeedback({ kind: 'success', message: `Descarga preparada: ${filename}` });
    } catch (error) {
      setDownloadFeedback({ kind: 'error', message: error?.message || 'No se pudo descargar el reporte. Intenta nuevamente.' });
    }
  };

  const renderStructuredContent = () => (
    <>
      <MetricCards metrics={report.metrics} />
      <CoveragePanel report={report} />
      <UsagePanel report={report} />
      <section className={`structured-summary severity-${report.severity || 'info'}`}>
        <div>
          <div className="structured-summary-heading"><BrainCircuit size={18} /><span>Resumen ejecutivo</span></div>
          <p>{report.summary}</p>
        </div>
        <div className="confidence-meter">
          <span>Confianza</span>
          <strong>{report.confidence === null ? NO_DATA_LABEL : `${Math.round(report.confidence * 100)}%`}</strong>
        </div>
      </section>
      <ListSection title="Hallazgos y advertencias" icon={Target} items={report.findings.items.map(finding => <FindingCard finding={finding} key={finding.id} />)} present={report.findings.present} emptyMessage="No hay hallazgos registrados en este análisis." />
      <EvidenceSection evidence={report.evidence} />
      <ListSection title="Acciones y recomendaciones" icon={ListChecks} items={report.actions.items.map(action => <ActionCard action={action} onAction={onAction} key={action.id} />)} present={report.actions.present} emptyMessage="No hay recomendaciones registradas en este análisis." />
      <ListSection title="Oportunidades" icon={Lightbulb} items={report.opportunities.items.map(opportunity => <OpportunityCard opportunity={opportunity} key={opportunity.id} />)} present={report.opportunities.present} emptyMessage="No hay oportunidades registradas en este análisis." />
      <ListSection title="Datos que mejorarían el análisis" icon={HelpCircle} items={report.questions.items.map((question, index) => <div className="structured-card" key={`question-${index}`}><p className="structured-description">{question}</p></div>)} present={report.questions.present} emptyMessage="No hay preguntas pendientes para este análisis." />
    </>
  );

  return (
    <div className="structured-analysis-result">
      <ReportHeader report={report} onDownload={handleDownload} downloadFeedback={downloadFeedback} />
      <ReportStatusNotice report={report} />
      {report.parsed.isStructured ? renderStructuredContent() : (
        <>
          <section className="structured-summary severity-info">
            <div>
              <div className="structured-summary-heading"><BrainCircuit size={18} /><span>Resumen del análisis</span></div>
              <p>{report.summary}</p>
            </div>
            <div className="confidence-meter"><span>Confianza</span><strong>{NO_DATA_LABEL}</strong></div>
          </section>
          <MarkdownAnalysisResult result={report.parsed.markdown || report.rawResultContent} />
          <CoveragePanel report={report} />
          <UsagePanel report={report} />
        </>
      )}
      <TechnicalDetails report={report} />
    </div>
  );
}
