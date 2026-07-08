import { useMemo } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  HelpCircle,
  Lightbulb,
  ListChecks,
  ShieldCheck,
  Target
} from 'lucide-react';
import { parseMarkdownResponse } from '../../utils/aiPromptBuilder';
import { parseAgentResponse } from '../../utils/parseAgentResponse';
import './AIAgentStructuredResult.css';

const SEVERITY_LABELS = {
  success: 'Correcto',
  info: 'Info',
  warning: 'Alerta',
  danger: 'Crítico'
};

const PRIORITY_LABELS = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja'
};

const ACTION_TYPE_LABELS = {
  navigate: 'Navegar',
  review: 'Revisar',
  draft: 'Preparar',
  checklist: 'Checklist',
  manual: 'Manual'
};

const formatFallbackKey = (key = '') => String(key)
  .replace(/[_-]+/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^./, letter => letter.toUpperCase());

const flattenReadableValue = (value, prefix = '') => {
  if (value === null || value === undefined || value === '') return [];

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).replace(/\s+/g, ' ').trim();
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
    if (flattened.length > 0) return flattened.slice(0, 18);
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
    .map(line => line.replace(/^\s*[-*]\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(line => line && /[A-Za-z0-9]/.test(line))
    .filter(line => !/^(formatVersion|confidence)\s*:/i.test(line))
    .slice(0, 18);

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
          <h4 className="section-title">{section.title}</h4>
          <ul className="section-items">
            {section.items.map((item, itemIndex) => (
              <li key={`${section.title}-${itemIndex}`}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

const SeverityBadge = ({ severity = 'info' }) => (
  <span className={`structured-badge severity-${severity}`}>
    {SEVERITY_LABELS[severity] || SEVERITY_LABELS.info}
  </span>
);

const PriorityBadge = ({ priority = 'medium' }) => (
  <span className={`priority-pill priority-${priority}`}>
    {PRIORITY_LABELS[priority] || PRIORITY_LABELS.medium}
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

    {finding.evidence?.length > 0 && (
      <ul className="structured-evidence">
        {finding.evidence.map((entry) => (
          <li key={`${finding.id}-evidence-${entry}`}>{entry}</li>
        ))}
      </ul>
    )}

    {finding.toolId && <span className="tool-reference">tool: {finding.toolId}</span>}
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
        <span>{ACTION_TYPE_LABELS[action.type] || ACTION_TYPE_LABELS.manual}</span>
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
      {opportunity.impact && <span>Impacto: {opportunity.impact}</span>}
      {opportunity.effort && <span>Esfuerzo: {opportunity.effort}</span>}
    </div>
    {opportunity.firstStep && <p className="structured-reason"><strong>Primer paso:</strong> {opportunity.firstStep}</p>}
  </article>
);

export default function StructuredAnalysisResult({ result, onAction }) {
  const parsed = useMemo(() => parseAgentResponse(result), [result]);

  if (!parsed.isStructured) {
    return <MarkdownAnalysisResult result={parsed.markdown || result} />;
  }

  return (
    <div className="structured-analysis-result">
      <section className={`structured-summary severity-${parsed.severity}`}>
        <div>
          <div className="structured-summary-heading">
            <BrainCircuit size={18} />
            <span>Resumen ejecutivo</span>
          </div>
          <p>{parsed.executiveSummary}</p>
        </div>
        <div className="confidence-meter">
          <span>Confianza</span>
          <strong>{Math.round(parsed.confidence * 100)}%</strong>
        </div>
      </section>

      {parsed.findings.length > 0 && (
        <section className="structured-section">
          <h4 className="section-title">Hallazgos</h4>
          <div className="structured-grid">
            {parsed.findings.map(finding => <FindingCard key={finding.id} finding={finding} />)}
          </div>
        </section>
      )}

      {parsed.actions.length > 0 && (
        <section className="structured-section">
          <h4 className="section-title">Acciones recomendadas</h4>
          <div className="structured-grid">
            {parsed.actions.map(action => <ActionCard key={action.id} action={action} onAction={onAction} />)}
          </div>
        </section>
      )}

      {parsed.opportunities.length > 0 && (
        <section className="structured-section">
          <h4 className="section-title">Oportunidades</h4>
          <div className="structured-grid">
            {parsed.opportunities.map(opportunity => (
              <OpportunityCard key={opportunity.id} opportunity={opportunity} />
            ))}
          </div>
        </section>
      )}

      {parsed.questionsToAskUser.length > 0 && (
        <section className="structured-section questions-section">
          <h4 className="section-title">
            <HelpCircle size={18} />
            Datos que mejorarían el análisis
          </h4>
          <ul className="section-items">
            {parsed.questionsToAskUser.map((question) => (
              <li key={`question-${question}`}>{question}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
