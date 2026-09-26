import {
  AlertTriangle,
  BarChart3,
  Calculator,
  ChevronDown,
  Download,
  Globe2,
  History,
  Lightbulb,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadSalesProfitabilityProducts,
  resolveBusinessTimezone,
  runSalesProfitabilityAgent
} from '../../services/ai/salesProfitabilityAgentService';
import { downloadSalesProfitabilityReport } from '../../services/ai/salesProfitabilityDownloadReport';
import {
  buildPeriodRange,
  buildPreviousPeriod,
  formatAnalysisValue
} from '../../services/ai/salesProfitabilityAnalytics';
import {
  createOutOfScopeResponse,
  normalizeCommercialAINarrativeDiagnosticCode,
  normalizeScenarioForIntent,
  resolveCommercialIntent
} from '../../services/ai/commercialAgentContract';
import { getAIAgentUsageStatus } from '../../services/aiService';
import { getLicenseKeyFromDetails } from '../../services/sync/syncConstants';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import {
  buildSalesProfitabilityHistoryEntry,
  buildSalesProfitabilityHistoryScopeKey,
  clearSalesProfitabilityHistory,
  deleteSalesProfitabilityHistoryEntry,
  downloadSalesProfitabilityHistoryEntry,
  loadSalesProfitabilityHistory,
  saveSalesProfitabilityHistoryEntry,
  salesProfitabilityHistoryLabels
} from '../../services/ai/salesProfitabilityHistory';
import { useAppStore } from '../../store/useAppStore';
import './CommercialAIAgentsPage.css';

const SUGGESTED_QUESTIONS = [
  { label: '¿Mi negocio es rentable?', intent: 'profitability_summary' },
  { label: '¿Por qué cambió mi margen?', intent: 'explain_change' },
  { label: '¿Qué productos están afectando mi rentabilidad?', intent: 'product_risk' },
  { label: '¿Qué pasa si aumento el precio?', intent: 'price_simulation' },
  { label: '¿Qué combos puedo formar?', intent: 'combo_opportunity' },
  { label: '¿Qué promoción puedo simular?', intent: 'promotion_opportunity' }
];

const PERIOD_OPTIONS = [
  { value: 7, label: 'Últimos 7 días' },
  { value: 30, label: 'Últimos 30 días' },
  { value: 90, label: 'Últimos 90 días' },
  { value: 365, label: 'Últimos 12 meses' }
];

const EMPTY_ARRAY = Object.freeze([]);
const asArray = (value) => Array.isArray(value) ? value : EMPTY_ARRAY;
const confidenceLabel = (value) => ({ high: 'Alta', medium: 'Media', low: 'Baja' }[value] || 'Baja');
const priorityLabel = (value) => ({ high: 'Alta', medium: 'Media', low: 'Baja' }[value] || 'Media');
const NARRATIVE_DIAGNOSTIC_LABELS = Object.freeze({
  AI_NARRATIVE_EMPTY: 'El proveedor respondió sin contenido narrativo.',
  AI_NARRATIVE_INVALID_JSON: 'El proveedor devolvió un formato narrativo no válido.',
  AI_NARRATIVE_MISSING_CONTENT: 'La respuesta no incluyó contenido narrativo utilizable.',
  AI_NARRATIVE_UNSAFE_CONTENT: 'El contenido narrativo no superó la validación de seguridad.',
  AI_NARRATIVE_PARTIAL_CONTENT: 'Se omitieron partes de la narrativa que no superaron la validación.',
  AI_NARRATIVE_PROVIDER_ERROR: 'No se pudo confirmar una narrativa utilizable del proveedor.',
  AI_NARRATIVE_UNAVAILABLE: 'No se pudo confirmar una narrativa utilizable.'
});

const usagePeriodEndLabel = (usage = {}) => {
  const raw = usage?.period_end || usage?.periodEnd || usage?.periodEndAt;
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
};

function UsageStatusPanel({ usageStatus, isLoading, error, onRetry }) {
  const used = Number.isFinite(usageStatus?.used) ? usageStatus.used : null;
  const limit = Number.isFinite(usageStatus?.limit) ? usageStatus.limit : null;
  const remaining = Number.isFinite(usageStatus?.remaining) ? usageStatus.remaining : null;
  const periodEnd = usagePeriodEndLabel(usageStatus);

  let summary = 'Límite de IA no configurado';
  if (usageStatus?.isUnlimited) {
    summary = used === null ? 'Uso IA sin límite' : `Usados: ${used} · Disponibles: sin límite`;
  } else if (limit === 0) {
    summary = 'No hay análisis IA disponibles en este periodo';
  } else if (limit !== null) {
    summary = `Usados: ${used ?? '—'} · Límite: ${limit} · Disponibles: ${remaining ?? '—'}`;
  } else if (used !== null) {
    summary = `Usados: ${used} · Límite no configurado`;
  }

  return (
    <section className={`commercial-ai-usage ${usageStatus?.isLimitReached ? 'commercial-ai-usage--limit' : ''}`} aria-label="Uso de IA">
      <div>
        <span className="commercial-ai-usage__label">Uso de IA</span>
        <strong>{isLoading && !usageStatus ? 'Consultando uso de IA…' : summary}</strong>
        {periodEnd && <small>Periodo actual hasta {periodEnd}</small>}
        {usageStatus?.isLimitReached && <small>Límite alcanzado para el periodo actual.</small>}
        {isLoading && usageStatus && <small>Actualizando contador…</small>}
        {error && <small className="commercial-ai-usage__error">{error}</small>}
      </div>
      {error && <button className="commercial-ai-usage__retry" type="button" onClick={onRetry} disabled={isLoading}>Reintentar</button>}
    </section>
  );
}

function Metric({ label, value, note = null }) {
  return (
    <div className="commercial-ai-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function MetricGrid({ children }) {
  return <div className="commercial-ai-metrics">{children}</div>;
}

function CalculationList({ calculations }) {
  const safeCalculations = asArray(calculations);
  if (!safeCalculations.length) return <p className="commercial-ai-muted">No hay cálculos técnicos adicionales para esta consulta.</p>;
  return (
    <div className="commercial-ai-calculations">
      {safeCalculations.map((calculation) => (
        <div className="commercial-ai-calculation" key={`${calculation.label}-${calculation.formula}-${calculation.period?.from || 'period'}`}>
          <div><strong>{calculation.label}</strong><span>{calculation.formula}</span></div>
          <b>{calculation.formattedValue || formatAnalysisValue.formatMoney(calculation.value)}</b>
        </div>
      ))}
    </div>
  );
}

function ProfitabilityEvidence({ response }) {
  const data = response.profitability || {};
  const statusText = {
    profitable: 'Genera utilidad bruta',
    not_profitable: 'No genera utilidad bruta positiva',
    undetermined: 'No se puede confirmar todavía',
    insufficient_data: 'Datos insuficientes'
  }[data.status] || 'Sin clasificación';

  return (
    <>
      <p className="commercial-ai-evidence-lead">{statusText}</p>
      <MetricGrid>
        <Metric label="Ventas netas" value={formatAnalysisValue.formatMoney(data.netSales)} />
        <Metric label="Costo de venta" value={formatAnalysisValue.formatMoney(data.costOfSale)} />
        <Metric label="Utilidad bruta" value={formatAnalysisValue.formatMoney(data.profit)} />
        <Metric label="Margen bruto" value={formatAnalysisValue.formatPercent(data.margin)} />
        <Metric label="Cobertura de costos" value={formatAnalysisValue.formatPercent(data.costCoverage)} />
        <Metric label="Ventas válidas" value={formatAnalysisValue.formatNumber(data.validSales, 0)} />
      </MetricGrid>
    </>
  );
}

function MarginEvidence({ response }) {
  const comparison = response.comparison;
  if (!comparison) return <p className="commercial-ai-muted">No existe un periodo anterior comparable con evidencia suficiente.</p>;
  const contributors = asArray(response.contributors);
  return (
    <>
      <MetricGrid>
        <Metric label="Margen actual" value={formatAnalysisValue.formatPercent(response.current?.margin)} />
        <Metric label="Margen anterior" value={formatAnalysisValue.formatPercent(comparison.previousMargin)} />
        <Metric label="Variación absoluta" value={formatAnalysisValue.formatPercent(comparison.deltaMargin)} />
        <Metric label="Variación relativa" value={formatAnalysisValue.formatPercent(comparison.deltaMarginRelative)} />
      </MetricGrid>
      <div className="commercial-ai-contributors">
        {contributors.length ? contributors.map((item) => (
          <article key={item.key} className="commercial-ai-contributor">
            <strong>{item.title}</strong>
            <span>{item.explanation}</span>
          </article>
        )) : <p className="commercial-ai-muted">No hay evidencia suficiente para señalar un factor principal.</p>}
      </div>
    </>
  );
}

function ProductRiskEvidence({ response }) {
  const risks = asArray(response.productRisks);
  if (!risks.length) return <p className="commercial-ai-muted">No se detectaron productos con los criterios de riesgo disponibles para este periodo.</p>;
  return (
    <div className="commercial-ai-table-wrap">
      <table className="commercial-ai-table">
        <caption className="sr-only">Productos que conviene revisar</caption>
        <thead><tr><th>Producto</th><th>Riesgo</th><th>Unidades</th><th>Ventas</th><th>Costo</th><th>Utilidad</th><th>Margen</th></tr></thead>
        <tbody>{risks.map((risk) => (
          <tr key={`${risk.product}-${risk.riskType}`}>
            <th scope="row"><span>{risk.product}</span><small>{risk.reason}</small></th>
            <td>{risk.riskLabel}</td>
            <td>{formatAnalysisValue.formatNumber(risk.units, 0)}</td>
            <td>{formatAnalysisValue.formatMoney(risk.netSales)}</td>
            <td>{formatAnalysisValue.formatMoney(risk.cost)}</td>
            <td>{formatAnalysisValue.formatMoney(risk.profit)}</td>
            <td>{formatAnalysisValue.formatPercent(risk.margin)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function PriceEvidence({ response }) {
  const data = response.priceSimulation;
  if (!data) return <p className="commercial-ai-muted">Selecciona un producto y un precio nuevo con datos de costo disponibles.</p>;
  return (
    <>
      <p className="commercial-ai-evidence-lead">{data.product}</p>
      <MetricGrid>
        <Metric label="Precio actual" value={formatAnalysisValue.formatMoney(data.currentPrice)} />
        <Metric label="Precio nuevo" value={formatAnalysisValue.formatMoney(data.newPrice)} />
        <Metric label="Costo unitario" value={formatAnalysisValue.formatMoney(data.unitCost)} />
        <Metric label="Volumen histórico" value={formatAnalysisValue.formatNumber(data.historicalVolume, 0)} note="Supuesto del escenario" />
        <Metric label="Utilidad actual" value={formatAnalysisValue.formatMoney(data.currentProfit)} />
        <Metric label="Utilidad simulada" value={formatAnalysisValue.formatMoney(data.simulatedProfit)} />
        <Metric label="Diferencia de utilidad" value={formatAnalysisValue.formatMoney(data.profitDelta)} />
        <Metric label="Volumen mínimo" value={formatAnalysisValue.formatNumber(data.breakEvenVolume, 1)} note="Para conservar la utilidad actual" />
      </MetricGrid>
      <p className="commercial-ai-caution">Esta simulación mantiene el volumen histórico; no predice cómo reaccionará la demanda.</p>
    </>
  );
}

function PromotionEvidence({ response }) {
  const data = response.promotionSimulation;
  if (!data) return <p className="commercial-ai-muted">Selecciona un producto y define un descuento o precio promocional.</p>;
  return (
    <>
      <p className="commercial-ai-evidence-lead">{data.product}</p>
      <MetricGrid>
        <Metric label="Precio actual" value={formatAnalysisValue.formatMoney(data.currentPrice)} />
        <Metric label="Descuento" value={formatAnalysisValue.formatPercent(data.discount)} />
        <Metric label="Precio promocional" value={formatAnalysisValue.formatMoney(data.promotionalPrice)} />
        <Metric label="Costo unitario" value={formatAnalysisValue.formatMoney(data.unitCost)} />
        <Metric label="Margen actual" value={formatAnalysisValue.formatPercent(data.currentMargin)} />
        <Metric label="Margen promocional" value={formatAnalysisValue.formatPercent(data.promotionalMargin)} />
        <Metric label="Utilidad actual" value={formatAnalysisValue.formatMoney(data.currentProfit)} />
        <Metric label="Utilidad con promoción" value={formatAnalysisValue.formatMoney(data.promotionalProfit)} />
        <Metric label="Volumen mínimo" value={formatAnalysisValue.formatNumber(data.breakEvenVolume, 1)} note="Para conservar la utilidad actual" />
      </MetricGrid>
      <p className="commercial-ai-caution">El precio promocional es temporal en esta simulación; no se modifica el precio real ni se predice demanda.</p>
    </>
  );
}

function ComboEvidence({ response }) {
  const combos = asArray(response.comboOpportunities);
  if (!combos.length) return <p className="commercial-ai-muted">No hay suficientes tickets con productos compartidos para recomendar un combo confiable.</p>;
  return (
    <>
      <div className="commercial-ai-table-wrap">
        <table className="commercial-ai-table">
      <caption className="sr-only">Oportunidades de combos basadas en tickets compartidos</caption>
        <thead><tr><th>Productos</th><th>Tickets compartidos</th><th>% tickets válidos</th><th>Ticket promedio</th><th>Utilidad</th><th>Margen</th><th>Cobertura de costos</th><th>Confianza</th></tr></thead>
        <tbody>{combos.map((combo) => (
          <tr key={combo.products.join('|')}>
            <th scope="row"><span>{combo.products.join(' + ')}</span><small>{combo.opportunity}</small></th>
            <td>{formatAnalysisValue.formatNumber(combo.tickets, 0)}</td>
            <td>{formatAnalysisValue.formatPercent(combo.ticketPercentage ?? combo.frequency)}</td>
            <td>{formatAnalysisValue.formatMoney(combo.averageJointSale)}</td>
            <td>{formatAnalysisValue.formatMoney(combo.profit)}</td>
            <td>{formatAnalysisValue.formatPercent(combo.margin)}</td>
            <td>{combo.costStatus === 'complete' ? 'Completa' : 'Incompleta'} · {formatAnalysisValue.formatPercent(combo.costCoverage)}</td>
            <td>{confidenceLabel(combo.confidence || combo.evidenceLevel)}</td>
          </tr>
        ))}</tbody>
        </table>
      </div>
      <p className="commercial-ai-caution">Limitación: la oportunidad muestra correlación histórica de tickets; no garantiza demanda futura.</p>
    </>
  );
}

function IntentEvidence({ response }) {
  switch (response.intent) {
    case 'profitability_summary': return <ProfitabilityEvidence response={response} />;
    case 'explain_change': return <MarginEvidence response={response} />;
    case 'product_risk': return <ProductRiskEvidence response={response} />;
    case 'price_simulation': return <PriceEvidence response={response} />;
    case 'promotion_opportunity': return <PromotionEvidence response={response} />;
    case 'combo_opportunity': return <ComboEvidence response={response} />;
    default: return <ProfitabilityEvidence response={response} />;
  }
}

function Recommendations({ recommendations }) {
  const rows = asArray(recommendations);
  if (!rows.length) return <p className="commercial-ai-muted">No hay una acción sugerida con evidencia suficiente para esta consulta.</p>;
  return (
    <div className="commercial-ai-recommendations">
      {rows.slice(0, 3).map((recommendation) => (
        <article className="commercial-ai-recommendation" key={`${recommendation.title}-${recommendation.priority || 'medium'}`}>
          <div><strong>{recommendation.title}</strong><span>Prioridad {priorityLabel(recommendation.priority)}</span></div>
          <p>{recommendation.explanation}</p>
          <small>Impacto esperado: {recommendation.expectedImpact} · Requiere confirmación manual</small>
        </article>
      ))}
    </div>
  );
}

const technicalUsageLabel = (usageStatus) => {
  if (!usageStatus) return null;
  if (usageStatus.isUnlimited) return `Uso IA: ${usageStatus.used ?? '—'} · sin límite`;
  if (Number.isFinite(usageStatus.limit)) return `Uso IA: ${usageStatus.used ?? '—'} / ${usageStatus.limit}`;
  return `Uso IA: ${usageStatus.used ?? '—'} · límite no configurado`;
};

function TechnicalDetails({ response, usageStatus }) {
  const assumptions = asArray(response.assumptions);
  const limitations = asArray(response.limitations);
  const usageLabel = technicalUsageLabel(usageStatus);
  return (
    <details className="commercial-ai-technical">
      <summary><Calculator size={16} aria-hidden="true" /> Ver cálculos y evidencia técnica</summary>
      <div className="commercial-ai-technical__body">
        <div className="commercial-ai-result__meta">
          <span>Fuente: {response.source || 'mixed'}</span>
          <span>Ventas válidas: {response.coverage?.validSales ?? '—'}</span>
          <span>Cobertura de costos: {formatAnalysisValue.formatPercent(response.coverage?.costCoverage)}</span>
          {usageLabel && <span>{usageLabel}</span>}
        </div>
        {(assumptions.length > 0 || limitations.length > 0) && (
          <div className="commercial-ai-technical__notes">
            {assumptions.length > 0 && <div><strong>Supuestos</strong><ul>{assumptions.map((item) => <li key={`a-${item}`}>{item}</li>)}</ul></div>}
            {limitations.length > 0 && <div><strong>Limitaciones</strong><ul>{limitations.map((item) => <li key={`l-${item}`}>{item}</li>)}</ul></div>}
          </div>
        )}
      </div>
    </details>
  );
}

function CoverageEvidence({ response }) {
  const coverage = response.coverage || {};
  const sourceLabel = ({ cloud: 'Nube', local: 'Local', mixed: 'Mixta' }[response.source] || 'Mixta');
  return (
    <MetricGrid>
      <Metric label="Ventas válidas" value={formatAnalysisValue.formatNumber(coverage.validSales, 0)} />
      <Metric label="Productos incluidos" value={formatAnalysisValue.formatNumber(coverage.productsIncluded, 0)} />
      <Metric label="Cobertura de costos" value={formatAnalysisValue.formatPercent(coverage.costCoverage)} />
      <Metric label="Detalle de artículos" value={coverage.itemsComplete === true ? 'Completo' : 'Incompleto'} />
      <Metric label="Paginación" value={coverage.paginationComplete === true ? 'Completa' : 'Incompleta'} />
      <Metric label="Fuente de datos" value={coverage.sourceComplete === true ? sourceLabel : `${sourceLabel} · revisar`} />
    </MetricGrid>
  );
}

function NarrativeEvidence({ response }) {
  const narrative = response.aiNarrative;
  if (narrative?.status === 'unavailable') {
    const diagnosticCode = normalizeCommercialAINarrativeDiagnosticCode(narrative.diagnosticCode);
    return (
      <div>
        <p className="commercial-ai-muted">La narrativa opcional de IA no está disponible; el reporte determinístico se conserva completo.</p>
        {diagnosticCode && (
          <p className="commercial-ai-muted" role="status">
            Diagnóstico: {NARRATIVE_DIAGNOSTIC_LABELS[diagnosticCode]} <code>{diagnosticCode}</code>
          </p>
        )}
      </div>
    );
  }
  if (!narrative?.executiveSummary && !narrative?.explanation && !asArray(narrative?.recommendations).length) {
    return <p className="commercial-ai-muted">No se generó una narrativa IA para esta consulta. Los datos visibles son determinísticos.</p>;
  }
  return (
    <>
      {narrative.status === 'available' && (
        <p className="commercial-ai-muted">Narrativa generada por IA.</p>
      )}
      <div className="commercial-ai-narrative">
        {narrative.executiveSummary && <p><strong>{narrative.executiveSummary}</strong></p>}
        {narrative.explanation && <p>{narrative.explanation}</p>}
        {asArray(narrative.recommendations).length > 0 && (
          <div className="commercial-ai-narrative__recommendations">
            <strong>Observaciones narrativas</strong>
            <ul>{asArray(narrative.recommendations).map((item) => <li key={`${item.title}-${item.priority || 'medium'}`}>{item.title}: {item.explanation}</li>)}</ul>
          </div>
        )}
      </div>
      {narrative.status === 'available' && narrative.diagnosticCode === 'AI_NARRATIVE_PARTIAL_CONTENT' && (
        <p className="commercial-ai-muted" role="status">
          {NARRATIVE_DIAGNOSTIC_LABELS.AI_NARRATIVE_PARTIAL_CONTENT} <code>AI_NARRATIVE_PARTIAL_CONTENT</code>
        </p>
      )}
    </>
  );
}

function AnalysisResult({ result, onDownload, isDownloading }) {
  const response = result?.response || null;
  if (!response) {
    return (
      <div className="commercial-ai-result commercial-ai-result--empty" aria-live="polite">
        <div className="commercial-ai-result__header">
          <div><p className="commercial-ai-eyebrow">Resultado</p><h2>Tu conclusión aparecerá aquí después del análisis.</h2></div>
          <button type="button" className="commercial-ai-download" onClick={onDownload} disabled aria-label="Descargar reporte completo" title="Ejecuta un análisis para habilitar la descarga.">
            <Download size={16} aria-hidden="true" /> Descargar reporte completo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="commercial-ai-result" aria-live="polite">
      <div className="commercial-ai-result__header">
        <div><p className="commercial-ai-eyebrow">Conclusión</p><h2>{response.executiveSummary || response.answer}</h2></div>
        {response.status !== 'out_of_scope' && (
          <button type="button" className="commercial-ai-download" onClick={onDownload} disabled={isDownloading} aria-label="Descargar reporte completo">
            <Download size={16} aria-hidden="true" /> {isDownloading ? 'Preparando descarga…' : 'Descargar reporte completo'}
          </button>
        )}
      </div>

      {response.status !== 'out_of_scope' && (
        <>
          <section className="commercial-ai-executive-block">
            <h3>Hechos determinísticos</h3>
            <p>{response.explanation || 'No hay explicación adicional disponible.'}</p>
          </section>

          <section className="commercial-ai-executive-block">
            <h3>Hechos y resultados por intención</h3>
            <IntentEvidence response={response} />
          </section>

          <section className="commercial-ai-executive-block">
            <h3>Cálculos</h3>
            <CalculationList calculations={response.calculations} />
          </section>

          <section className="commercial-ai-executive-block">
            <h3>Cobertura y calidad de datos</h3>
            <CoverageEvidence response={response} />
          </section>

          <section className="commercial-ai-executive-block">
            <h3>Narrativa opcional de IA</h3>
            <NarrativeEvidence response={response} />
          </section>

          <section className="commercial-ai-executive-block commercial-ai-executive-block--recommendation">
            <div className="commercial-ai-section__heading"><Lightbulb size={17} aria-hidden="true" /><h3>Recomendaciones derivadas</h3></div>
            <Recommendations recommendations={response.recommendations} />
          </section>
        </>
      )}

      {response.status !== 'out_of_scope' && (
        <>
          <div className="commercial-ai-confidence-row">
            <span>Nivel de confianza</span>
            <b className={`commercial-ai-confidence commercial-ai-confidence--${response.confidence || 'low'}`}>{confidenceLabel(response.confidence)}</b>
          </div>

          <TechnicalDetails response={response} usageStatus={result.usageStatus} />
        </>
      )}
    </div>
  );
}

const INTENT_LABELS = Object.freeze({
  profitability_summary: 'Rentabilidad general',
  explain_change: 'Cambio de margen',
  product_risk: 'Riesgo de productos',
  price_simulation: 'Simulación de precio',
  promotion_opportunity: 'Simulación de promoción',
  combo_opportunity: 'Oportunidad de combos',
  out_of_scope: 'Fuera del alcance'
});

const HISTORY_ISSUE_MESSAGES = Object.freeze({
  context_unavailable: 'No se pudo confirmar un contexto seguro para guardar este historial. El resultado seguirá visible mientras esta pantalla permanezca abierta.',
  history_recovered: 'No se pudo leer el historial anterior. Se inició uno vacío y puedes seguir usando el agente.',
  storage_unavailable: 'El almacenamiento local no pudo guardar el historial. El resultado actual sigue disponible en pantalla.',
  entry_too_large: 'El reporte supera el límite local del historial y no se guardó.',
  invalid_entry: 'La respuesta no tenía un formato válido para guardarse en el historial.',
  download_error: 'No se pudo descargar esta consulta. El resultado original sigue disponible en el historial.'
});

const formatHistoryDateOnly = (value) => {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
};

const formatHistoryTimestamp = (entry) => {
  const date = new Date(entry?.queriedAt);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  try {
    return new Intl.DateTimeFormat('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: entry.timezone || undefined,
      timeZoneName: 'short'
    }).format(date);
  } catch {
    return date.toLocaleString('es-MX');
  }
};

const historyFilterDetails = (entry) => {
  const request = entry?.report?.request || {};
  const period = request.period || {};
  const scenario = request.scenario || {};
  const details = [];
  const from = formatHistoryDateOnly(period.from);
  const to = formatHistoryDateOnly(period.to);
  if (from || to) details.push(`Periodo: ${from || '—'} a ${to || '—'}`);

  const intent = request.resolvedIntent;
  if (intent) details.push(`Intención: ${INTENT_LABELS[intent] || intent}`);

  const previousFrom = formatHistoryDateOnly(period.previousFrom);
  const previousTo = formatHistoryDateOnly(period.previousTo);
  if (previousFrom || previousTo) details.push(`Comparación: ${previousFrom || '—'} a ${previousTo || '—'}`);
  else if (request.compare === true) details.push('Comparación: activada');

  if (scenario.productName) details.push(`Producto: ${scenario.productName}`);
  if (Number.isFinite(scenario.newPrice)) details.push(`Precio nuevo: ${formatAnalysisValue.formatMoney(scenario.newPrice)}`);
  if (Number.isFinite(scenario.promotionalPrice)) details.push(`Precio promocional: ${formatAnalysisValue.formatMoney(scenario.promotionalPrice)}`);
  if (Number.isFinite(scenario.discountPercent)) details.push(`Descuento: ${formatAnalysisValue.formatPercent(scenario.discountPercent / 100)}`);
  if (Number.isFinite(scenario.historicalVolume)) details.push(`Volumen histórico: ${formatAnalysisValue.formatNumber(scenario.historicalVolume, 0)}`);
  if (Number.isFinite(scenario.expectedVolume)) details.push(`Volumen esperado: ${formatAnalysisValue.formatNumber(scenario.expectedVolume, 0)}`);
  return details;
};

const historyEntryToAnalysisResult = (entry) => {
  const report = entry?.report;
  const deterministic = report?.deterministic || {};
  const ai = report?.ai || {};
  if (!report?.result) return null;
  return {
    response: {
      status: report.result.status,
      executiveSummary: report.result.executiveSummary,
      answer: report.result.answer,
      explanation: report.result.explanation,
      confidence: report.result.confidence,
      source: report.result.source,
      coverage: report.result.coverage,
      intent: report.request?.resolvedIntent,
      profitability: deterministic.profitability,
      current: deterministic.current,
      previous: deterministic.previous,
      comparison: deterministic.comparison,
      contributors: deterministic.contributors,
      productRisks: deterministic.productRisks,
      priceSimulation: deterministic.priceSimulation,
      promotionSimulation: deterministic.promotionSimulation,
      comboOpportunities: deterministic.comboOpportunities,
      calculations: deterministic.calculations,
      scenarios: deterministic.scenarios,
      recommendations: deterministic.recommendations,
      assumptions: deterministic.assumptions,
      limitations: deterministic.limitations,
      queryRange: deterministic.queryRange,
      aiNarrative: {
        status: ai.status,
        diagnosticCode: ai.diagnosticCode,
        executiveSummary: ai.executiveSummary,
        explanation: ai.explanation,
        recommendations: ai.recommendations
      }
    },
    usageStatus: report.usage?.available === true ? report.usage : null,
    providerCalled: report.result.providerCalled === true
  };
};

function HistoryPanel({
  entries,
  isLoading,
  issue,
  selectedEntryId,
  onSelect,
  onDelete,
  onClear,
  onDownload,
  isDownloading
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) || null;

  return (
    <section className="commercial-ai-history" aria-labelledby="commercial-ai-history-title">
      <div className="commercial-ai-history__header">
        <div>
          <p className="commercial-ai-eyebrow"><History size={15} aria-hidden="true" /> Consultas guardadas</p>
          <h2 id="commercial-ai-history-title">Historial de consultas</h2>
        </div>
        <button
          type="button"
          className="commercial-ai-history__clear"
          onClick={() => setConfirmClear(true)}
          disabled={isLoading || entries.length === 0}
        >
          <Trash2 size={16} aria-hidden="true" /> Limpiar historial
        </button>
      </div>
      <p className="commercial-ai-history__privacy">Se conserva sólo en este dispositivo y navegador. Al cambiar de negocio, licencia o sesión se separa del historial anterior.</p>
      {issue && <p className="commercial-ai-history__notice" role="status">{HISTORY_ISSUE_MESSAGES[issue] || HISTORY_ISSUE_MESSAGES.storage_unavailable}</p>}

      {confirmClear && entries.length > 0 && (
        <div className="commercial-ai-history__confirm" role="group" aria-label="Confirmar limpieza del historial">
          <p>¿Eliminar todas las consultas guardadas en este contexto?</p>
          <button type="button" onClick={() => setConfirmClear(false)}>Conservar historial</button>
          <button type="button" onClick={() => { onClear(); setConfirmClear(false); }}>Sí, limpiar historial</button>
        </div>
      )}

      {isLoading ? (
        <p className="commercial-ai-history__empty" role="status">Cargando historial local…</p>
      ) : entries.length === 0 ? (
        <p className="commercial-ai-history__empty">Todavía no hay consultas completadas en este contexto.</p>
      ) : (
        <ul className="commercial-ai-history__list">
          {entries.map((entry) => {
            const filters = historyFilterDetails(entry);
            const mode = salesProfitabilityHistoryLabels.executionMode[entry.execution.mode];
            const usage = salesProfitabilityHistoryLabels.usageStatus[entry.quota.status];
            const snapshot = entry.report?.usage;
            const snapshotLabel = snapshot?.available === true
              ? (snapshot.isUnlimited
                ? `Snapshot del contador: ${snapshot.used ?? '—'} usados · sin límite`
                : `Snapshot del contador: ${snapshot.used ?? '—'} usados · límite ${snapshot.limit ?? '—'} · disponibles ${snapshot.remaining ?? '—'}`)
              : 'Snapshot del contador: no disponible';
            const detailId = `commercial-ai-history-detail-${entry.id}`;

            return (
              <li key={entry.id}>
                <article className="commercial-ai-history__item">
                  <div className="commercial-ai-history__item-main">
                    <p className="commercial-ai-history__date">{formatHistoryTimestamp(entry)}</p>
                    <h3>{entry.report?.request?.question || 'Pregunta no disponible'}</h3>
                    <p className="commercial-ai-history__filters">{filters.length ? filters.join(' · ') : 'Filtros no disponibles'}</p>
                    <div className="commercial-ai-history__labels">
                      <span>Modo: <strong>{mode}</strong></span>
                      <span>Usó cuota: <strong>{usage}</strong></span>
                    </div>
                    <small>{salesProfitabilityHistoryLabels.usageExplanation[entry.quota.reason]}</small>
                    <small>{snapshotLabel}</small>
                  </div>
                  <div className="commercial-ai-history__actions">
                    <button
                      type="button"
                      aria-expanded={selectedEntryId === entry.id}
                      aria-controls={detailId}
                      onClick={() => onSelect(selectedEntryId === entry.id ? null : entry.id)}
                    >
                      {selectedEntryId === entry.id ? 'Cerrar respuesta' : 'Ver respuesta'}
                    </button>
                    <button
                      type="button"
                      className="commercial-ai-history__delete"
                      aria-label="Eliminar consulta del historial"
                      onClick={() => onDelete(entry.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" /> Eliminar
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {selectedEntry && (
        <section
          className="commercial-ai-history__detail"
          id={`commercial-ai-history-detail-${selectedEntry.id}`}
          aria-labelledby="commercial-ai-history-answer-title"
        >
          <div className="commercial-ai-history__detail-header">
            <div>
              <p className="commercial-ai-eyebrow">Respuesta guardada · {formatHistoryTimestamp(selectedEntry)}</p>
              <h3 id="commercial-ai-history-answer-title">{selectedEntry.report?.request?.question || 'Pregunta no disponible'}</h3>
            </div>
            <button type="button" onClick={() => onSelect(null)}>Cerrar</button>
          </div>
          <AnalysisResult
            result={historyEntryToAnalysisResult(selectedEntry)}
            onDownload={() => onDownload(selectedEntry)}
            isDownloading={isDownloading}
          />
        </section>
      )}
    </section>
  );
}

export default function CommercialAIAgentsPage() {
  const companyProfile = useAppStore((state) => state.companyProfile);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const actorSnapshot = useActorRuntimeSnapshot();
  const businessTimezone = resolveBusinessTimezone(companyProfile);
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const tenantOpaqueId = actorSnapshot?.tenant?.opaqueId || '';
  const actorKey = actorSnapshot?.actorKey || '';
  const sessionId = actorSnapshot?.sessionId || '';
  const historyContext = useMemo(() => ({
    tenantOpaqueId,
    actorKey,
    sessionId,
    licenseKey: licenseKey || ''
  }), [tenantOpaqueId, actorKey, sessionId, licenseKey]);
  const historyContextToken = useMemo(() => {
    if (!tenantOpaqueId || !actorKey || !sessionId || !licenseKey) return null;
    return JSON.stringify([tenantOpaqueId, actorKey, sessionId, licenseKey]);
  }, [tenantOpaqueId, actorKey, sessionId, licenseKey]);
  const [question, setQuestion] = useState('');
  const [periodDays, setPeriodDays] = useState(30);
  const [compare, setCompare] = useState(false);
  const [scenario, setScenario] = useState({});
  const [promotionMode, setPromotionMode] = useState('discountPercent');
  const [productOptions, setProductOptions] = useState([]);
  const [excludedProducts, setExcludedProducts] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productLoadError, setProductLoadError] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [result, setResult] = useState(null);
  const [downloadContext, setDownloadContext] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [usageStatus, setUsageStatus] = useState(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);
  const [usageError, setUsageError] = useState(null);
  const [historyState, setHistoryState] = useState({
    contextToken: null,
    entries: [],
    isLoading: true,
    issue: null
  });
  const [selectedHistoryEntryId, setSelectedHistoryEntryId] = useState(null);
  const [isDownloadingHistory, setIsDownloadingHistory] = useState(false);
  const analysisInFlightRef = useRef(false);
  const historyContextTokenRef = useRef(historyContextToken);
  const historyScopeRef = useRef({ contextToken: null, scopeKey: null });
  historyContextTokenRef.current = historyContextToken;

  const refreshUsage = useCallback(async () => {
    setIsLoadingUsage(true);
    setUsageError(null);
    try {
      const nextUsage = await getAIAgentUsageStatus();
      setUsageStatus(nextUsage);
      return nextUsage;
    } catch {
      setUsageError('No se pudo consultar el uso de IA. El último dato disponible se conserva.');
      return null;
    } finally {
      setIsLoadingUsage(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setIsLoadingUsage(true);
    setUsageStatus(null);
    setUsageError(null);
    getAIAgentUsageStatus()
      .then((nextUsage) => {
        if (active) setUsageStatus(nextUsage);
      })
      .catch(() => {
        if (active) setUsageError('No se pudo consultar el uso de IA. Puedes reintentar.');
      })
      .finally(() => {
        if (active) setIsLoadingUsage(false);
      });
    return () => { active = false; };
  }, [historyContextToken]);

  useEffect(() => {
    let active = true;
    historyScopeRef.current = { contextToken: null, scopeKey: null };
    setHistoryState({
      contextToken: historyContextToken,
      entries: [],
      isLoading: true,
      issue: null
    });
    setSelectedHistoryEntryId(null);
    setResult(null);
    setDownloadContext(null);
    setDownloadError(null);
    setQuestion('');
    setScenario({});
    setUsageStatus(null);
    setUsageError(null);
    setIsLoadingUsage(true);

    if (!historyContextToken) {
      setHistoryState({
        contextToken: null,
        entries: [],
        isLoading: false,
        issue: 'context_unavailable'
      });
      return () => { active = false; };
    }

    const loadHistory = async () => {
      const scopeKey = await buildSalesProfitabilityHistoryScopeKey(historyContext);
      if (!active || historyContextTokenRef.current !== historyContextToken) return;
      if (!scopeKey) {
        setHistoryState({
          contextToken: historyContextToken,
          entries: [],
          isLoading: false,
          issue: 'context_unavailable'
        });
        return;
      }

      historyScopeRef.current = { contextToken: historyContextToken, scopeKey };
      const loaded = loadSalesProfitabilityHistory({ scopeKey });
      setHistoryState({
        contextToken: historyContextToken,
        entries: loaded.entries,
        isLoading: false,
        issue: loaded.issue
      });
    };

    void loadHistory();
    return () => { active = false; };
  }, [historyContext, historyContextToken]);

  const period = useMemo(
    () => buildPeriodRange({ days: periodDays, timezone: businessTimezone }),
    [periodDays, businessTimezone]
  );
  const questionResolution = useMemo(() => resolveCommercialIntent(question), [question]);
  const intent = questionResolution.kind === 'supported'
    ? questionResolution.intent
    : (!question.trim() ? 'profitability_summary' : null);
  const filteredProductOptions = useMemo(() => {
    const search = productSearch.trim().toLocaleLowerCase('es-MX');
    if (!search) return productOptions;
    return productOptions.filter((product) => product.name.toLocaleLowerCase('es-MX').includes(search));
  }, [productOptions, productSearch]);
  const excludedProductSummary = useMemo(() => {
    const counts = new Map();
    excludedProducts.forEach(({ reason }) => {
      if (!reason) return;
      counts.set(reason, (counts.get(reason) || 0) + 1);
    });
    return Array.from(counts, ([reason, count]) => ({ reason, count }));
  }, [excludedProducts]);

  useEffect(() => {
    setScenario({});
    setProductSearch('');
    setPromotionMode('discountPercent');
    setCompare(intent === 'explain_change');
  }, [intent]);

  useEffect(() => {
    const loadsProducts = intent === 'price_simulation' || intent === 'promotion_opportunity';
    if (!loadsProducts) {
      setProductOptions([]);
      setExcludedProducts([]);
      setProductLoadError(null);
      setIsLoadingProducts(false);
      return undefined;
    }

    let active = true;
    setIsLoadingProducts(true);
    setProductLoadError(null);
    loadSalesProfitabilityProducts({ period })
      .then((prepared) => {
        if (!active) return;
        setProductOptions(Array.isArray(prepared?.products) ? prepared.products : []);
        setExcludedProducts(Array.isArray(prepared?.excludedProducts) ? prepared.excludedProducts : []);
      })
      .catch(() => {
        if (!active) return;
        setProductOptions([]);
        setExcludedProducts([]);
        setProductLoadError('No se pudieron preparar los productos de este periodo.');
      })
      .finally(() => {
        if (active) setIsLoadingProducts(false);
      });
    return () => { active = false; };
  }, [period, intent]);

  const selectIntent = (text) => {
    setScenario({});
    setProductSearch('');
    setPromotionMode('discountPercent');
    setResult(null);
    setDownloadContext(null);
    setDownloadError(null);
    setQuestion(text);
    setAnalysisError(null);
  };

  const handleQuestionChange = (event) => {
    const nextQuestion = event.target.value;
    setScenario({});
    setProductSearch('');
    setPromotionMode('discountPercent');
    setResult(null);
    setDownloadContext(null);
    setDownloadError(null);
    setAnalysisError(null);
    setQuestion(nextQuestion);
  };

  const handleScenarioChange = (event) => {
    const { name, value } = event.target;
    setScenario((current) => ({ ...current, [name]: value === '' ? undefined : value }));
  };

  const persistHistoryEntry = useCallback(async ({ completedResult, requestContext, queriedAt, contextToken }) => {
    if (!contextToken || historyContextTokenRef.current !== contextToken) return;
    const entry = buildSalesProfitabilityHistoryEntry({
      result: completedResult,
      requestContext,
      queriedAt
    });
    if (!entry) {
      setHistoryState((current) => current.contextToken === contextToken
        ? { ...current, issue: 'invalid_entry' }
        : current);
      return;
    }

    let scopeKey = historyScopeRef.current.contextToken === contextToken
      ? historyScopeRef.current.scopeKey
      : null;
    if (!scopeKey) scopeKey = await buildSalesProfitabilityHistoryScopeKey(historyContext);
    if (historyContextTokenRef.current !== contextToken) return;
    if (!scopeKey) {
      setHistoryState((current) => current.contextToken === contextToken
        ? { ...current, entries: [entry, ...current.entries], isLoading: false, issue: 'context_unavailable' }
        : current);
      return;
    }

    historyScopeRef.current = { contextToken, scopeKey };
    const saved = saveSalesProfitabilityHistoryEntry({ scopeKey, entry });
    if (historyContextTokenRef.current !== contextToken) return;
    setHistoryState((current) => current.contextToken === contextToken
      ? {
        ...current,
        entries: saved.entries,
        isLoading: false,
        issue: saved.issue
      }
      : current);
  }, [historyContext]);

  const handleAnalyze = async (event) => {
    event.preventDefault();
    if (!question.trim() || isAnalyzing || analysisInFlightRef.current) return;
    analysisInFlightRef.current = true;
    const queriedAt = new Date().toISOString();
    const requestContextToken = historyContextToken;
    setIsAnalyzing(true);
    setAnalysisError(null);
    setDownloadError(null);
    setResult(null);
    setDownloadContext(null);
    try {
      const resolution = resolveCommercialIntent(question);
      const resolvedIntent = resolution.kind === 'supported' ? resolution.intent : 'out_of_scope';
      const normalizedScenario = resolution.kind === 'supported'
        ? normalizeScenarioForIntent(resolvedIntent, scenario)
        : {};
      const compareEnabled = resolution.kind === 'supported'
        && resolvedIntent === 'explain_change'
        && compare === true;
      const previousPeriod = compareEnabled ? buildPreviousPeriod(period) : null;
      const requestContext = {
        question,
        resolvedIntent,
        compare: compareEnabled,
        period: {
          from: period.from,
          to: period.to,
          previousFrom: previousPeriod?.from || null,
          previousTo: previousPeriod?.to || null,
          timezone: businessTimezone
        },
        scenario: normalizedScenario
      };

      if (resolution.kind === 'out_of_scope') {
        const completedResult = {
          response: createOutOfScopeResponse(resolution),
          usageStatus: null,
          providerCalled: false,
          quotaOutcome: 'not_consumed'
        };
        setResult(completedResult);
        setDownloadContext(requestContext);
        void persistHistoryEntry({ completedResult, requestContext, queriedAt, contextToken: requestContextToken });
        return;
      }

      const requestKey = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${question}`;
      const response = await runSalesProfitabilityAgent({
        question,
        intent: resolvedIntent,
        period: { ...period, timezone: businessTimezone },
        compare: compareEnabled,
        scenario: normalizedScenario,
        requestKey
      });
      if (historyContextTokenRef.current !== requestContextToken) return;
      const responseStatus = response?.response?.status;
      const hasVisibleAnswer = [
        response?.response?.executiveSummary,
        response?.response?.answer,
        response?.response?.explanation
      ].some((value) => typeof value === 'string' && value.trim().length > 0);
      if (
        !['completed', 'incomplete', 'insufficient_data'].includes(responseStatus)
        || !hasVisibleAnswer
      ) {
        throw new Error('INVALID_AGENT_RESPONSE');
      }

      const completedResult = {
        ...response,
        quotaOutcome: response?.quotaOutcome || 'not_confirmed'
      };
      setResult(completedResult);
      if (completedResult.usageStatus) setUsageStatus(completedResult.usageStatus);
      setDownloadContext({
        ...requestContext,
        period: {
          ...requestContext.period,
          timezone: response?.response?.queryRange?.current?.timezone || businessTimezone
        }
      });
      if (completedResult.providerCalled) void refreshUsage();
      void persistHistoryEntry({
        completedResult,
        requestContext: {
          ...requestContext,
          period: {
            ...requestContext.period,
            timezone: completedResult?.response?.queryRange?.current?.timezone || businessTimezone
          }
        },
        queriedAt,
        contextToken: requestContextToken
      });
    } catch (error) {
      console.error('[CommercialAIAgentsPage] No se pudo procesar la consulta.', {
        code: error?.code || error?.originalError?.code || 'COMMERCIAL_ANALYSIS_FAILED',
        statusCode: error?.statusCode || null,
        requestId: error?.originalError?.requestId || error?.originalError?.request_id || null,
        cause: error?.originalError?.message || error?.message || null
      });
      setAnalysisError('No pudimos procesar esta consulta. Revisa las opciones seleccionadas e inténtalo nuevamente.');
      void refreshUsage();
    } finally {
      analysisInFlightRef.current = false;
      setIsAnalyzing(false);
    }
  };

  const handleDownload = () => {
    if (!result?.response || !downloadContext || isDownloading) return;
    setIsDownloading(true);
    setDownloadError(null);
    const schedule = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
      ? window.setTimeout.bind(window)
      : setTimeout;
    schedule(() => {
      try {
        downloadSalesProfitabilityReport(result, downloadContext);
      } catch {
        setDownloadError('No se pudo generar el reporte descargable. El análisis actual permanece disponible.');
      } finally {
        setIsDownloading(false);
      }
    }, 0);
  };

  const activeHistoryState = historyState.contextToken === historyContextToken
    ? historyState
    : { contextToken: historyContextToken, entries: [], isLoading: true, issue: null };

  const handleDeleteHistoryEntry = (entryId) => {
    const scope = historyScopeRef.current;
    if (!historyContextToken || scope.contextToken !== historyContextToken || !scope.scopeKey) return;
    const deleted = deleteSalesProfitabilityHistoryEntry({ scopeKey: scope.scopeKey, id: entryId });
    setHistoryState((current) => current.contextToken === historyContextToken
      ? { ...current, entries: deleted.entries, issue: deleted.issue }
      : current);
    if (selectedHistoryEntryId === entryId) setSelectedHistoryEntryId(null);
  };

  const handleClearHistory = () => {
    const scope = historyScopeRef.current;
    if (!historyContextToken || scope.contextToken !== historyContextToken || !scope.scopeKey) return;
    const cleared = clearSalesProfitabilityHistory();
    setHistoryState((current) => current.contextToken === historyContextToken
      ? { ...current, entries: [], issue: cleared.issue }
      : current);
    setSelectedHistoryEntryId(null);
  };

  const handleDownloadHistoryEntry = (entry) => {
    setIsDownloadingHistory(true);
    try {
      downloadSalesProfitabilityHistoryEntry(entry);
      setHistoryState((current) => ({ ...current, issue: null }));
    } catch {
      setHistoryState((current) => ({ ...current, issue: 'download_error' }));
    } finally {
      setIsDownloadingHistory(false);
    }
  };

  const showsProductScenario = intent === 'price_simulation' || intent === 'promotion_opportunity';

  return (
    <main className="commercial-ai-page" aria-labelledby="commercial-ai-title">
      <header className="commercial-ai-hero">
        <div className="commercial-ai-hero__icon" aria-hidden="true"><Sparkles size={24} /></div>
        <div><p className="commercial-ai-eyebrow">Centro de agentes IA</p><h1 id="commercial-ai-title">Agentes IA comerciales</h1><p className="commercial-ai-intro">Lanzo-POS calcula los datos; la IA los explica en lenguaje de negocio.</p></div>
      </header>

      <section className="commercial-ai-card-grid" aria-label="Agentes IA comerciales disponibles">
        <article className="commercial-ai-card commercial-ai-card--violet commercial-ai-card--active">
          <div className="commercial-ai-card__topline"><span className="commercial-ai-card__icon" aria-hidden="true"><BarChart3 size={22} /></span><span className="commercial-ai-status">Disponible</span></div>
          <h2>Ventas y rentabilidad</h2>
          <p>Revisa rentabilidad, cambios de margen, productos de riesgo y escenarios comerciales.</p>
          <div className="commercial-ai-card__availability"><ShieldCheck size={16} aria-hidden="true" /><span>Solo lectura: no modifica precios, productos ni datos financieros.</span></div>
        </article>
        <article className="commercial-ai-card commercial-ai-card--blue commercial-ai-card--disabled" aria-disabled="true">
          <div className="commercial-ai-card__topline"><span className="commercial-ai-card__icon" aria-hidden="true"><Globe2 size={22} /></span><span className="commercial-ai-status commercial-ai-status--muted">FEATURE_NOT_READY</span></div>
          <h2>Ecommerce</h2><p>Analiza pedidos, catálogo y oportunidades de tu tienda en línea.</p>
          <div className="commercial-ai-card__availability"><ShieldCheck size={16} aria-hidden="true" /><span>Disponible en una siguiente fase.</span></div>
        </article>
      </section>

      <section className="commercial-ai-workspace" aria-labelledby="sales-agent-title">
        <div className="commercial-ai-workspace__heading">
          <div><p className="commercial-ai-eyebrow">Agente activo</p><h2 id="sales-agent-title">Pregunta sobre tu negocio</h2></div>
          <span className="commercial-ai-readonly"><ShieldCheck size={15} /> Solo lectura y simulación</span>
        </div>

        <UsageStatusPanel
          usageStatus={usageStatus}
          isLoading={isLoadingUsage}
          error={usageError}
          onRetry={refreshUsage}
        />

        <form onSubmit={handleAnalyze}>
          <label className="commercial-ai-label" htmlFor="sales-agent-question">Pregunta libre</label>
          <textarea id="sales-agent-question" value={question} onChange={handleQuestionChange} placeholder="Ej. ¿Mi negocio es rentable?" rows={3} maxLength={1200} />
          <div className="commercial-ai-suggestions" aria-label="Preguntas sugeridas">
            {SUGGESTED_QUESTIONS.map((suggestion) => (
              <button type="button" className={`commercial-ai-suggestion ${intent === suggestion.intent ? 'is-selected' : ''}`} key={suggestion.intent} onClick={() => selectIntent(suggestion.label)}>
                {suggestion.label}
              </button>
            ))}
          </div>

          {(questionResolution.kind === 'supported' || !question.trim()) && (
            <div className="commercial-ai-filters">
              <label className="commercial-ai-label" htmlFor="sales-agent-period">Periodo
                <span className="commercial-ai-select-wrap">
                  <select id="sales-agent-period" value={periodDays} onChange={(event) => setPeriodDays(Number(event.target.value))}>
                    {PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <ChevronDown size={15} aria-hidden="true" />
                </span>
              </label>
              {intent === 'explain_change' && (
                <label className="commercial-ai-checkbox"><input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} /> Comparar con el periodo anterior</label>
              )}
            </div>
          )}

          {showsProductScenario && (
            <div className="commercial-ai-scenario-panel">
              {productOptions.length > 20 && (
                <label className="commercial-ai-label" htmlFor="sales-agent-product-search">Buscar producto
                  <span className="commercial-ai-search-wrap"><Search size={15} aria-hidden="true" /><input id="sales-agent-product-search" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Escribe el nombre" /></span>
                </label>
              )}
              <div className="commercial-ai-scenario-form">
                <label className="commercial-ai-label" htmlFor="sales-agent-product">Producto
                  <span className="commercial-ai-select-wrap">
                    <select id="sales-agent-product" name="productName" value={scenario.productName || ''} onChange={handleScenarioChange} disabled={isLoadingProducts || productOptions.length === 0}>
                      <option value="">{isLoadingProducts ? 'Cargando productos…' : productOptions.length ? 'Selecciona un producto' : 'No hay productos en este periodo'}</option>
                      {filteredProductOptions.map((product) => <option key={product.name} value={product.name}>{product.name}</option>)}
                    </select>
                    <ChevronDown size={15} aria-hidden="true" />
                  </span>
                </label>
                {intent === 'price_simulation' && (
                  <label className="commercial-ai-label" htmlFor="sales-agent-new-price">Nuevo precio
                    <input id="sales-agent-new-price" name="newPrice" type="number" min="0.01" step="0.01" placeholder="Obligatorio" value={scenario.newPrice ?? ''} onChange={handleScenarioChange} />
                  </label>
                )}
                {intent === 'promotion_opportunity' && (
                  <>
                    <label className="commercial-ai-label" htmlFor="sales-agent-promotion-mode">Tipo de promoción
                      <span className="commercial-ai-select-wrap">
                        <select id="sales-agent-promotion-mode" value={promotionMode} onChange={(event) => {
                          const nextMode = event.target.value;
                          setPromotionMode(nextMode);
                          setScenario((current) => ({ ...current, promotionalPrice: undefined, discountPercent: undefined }));
                        }}>
                          <option value="discountPercent">Descuento porcentual</option>
                          <option value="promotionalPrice">Precio promocional</option>
                        </select>
                        <ChevronDown size={15} aria-hidden="true" />
                      </span>
                    </label>
                    {promotionMode === 'discountPercent' ? (
                      <label className="commercial-ai-label" htmlFor="sales-agent-discount">Descuento porcentual
                        <input id="sales-agent-discount" name="discountPercent" type="number" min="0" max="100" step="0.1" placeholder="Opcional" value={scenario.discountPercent ?? ''} onChange={handleScenarioChange} />
                      </label>
                    ) : (
                      <label className="commercial-ai-label" htmlFor="sales-agent-promotional-price">Precio promocional
                        <input id="sales-agent-promotional-price" name="promotionalPrice" type="number" min="0.01" step="0.01" placeholder="Opcional" value={scenario.promotionalPrice ?? ''} onChange={handleScenarioChange} />
                      </label>
                    )}
                  </>
                )}
                <label className="commercial-ai-label" htmlFor="sales-agent-historical-volume">Volumen esperado (opcional)
                  <input id="sales-agent-historical-volume" name="historicalVolume" type="number" min="0" step="1" placeholder="Usar histórico" value={scenario.historicalVolume ?? ''} onChange={handleScenarioChange} />
                </label>
              </div>
              {productLoadError && <p className="commercial-ai-inline-error">{productLoadError}</p>}
              {!isLoadingProducts && productOptions.length > 0 && <p className="commercial-ai-product-count">{productOptions.length} producto(s) elegible(s) del periodo · cargados sin usar IA ni cuota.</p>}
              {!isLoadingProducts && excludedProductSummary.map(({ reason, count }) => (
                <p className="commercial-ai-inline-note" key={reason}>Se excluyeron {count} producto(s): {reason}.</p>
              ))}
            </div>
          )}

          <div className="commercial-ai-submit-row">
            <p>Periodo: <b>{period.from} a {period.to}</b>{intent === 'explain_change' && compare && ' · con comparación'}</p>
            <button className="commercial-ai-analyze" type="submit" disabled={!question.trim() || isAnalyzing}><Send size={16} aria-hidden="true" /> {isAnalyzing ? 'Analizando…' : 'Analizar'}</button>
          </div>
        </form>

        {isAnalyzing && <div className="commercial-ai-loading" role="status"><span className="commercial-ai-spinner" /> Calculando resultados y preparando una explicación clara…</div>}
        {analysisError && <div className="commercial-ai-error" role="alert"><AlertTriangle size={18} /> {analysisError}</div>}
        {downloadError && <div className="commercial-ai-error" role="alert"><AlertTriangle size={18} /> {downloadError}</div>}
        <AnalysisResult result={result} onDownload={handleDownload} isDownloading={isDownloading} />
      </section>

      <HistoryPanel
        entries={activeHistoryState.entries}
        isLoading={activeHistoryState.isLoading}
        issue={activeHistoryState.issue}
        selectedEntryId={selectedHistoryEntryId}
        onSelect={setSelectedHistoryEntryId}
        onDelete={handleDeleteHistoryEntry}
        onClear={handleClearHistory}
        onDownload={handleDownloadHistoryEntry}
        isDownloading={isDownloadingHistory}
      />

      <aside className="commercial-ai-notice" role="note"><ShieldCheck size={18} aria-hidden="true" /><p>Lanzo-POS calcula ventas, costos, utilidad y escenarios. La IA explica esos resultados y no ejecuta cambios.</p></aside>
    </main>
  );
}
