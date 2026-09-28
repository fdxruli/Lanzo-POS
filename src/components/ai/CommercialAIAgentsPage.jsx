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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  createCommercialLocalResponse,
  normalizeCommercialAINarrativeDiagnosticCode,
  normalizeScenarioForIntent,
  resolveCommercialIntent
} from '../../services/ai/commercialAgentContract';
import { inferCommercialScenarioFromQuestion, isCommercialStrategyQuestion } from '../../services/ai/commercialQuestionRouter';
import { LIA_IDENTITY } from '../../services/ai/liaIdentity';
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
  { label: '¿Qué promoción puedo simular?', intent: 'promotion_opportunity' },
  { label: '¿Dónde tengo oportunidades en mi surtido?', intent: 'assortment_analysis' },
  { label: '¿Cómo puedo aumentar mis ventas?', intent: 'sales_growth' },
  { label: '¿Cómo puedo aumentar mi ticket promedio?', intent: 'ticket_growth' }
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
  AI_NARRATIVE_TRUNCATED: 'La respuesta del proveedor alcanzó el límite de salida antes de completarse.',
  AI_NARRATIVE_PARTIAL_CONTENT: 'Se omitieron partes de la narrativa que no superaron la validación.',
  AI_REQUEST_REJECTED: 'La solicitud fue rechazada antes de generar una explicación.',
  AI_NARRATIVE_LOW_VALUE: 'La respuesta no incluyó una recomendación accionable con evidencia suficiente. Este intento no consumió un uso de IA.',
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

const GOAL_TYPE_LABELS = Object.freeze({
  revenue: 'Ventas netas',
  gross_profit: 'Utilidad bruta',
  average_ticket: 'Ticket promedio',
  gross_margin: 'Margen bruto',
  product_margin: 'Margen de producto'
});

function GoalSimulationEvidence({ response }) {
  const goal = response.goalSimulation || {};
  const percentValue = (value) => value === null || value === undefined
    ? 'No disponible'
    : `${formatAnalysisValue.formatNumber(value, 1)}%`;
  if (!goal.type) return <p className="commercial-ai-muted">Indica el tipo de meta y su valor objetivo para calcular el escenario.</p>;
  if (!goal.ready) {
    return <>
      <p className="commercial-ai-evidence-lead">Meta de {GOAL_TYPE_LABELS[goal.type] || 'valor comercial'}: {goal.type.includes('margin') ? percentValue(goal.targetValue) : formatAnalysisValue.formatMoney(goal.targetValue)}</p>
      <p className="commercial-ai-caution">{goal.limitation || 'No hay datos suficientes para realizar este cálculo.'}</p>
    </>;
  }
  if (goal.type === 'revenue') {
    return <>
      <MetricGrid>
        <Metric label="Meta de ventas" value={formatAnalysisValue.formatMoney(goal.targetValue)} />
        <Metric label="Ventas actuales" value={formatAnalysisValue.formatMoney(goal.currentSales)} />
        <Metric label={goal.state === 'achieved' ? 'Excedente' : 'Brecha'} value={formatAnalysisValue.formatMoney(goal.state === 'achieved' ? goal.excess : goal.revenueGap)} />
        <Metric label="Brecha porcentual" value={goal.state === 'achieved' ? 'Meta alcanzada' : percentValue(goal.gapPercent)} note="Proporción faltante de la meta" />
        <Metric label="Progreso" value={formatAnalysisValue.formatPercent(goal.progress)} />
        <Metric label="Tickets actuales" value={formatAnalysisValue.formatNumber(goal.currentTickets, 0)} />
        <Metric label="Ticket promedio actual" value={formatAnalysisValue.formatMoney(goal.currentAverageTicket)} />
        <Metric label="Tickets adicionales" value={goal.state === 'achieved' ? 'Meta alcanzada' : formatAnalysisValue.formatNumber(goal.requiredAdditionalTicketsAtCurrentTicket, 0)} note="Si se mantiene el ticket promedio" />
        <Metric label="Ticket requerido" value={formatAnalysisValue.formatMoney(goal.requiredAverageTicketAtCurrentTicketCount)} note="Si se mantiene el número de tickets" />
      </MetricGrid>
    </>;
  }
  if (goal.type === 'gross_profit') {
    return <>
      <MetricGrid>
        <Metric label="Utilidad actual" value={formatAnalysisValue.formatMoney(goal.currentProfit)} />
        <Metric label="Meta de utilidad" value={formatAnalysisValue.formatMoney(goal.targetProfit)} />
        <Metric label={goal.state === 'achieved' ? 'Excedente' : 'Brecha'} value={formatAnalysisValue.formatMoney(goal.state === 'achieved' ? goal.excess : goal.profitGap)} />
        <Metric label="Margen bruto actual" value={formatAnalysisValue.formatPercent(goal.currentMargin)} />
        <Metric label="Ventas requeridas" value={formatAnalysisValue.formatMoney(goal.requiredRevenue)} />
        <Metric label="Ventas adicionales" value={formatAnalysisValue.formatMoney(goal.additionalRevenue)} />
        <Metric label="Tickets equivalentes" value={formatAnalysisValue.formatNumber(goal.equivalentAdditionalTickets, 0)} note="Al ticket promedio actual" />
      </MetricGrid>
      <p className="commercial-ai-caution">Supone mezcla de productos y margen bruto constantes; no es una predicción.</p>
    </>;
  }
  if (goal.type === 'average_ticket') {
    return <MetricGrid>
      <Metric label="Ticket promedio actual" value={formatAnalysisValue.formatMoney(goal.currentAverageTicket)} />
      <Metric label="Meta de ticket" value={formatAnalysisValue.formatMoney(goal.targetValue)} />
      <Metric label={goal.state === 'achieved' ? 'Meta alcanzada · excedente' : 'Diferencia'} value={formatAnalysisValue.formatMoney(goal.state === 'achieved' ? goal.excess : goal.ticketDifference)} />
      <Metric label="Cambio matemático" value={goal.state === 'achieved' ? 'Meta alcanzada' : goal.ticketChangePercent === null ? 'No disponible' : percentValue(goal.ticketChangePercent)} />
      <Metric label="Tickets actuales" value={formatAnalysisValue.formatNumber(goal.currentTickets, 0)} />
      <Metric label="Ventas al conteo actual" value={formatAnalysisValue.formatMoney(goal.requiredSalesAtCurrentTicketCount)} />
      <Metric label={goal.state === 'achieved' ? 'Excedente frente a ventas requeridas' : 'Incremento matemático de ventas'} value={formatAnalysisValue.formatMoney(Math.abs(goal.salesIncreaseAtCurrentTicketCount))} />
    </MetricGrid>;
  }
  if (goal.type === 'gross_margin') {
    return <>
      <MetricGrid>
        <Metric label="Margen actual" value={formatAnalysisValue.formatPercent(goal.currentMargin)} />
        <Metric label="Meta de margen" value={percentValue(goal.targetValue)} />
        <Metric label={goal.state === 'achieved' ? 'Estado de meta' : 'Brecha de margen'} value={goal.state === 'achieved' ? 'Meta alcanzada' : percentValue(goal.gap)} />
        <Metric label="Ventas actuales" value={formatAnalysisValue.formatMoney(goal.currentSales)} />
        <Metric label="Utilidad actual" value={formatAnalysisValue.formatMoney(goal.currentProfit)} />
        <Metric label="Utilidad requerida" value={formatAnalysisValue.formatMoney(goal.requiredProfitAtCurrentSales)} />
        <Metric label={goal.state === 'achieved' ? 'Excedente de utilidad' : 'Brecha de utilidad'} value={formatAnalysisValue.formatMoney(Math.abs(goal.additionalProfitRequired))} />
      </MetricGrid>
      <p className="commercial-ai-caution">La brecha no determina si se cerrará con cambios de precio, costo o mezcla de productos.</p>
    </>;
  }
  return <>
    <p className="commercial-ai-evidence-lead">{goal.productName || 'Producto seleccionado'}</p>
    <MetricGrid>
      <Metric label="Precio promedio actual" value={formatAnalysisValue.formatMoney(goal.currentPrice)} />
      <Metric label="Costo unitario conocido" value={formatAnalysisValue.formatMoney(goal.unitCost)} />
      <Metric label="Margen actual" value={formatAnalysisValue.formatPercent(goal.currentMargin)} />
      <Metric label="Margen objetivo" value={percentValue(goal.targetValue)} />
      <Metric label="Precio matemático requerido" value={formatAnalysisValue.formatMoney(goal.requiredPrice)} />
      <Metric label="Diferencia frente al precio actual" value={formatAnalysisValue.formatMoney(goal.priceDifference)} note={goal.priceChangePercent === null ? null : percentValue(goal.priceChangePercent)} />
    </MetricGrid>
    <p className="commercial-ai-caution">No se modifica el precio real ni se predice la demanda a ese precio.</p>
  </>;
}

function WhatIfEvidence({ response }) {
  const scenario = response.whatIfSimulation || {};
  if (!scenario.ready) return <p className="commercial-ai-muted">{asArray(scenario.limitations).join(' ') || 'No hay datos suficientes para simular este escenario.'}</p>;
  const percent = `${formatAnalysisValue.formatNumber(scenario.changePercent, 1)}%`;
  if (scenario.changeType === 'product') {
    return <>
      <p className="commercial-ai-evidence-lead">{scenario.productName} · cambio simulado {percent}</p>
      <MetricGrid>
        <Metric label="Unidades históricas" value={formatAnalysisValue.formatNumber(scenario.historicalUnits)} />
        <Metric label="Unidades simuladas" value={formatAnalysisValue.formatNumber(scenario.simulatedUnits)} note="Permite fracciones en el cálculo" />
        <Metric label="Precio promedio histórico" value={formatAnalysisValue.formatMoney(scenario.averagePrice)} />
        <Metric label="Ventas históricas" value={formatAnalysisValue.formatMoney(scenario.historicalSales)} />
        <Metric label="Ventas simuladas" value={formatAnalysisValue.formatMoney(scenario.simulatedSales)} />
        <Metric label="Costo actual" value={formatAnalysisValue.formatMoney(scenario.currentCost)} />
        <Metric label="Costo simulado" value={formatAnalysisValue.formatMoney(scenario.simulatedCost)} />
        <Metric label="Utilidad actual" value={formatAnalysisValue.formatMoney(scenario.currentProfit)} />
        <Metric label="Utilidad simulada" value={formatAnalysisValue.formatMoney(scenario.simulatedProfit)} />
        <Metric label="Margen actual" value={formatAnalysisValue.formatPercent(scenario.currentMargin)} />
        <Metric label="Margen simulado" value={formatAnalysisValue.formatPercent(scenario.simulatedMargin)} />
        <Metric label="Cambio en utilidad" value={formatAnalysisValue.formatMoney(scenario.profitDelta)} />
      </MetricGrid>
      <p className="commercial-ai-caution">Mantiene el precio promedio histórico y no predice cómo reaccionará la demanda. Si el costo es desconocido, la utilidad y el margen permanecen no disponibles.</p>
    </>;
  }
  if (scenario.changeType === 'ticket') {
    return <>
      <MetricGrid>
        <Metric label="Cambio simulado" value={percent} />
        <Metric label="Tickets mantenidos" value={formatAnalysisValue.formatNumber(scenario.ticketCount, 0)} />
        <Metric label="Ticket promedio actual" value={formatAnalysisValue.formatMoney(scenario.currentTicket)} />
        <Metric label="Ticket promedio simulado" value={formatAnalysisValue.formatMoney(scenario.simulatedTicket)} />
        <Metric label="Ventas actuales" value={formatAnalysisValue.formatMoney(scenario.currentSales)} />
        <Metric label="Ventas simuladas" value={formatAnalysisValue.formatMoney(scenario.simulatedSales)} />
        <Metric label="Variación de ventas" value={formatAnalysisValue.formatMoney(scenario.salesDelta)} />
        <Metric label="Costo actual" value={formatAnalysisValue.formatMoney(scenario.currentCost)} />
        <Metric label="Costo simulado" value={formatAnalysisValue.formatMoney(scenario.simulatedCost)} />
        <Metric label="Utilidad actual" value={formatAnalysisValue.formatMoney(scenario.currentProfit)} />
        <Metric label="Utilidad simulada" value={formatAnalysisValue.formatMoney(scenario.simulatedProfit)} />
        <Metric label="Margen actual" value={formatAnalysisValue.formatPercent(scenario.currentMargin)} />
        <Metric label="Margen simulado" value={formatAnalysisValue.formatPercent(scenario.simulatedMargin)} />
      </MetricGrid>
      <p className="commercial-ai-caution">Mantiene el mismo número de tickets; sólo proyecta utilidad y margen si los costos están completos. No predice la reacción de la demanda ni afirma que el cambio sea alcanzable.</p>
    </>;
  }
  return <>
    <MetricGrid>
      <Metric label="Cambio simulado" value={percent} />
      <Metric label="Ventas actuales" value={formatAnalysisValue.formatMoney(scenario.currentSales)} />
      <Metric label="Ventas simuladas" value={formatAnalysisValue.formatMoney(scenario.simulatedSales)} />
      <Metric label="Variación de ventas" value={formatAnalysisValue.formatMoney(scenario.salesDelta)} />
      <Metric label="Costo actual" value={formatAnalysisValue.formatMoney(scenario.currentCost)} />
      <Metric label="Costo simulado" value={formatAnalysisValue.formatMoney(scenario.simulatedCost)} />
      <Metric label="Utilidad actual" value={formatAnalysisValue.formatMoney(scenario.currentProfit)} />
      <Metric label="Utilidad simulada" value={formatAnalysisValue.formatMoney(scenario.simulatedProfit)} />
      <Metric label="Cambio en utilidad" value={formatAnalysisValue.formatMoney(scenario.profitDelta)} />
      <Metric label="Margen actual" value={formatAnalysisValue.formatPercent(scenario.currentMargin)} />
      <Metric label="Margen simulado" value={formatAnalysisValue.formatPercent(scenario.simulatedMargin)} />
    </MetricGrid>
    <p className="commercial-ai-caution">Escala las ventas y, si hay costos completos, los costos por el mismo factor para conservar la mezcla y el margen. No predice la reacción de la demanda.</p>
  </>;
}

const STRATEGY_REASON_LABELS = Object.freeze({
  ticket_down_sales_stable: 'El ticket bajó mientras ventas y número de tickets se mantuvieron relativamente estables.',
  sales_declining: 'Las ventas netas disminuyeron frente al periodo comparable.',
  margin_deteriorating: 'El margen bruto completo disminuyó frente al periodo comparable.',
  product_cost_missing: 'Falta evidencia completa del costo de este producto.',
  product_low_margin: 'El producto registra volumen o ventas relevantes y margen bajo con costos completos.',
  product_growing: 'El producto muestra crecimiento en el periodo comparable.',
  category_concentrated: 'Una proporción alta de las ventas se concentra en esta categoría.',
  category_growing: 'La categoría aumentó sus ventas frente a un periodo comparable completo.',
  products_without_sales: 'Hay productos activos sin ventas registradas en un periodo con detalle completo.',
  historical_combo: 'Estos productos aparecieron juntos en tickets históricos.'
});

function StrategyEvidence({ response }) {
  const candidates = asArray(response.strategyCandidates);
  if (!candidates.length) return <p className="commercial-ai-muted">No hay señales completas suficientes para priorizar una estrategia comercial.</p>;
  return <div className="commercial-ai-recommendations">
    {candidates.slice(0, 8).map((candidate) => (
      <article className="commercial-ai-recommendation" key={`${candidate.type}:${candidate.key}`}>
        <div><strong>{candidate.title}</strong><span>Prioridad {priorityLabel(candidate.priority)}</span></div>
        <p>{STRATEGY_REASON_LABELS[candidate.reasonCode] || 'Señal comercial observada en los datos.'}</p>
        {candidate.entity && candidate.type !== 'general' && <small>Enfoque: {candidate.type === 'product' ? 'Producto' : candidate.type === 'category' ? 'Categoría' : 'Ticket'} · {candidate.entity}</small>}
        {candidate.reasonCode === 'historical_combo' && <small>La coocurrencia histórica no garantiza demanda futura.</small>}
      </article>
    ))}
  </div>;
}

const productDirectionLabel = (direction) => ({
  new_in_period: 'Sin venta anterior',
  not_sold_current: 'Sin venta actual',
  growing: 'Creció',
  declining: 'Disminuyó',
  stable: 'Sin cambio relevante'
}[direction] || 'Sin comparación');

const PRODUCT_SIGNAL_LABELS = Object.freeze({
  growing: 'Ventas crecientes',
  declining: 'Ventas decrecientes',
  new_in_period: 'Sin venta anterior',
  not_sold_current: 'Sin venta actual',
  stable: 'Sin cambio relevante',
  high_sales_share: 'Participación alta',
  healthy_margin: 'Margen conocido ≥ 20%',
  low_margin: 'Margen conocido < 20%',
  cost_unknown: 'Falta costo para evaluar margen'
});

function ProductGrowthTable({ products, emptyMessage }) {
  const rows = asArray(products).slice(0, 10);
  if (!rows.length) return <p className="commercial-ai-muted">{emptyMessage}</p>;
  return (
    <div className="commercial-ai-table-wrap">
      <table className="commercial-ai-table">
        <caption className="sr-only">Comparación de ventas y señales de productos existentes</caption>
        <thead><tr><th>Producto</th><th>Ventas actuales</th><th>Variación</th><th>Unidades</th><th>Participación</th><th>Margen</th><th>Señal</th></tr></thead>
        <tbody>{rows.map((product) => (
          <tr key={product.name}>
            <th scope="row"><span>{product.name}</span><small>{asArray(product.signals).map((signal) => PRODUCT_SIGNAL_LABELS[signal]).filter(Boolean).join(' · ') || productDirectionLabel(product.direction)}</small></th>
            <td>{formatAnalysisValue.formatMoney(product.currentSales)}</td>
            <td>{formatAnalysisValue.formatMoney(product.salesDelta)}{product.salesDeltaPercent !== null && product.salesDeltaPercent !== undefined ? ` · ${formatAnalysisValue.formatPercent(product.salesDeltaPercent)}` : ''}</td>
            <td>{formatAnalysisValue.formatNumber(product.currentUnits, 0)}{product.unitsDelta !== null && product.unitsDelta !== undefined ? ` · ${product.unitsDelta > 0 ? '+' : ''}${formatAnalysisValue.formatNumber(product.unitsDelta, 0)}` : ''}</td>
            <td>{formatAnalysisValue.formatPercent(product.currentShare)}</td>
            <td>{product.costKnown === true ? formatAnalysisValue.formatPercent(product.currentMargin) : 'No disponible'}</td>
            <td>{product.opportunityReason || productDirectionLabel(product.direction)}{product.costKnown !== true && product.direction !== 'not_sold_current' ? ' · costo sin confirmar' : ''}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function SalesGrowthEvidence({ response }) {
  const current = response.current || {};
  const comparison = response.comparison;
  const channels = asArray(current.channels).slice(0, 4);
  const productRows = response.intent === 'product_opportunity'
    ? asArray(comparison?.productChanges)
    : asArray(response.productOpportunities).length
      ? asArray(response.productOpportunities)
      : asArray(response.growthSignals?.productsGrowing);
  return (
    <>
      <MetricGrid>
        <Metric label="Ventas actuales" value={formatAnalysisValue.formatMoney(current.netSales)} />
        <Metric label="Ventas anteriores" value={formatAnalysisValue.formatMoney(comparison?.previousNetSales)} />
        <Metric label="Variación de ventas" value={formatAnalysisValue.formatMoney(comparison?.deltaNetSales)} note={comparison?.deltaNetSalesPercent === null || comparison?.deltaNetSalesPercent === undefined ? 'Porcentaje no disponible si el periodo anterior fue cero' : formatAnalysisValue.formatPercent(comparison.deltaNetSalesPercent)} />
        <Metric label="Tickets actuales" value={formatAnalysisValue.formatNumber(current.salesCount, 0)} />
        <Metric label="Tickets anteriores" value={formatAnalysisValue.formatNumber(comparison?.previousSalesCount, 0)} />
        <Metric label="Ticket promedio actual" value={formatAnalysisValue.formatMoney(current.averageTicket)} />
        <Metric label="Unidades por ticket" value={formatAnalysisValue.formatNumber(current.unitsPerTicket)} />
        <Metric label="Unidades actuales" value={formatAnalysisValue.formatNumber(current.units, 0)} note={response.coverage?.itemsComplete === true ? null : 'Detalle incompleto'} />
      </MetricGrid>
      {response.intent !== 'sales_trend' && (
        <>
          <h4 className="commercial-ai-subheading">Productos con señales para revisar</h4>
          {response.intent === 'product_opportunity' && response.coverage?.comparisonItemsAvailable !== true
            ? <p className="commercial-ai-muted">El detalle de artículos o la comparación está incompleta; no se puede confiar en una clasificación exhaustiva por producto.</p>
            : <ProductGrowthTable products={productRows} emptyMessage="No hay productos con una señal de crecimiento o participación suficiente para priorizar." />}
        </>
      )}
      <h4 className="commercial-ai-subheading">Canales de venta</h4>
      {channels.length ? (
        <div className="commercial-ai-channel-list">
          {channels.map((channel) => {
            const movement = asArray(comparison?.channelMixChanges).find((item) => item.channel === channel.channel);
            return <div className="commercial-ai-channel-row" key={channel.channel}>
              <strong>{channel.channel}</strong><span>{formatAnalysisValue.formatMoney(channel.netSales)} · {formatAnalysisValue.formatPercent(channel.share)} de las ventas</span>
              {movement && <small>Participación anterior {formatAnalysisValue.formatPercent(movement.previousShare)} · variación {formatAnalysisValue.formatPercent(movement.deltaShare)}</small>}
            </div>;
          })}
        </div>
      ) : <p className="commercial-ai-muted">No hay canales disponibles para este periodo.</p>}
      {response.intent === 'sales_trend' && response.coverage?.comparisonItemsAvailable !== true
        && <p className="commercial-ai-caution">La comparación no tiene detalle completo en ambos periodos; no se presenta un ranking de productos.</p>}
      <p className="commercial-ai-caution">Las variaciones describen periodos históricos y no demuestran causalidad ni garantizan crecimiento futuro.</p>
    </>
  );
}

function TicketGrowthEvidence({ response }) {
  const current = response.current || {};
  const comparison = response.comparison;
  const combos = asArray(response.comboOpportunities);
  return (
    <>
      <MetricGrid>
        <Metric label="Ticket promedio actual" value={formatAnalysisValue.formatMoney(current.averageTicket)} />
        <Metric label="Ticket promedio anterior" value={formatAnalysisValue.formatMoney(comparison?.previousTicket)} />
        <Metric label="Variación absoluta" value={formatAnalysisValue.formatMoney(comparison?.deltaTicket)} />
        <Metric label="Variación porcentual" value={comparison?.deltaTicketPercent === null || comparison?.deltaTicketPercent === undefined ? 'No disponible' : formatAnalysisValue.formatPercent(comparison.deltaTicketPercent)} />
        <Metric label="Tickets actuales" value={formatAnalysisValue.formatNumber(current.salesCount, 0)} />
        <Metric label="Unidades por ticket actual" value={formatAnalysisValue.formatNumber(current.unitsPerTicket)} />
        <Metric label="Unidades por ticket anterior" value={formatAnalysisValue.formatNumber(comparison?.previousUnitsPerTicket)} />
      </MetricGrid>
      {combos.length ? (
        <div className="commercial-ai-ticket-signals">
          <h4 className="commercial-ai-subheading">Combinaciones observadas en tickets</h4>
          {combos.slice(0, 3).map((combo) => (
            <article className="commercial-ai-ticket-signal" key={combo.products.join('|')}>
              <strong>{combo.products.join(' + ')}</strong>
              <span>{formatAnalysisValue.formatNumber(combo.tickets, 0)} tickets · ticket conjunto histórico {formatAnalysisValue.formatMoney(combo.averageJointSale)}</span>
              <small>Asociación histórica; no demuestra causalidad ni garantiza un ticket mayor.</small>
            </article>
          ))}
        </div>
      ) : <p className="commercial-ai-muted">No hay una combinación con la frecuencia histórica mínima en este periodo.</p>}
    </>
  );
}

const ASSORTMENT_SIGNAL_LABELS = Object.freeze({
  category_growing: 'En crecimiento',
  new_category_activity: 'Actividad nueva',
  category_declining: 'En descenso',
  strong_category_few_products: 'Categoría fuerte, pocos productos',
  single_product_concentration: 'Concentración en un producto',
  many_unsold_products: 'Varios productos sin ventas'
});
const ASSORTMENT_ACTIVITY_LABELS = Object.freeze({
  never_sold_in_window: 'Sin ventas en el periodo',
  previously_sold_now_inactive: 'Vendió antes; sin ventas actuales',
  low_activity: 'Actividad baja',
  declining: 'Ventas a la baja'
});

function AssortmentEvidence({ response }) {
  const assortment = response.assortment || {};
  const health = assortment.health || {};
  const concentration = health.concentration || {};
  const categories = asArray(assortment.categoryPerformance).slice(0, 10);
  const dormant = asArray(assortment.dormantProducts).slice(0, 12);
  return (
    <>
      <MetricGrid>
        <Metric label="Productos activos en catálogo" value={formatAnalysisValue.formatNumber(health.activeCatalogProducts, 0)} />
        <Metric label="Productos inactivos" value={formatAnalysisValue.formatNumber(health.inactiveCatalogProducts, 0)} />
        <Metric label="Productos con ventas" value={health.soldProducts === null ? 'No disponible' : formatAnalysisValue.formatNumber(health.soldProducts, 0)} />
        <Metric label="Productos sin ventas" value={health.unsoldProducts === null ? 'No disponible' : formatAnalysisValue.formatNumber(health.unsoldProducts, 0)} note={health.currentSalesCoverageComplete ? 'Periodo con detalle completo' : 'No se clasifica con detalle parcial'} />
        <Metric label="Ventas concentradas en el producto principal" value={formatAnalysisValue.formatPercent(concentration.topProductShare)} />
        <Metric label="Ventas concentradas en los 3 principales" value={formatAnalysisValue.formatPercent(concentration.top3ProductShare)} />
        <Metric label="Ventas de la categoría principal" value={formatAnalysisValue.formatPercent(concentration.topCategoryShare)} />
        <Metric label="Cobertura por categoría" value={formatAnalysisValue.formatPercent(health.categoryRevenueCoverage)} />
      </MetricGrid>

      <h4 className="commercial-ai-subheading">Desempeño por categoría</h4>
      {categories.length ? (
        <div className="commercial-ai-table-wrap">
          <table className="commercial-ai-table">
            <caption className="sr-only">Ventas y señales por categoría</caption>
            <thead><tr><th>Categoría</th><th>Ventas</th><th>Unidades</th><th>Participación</th><th>Productos activos / vendidos</th><th>Señales</th></tr></thead>
            <tbody>{categories.map((category) => (
              <tr key={category.name}>
                <th scope="row">{category.name}</th>
                <td>{formatAnalysisValue.formatMoney(category.netSales)}</td>
                <td>{formatAnalysisValue.formatNumber(category.units, 0)}</td>
                <td>{formatAnalysisValue.formatPercent(category.salesShare)}</td>
                <td>{category.soldProducts === null ? '—' : `${formatAnalysisValue.formatNumber(category.soldProducts, 0)} / ${formatAnalysisValue.formatNumber(category.activeProducts, 0)}`}</td>
                <td>{asArray(category.signals).map((signal) => ASSORTMENT_SIGNAL_LABELS[signal]).filter(Boolean).join(' · ') || 'Sin señal destacada'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="commercial-ai-muted">No hay categorías con ventas para este periodo.</p>}

      <h4 className="commercial-ai-subheading">Productos para revisar</h4>
      {dormant.length ? (
        <div className="commercial-ai-table-wrap">
          <table className="commercial-ai-table">
            <caption className="sr-only">Productos con actividad baja, sin ventas o en reactivación</caption>
            <thead><tr><th>Producto</th><th>Categoría</th><th>Estado</th><th>Ventas actuales</th><th>Ventas anteriores</th><th>Disponibilidad</th></tr></thead>
            <tbody>{dormant.map((product) => (
              <tr key={`${product.candidateRef || product.name}-${product.activity}`}>
                <th scope="row">{product.name}</th>
                <td>{product.category || 'Sin categoría'}</td>
                <td>{ASSORTMENT_ACTIVITY_LABELS[product.activity] || 'Revisar actividad'}</td>
                <td>{formatAnalysisValue.formatMoney(product.currentSales)}</td>
                <td>{formatAnalysisValue.formatMoney(product.previousSales)}</td>
                <td>{product.availability === 'availability_unknown' ? 'No confirmada' : 'No evaluada'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="commercial-ai-muted">No se encontraron productos de baja actividad en los datos completos disponibles.</p>}
      <p className="commercial-ai-caution">Los productos sin ventas no implican demanda baja. Lanzo no infiere disponibilidad histórica ni usa inventario, costo o margen para estas señales.</p>
    </>
  );
}

function IntentEvidence({ response }) {
  switch (response.intent) {
    case 'profitability_summary': return <ProfitabilityEvidence response={response} />;
    case 'explain_change': return <MarginEvidence response={response} />;
    case 'product_risk': return <ProductRiskEvidence response={response} />;
    case 'sales_growth':
    case 'sales_trend': return <SalesGrowthEvidence response={response} />;
    case 'product_opportunity': return <SalesGrowthEvidence response={response} />;
    case 'assortment_analysis': return <AssortmentEvidence response={response} />;
    case 'ticket_growth': return <TicketGrowthEvidence response={response} />;
    case 'price_simulation': return <PriceEvidence response={response} />;
    case 'promotion_opportunity': return <PromotionEvidence response={response} />;
    case 'combo_opportunity': return <ComboEvidence response={response} />;
    case 'goal_simulation': return <GoalSimulationEvidence response={response} />;
    case 'what_if_analysis': return <WhatIfEvidence response={response} />;
    case 'commercial_strategy': return <StrategyEvidence response={response} />;
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
          {response.intent !== 'assortment_analysis' && <span>Cobertura de costos: {formatAnalysisValue.formatPercent(response.coverage?.costCoverage)}</span>}
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
      {response.intent !== 'assortment_analysis' && <Metric label="Cobertura de costos" value={formatAnalysisValue.formatPercent(coverage.costCoverage)} />}
      <Metric label="Detalle de artículos" value={coverage.itemsComplete === true ? 'Completo' : 'Incompleto'} />
      <Metric label="Paginación" value={coverage.paginationComplete === true ? 'Completa' : 'Incompleta'} />
      <Metric label="Fuente de datos" value={coverage.sourceComplete === true ? sourceLabel : `${sourceLabel} · revisar`} />
    </MetricGrid>
  );
}

function NarrativeEvidence({ response }) {
  const narrative = response.aiNarrative;
  const candidates = asArray(response.assortment?.opportunityCandidates);
  if (narrative?.status === 'unavailable') {
    const diagnosticCode = normalizeCommercialAINarrativeDiagnosticCode(narrative.diagnosticCode);
    return (
      <div>
        <p className="commercial-ai-muted">La respuesta de Lía no está disponible; el análisis calculado por Lanzo se conserva completo.</p>
        {diagnosticCode && (
          <p className="commercial-ai-muted" role="status">
            {NARRATIVE_DIAGNOSTIC_LABELS[diagnosticCode]}
          </p>
        )}
      </div>
    );
  }
  if (!narrative?.directAnswer && !narrative?.executiveSummary && !narrative?.explanation && !asArray(narrative?.recommendations).length) {
    return <p className="commercial-ai-muted">No se generó una narrativa IA para esta consulta. Los datos visibles son determinísticos.</p>;
  }
  return (
    <>
      <div className="commercial-ai-narrative">
        {asArray(narrative.recommendations).length > 0 && (
          <div className="commercial-ai-narrative__recommendations">
            <strong>Oportunidades priorizadas por Lía</strong>
            <div className="commercial-ai-narrative__recommendation-list">
              {asArray(narrative.recommendations).map((item) => (
                <article className="commercial-ai-narrative__recommendation" key={`${item.title}-${item.priority || 'medium'}`}>
                  <div>
                    <b>{item.title}</b>
                    <span>
                      {item.recommendationType === 'investigation' || item.recommendationType === 'data_quality'
                        ? 'Revisión'
                        : item.recommendationType === 'optimization' ? 'Optimización' : 'Prueba de crecimiento'}
                      {item.focus?.key ? ` · ${item.focus.type === 'category' ? 'Categoría' : item.focus.type === 'product' ? 'Producto' : item.focus.type === 'channel' ? 'Canal' : 'Métrica'}: ${candidates.find((candidate) => candidate.key === item.focus.key)?.entity || item.focus.key}` : ''}
                      {` · Prioridad ${priorityLabel(item.priority)}`}
                    </span>
                  </div>
                  <p><strong>Por qué:</strong> {item.explanation}</p>
                  {item.action && <p><strong>Qué probar:</strong> {item.action}</p>}
                  {item.measurement && <p><strong>Qué medir:</strong> {item.measurement}</p>}
                  {item.expectedImpact && <small>Qué permitirá validar: {item.expectedImpact} · Requiere confirmación manual</small>}
                </article>
              ))}
            </div>
          </div>
        )}
        {narrative.explanation && <p><strong>Por qué Lía llega a esta conclusión:</strong> {narrative.explanation}</p>}
        {narrative.confidence && <small>Confianza de esta interpretación: {confidenceLabel(narrative.confidence)}.</small>}
      </div>
      {narrative.status === 'available' && narrative.diagnosticCode === 'AI_NARRATIVE_PARTIAL_CONTENT' && (
        <p className="commercial-ai-muted" role="status">
          {NARRATIVE_DIAGNOSTIC_LABELS.AI_NARRATIVE_PARTIAL_CONTENT}
        </p>
      )}
    </>
  );
}

function NarrativeStatusNotice({ result }) {
  if (result?.response?.aiNarrative?.status !== 'unavailable') return null;

  const message = result.quotaOutcome === 'not_consumed'
    ? (result.providerCalled === true
      ? 'El proveedor respondió, pero no entregó una narrativa válida. Este intento no consumió un uso de IA.'
      : 'No pude generar la explicación con IA. Este intento no consumió un uso de IA.')
    : result.quotaOutcome === 'consumed'
      ? 'La explicación con IA no estuvo disponible. El uso de IA quedó registrado.'
      : 'No pude completar la explicación con IA. Estamos verificando el estado del uso de IA.';

  return (
    <div className="commercial-ai-narrative-notice" role="status">
      <strong>Análisis calculado por Lanzo.</strong> {message}
    </div>
  );
}

function AnalysisResult({ result, onDownload, isDownloading }) {
  const response = result?.response || null;
  const isLocalAnswer = ['out_of_scope', 'not_ready', 'local_answer'].includes(response?.status);
  const narrative = response?.aiNarrative || null;
  const directAnswer = typeof narrative?.directAnswer === 'string' && narrative.directAnswer.trim()
    ? narrative.directAnswer
    : (typeof narrative?.executiveSummary === 'string' && narrative.executiveSummary.trim() ? narrative.executiveSummary : null);
  const narrativeAvailable = narrative?.status === 'available' && Boolean(directAnswer);
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
        <div>
          <p className="commercial-ai-eyebrow">{isLocalAnswer ? 'Respuesta' : narrativeAvailable ? 'Respuesta de Lía' : 'Análisis calculado por Lanzo'}</p>
          <h2>{narrativeAvailable ? directAnswer : (response.executiveSummary || response.answer)}</h2>
        </div>
        {!isLocalAnswer && (
          <button type="button" className="commercial-ai-download" onClick={onDownload} disabled={isDownloading} aria-label="Descargar reporte completo">
            <Download size={16} aria-hidden="true" /> {isDownloading ? 'Preparando descarga…' : 'Descargar reporte completo'}
          </button>
        )}
      </div>

      <NarrativeStatusNotice result={result} />

      {!isLocalAnswer && (
        <>
          {narrativeAvailable ? (
            <section className="commercial-ai-executive-block commercial-ai-executive-block--recommendation">
              <h3>Qué probar</h3>
              <NarrativeEvidence response={response} />
            </section>
          ) : (
            <section className="commercial-ai-executive-block">
              <h3>Análisis calculado por Lanzo</h3>
              <p>{response.explanation || 'No hay explicación adicional disponible.'}</p>
              {narrative?.status === 'unavailable' && <NarrativeEvidence response={response} />}
            </section>
          )}

          <section className="commercial-ai-executive-block">
            <h3>Datos que respaldan esta respuesta</h3>
            {narrativeAvailable && response.explanation && (
              <p><strong>Análisis calculado por Lanzo:</strong> {response.explanation}</p>
            )}
            <h4>Hechos y resultados por intención</h4>
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

          <section className="commercial-ai-executive-block commercial-ai-executive-block--recommendation">
            <div className="commercial-ai-section__heading"><Lightbulb size={17} aria-hidden="true" /><h3>Otras recomendaciones calculadas por Lanzo</h3></div>
            <Recommendations recommendations={response.recommendations} />
          </section>
        </>
      )}

      {!isLocalAnswer && (
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
  sales_growth: 'Crecimiento de ventas',
  ticket_growth: 'Ticket promedio',
  product_opportunity: 'Oportunidad en productos actuales',
  assortment_analysis: 'Inteligencia de surtido',
  sales_trend: 'Tendencia de ventas',
  price_simulation: 'Simulación de precio',
  promotion_opportunity: 'Simulación de promoción',
  combo_opportunity: 'Oportunidad de combos',
  goal_simulation: 'Simulación de meta',
  what_if_analysis: 'Simulación what-if',
  commercial_strategy: 'Estrategia comercial',
  out_of_scope: 'Fuera del alcance',
  local_answer: 'Respuesta local',
  not_ready: 'Capacidad todavía no disponible'
});

const RESOLUTION_LABELS = Object.freeze({
  identity: 'Respuesta local sobre Lía',
  competition: 'Consulta sobre competencia',
  assortment: 'Consulta sobre nuevos productos y servicios',
  growth: 'Consulta sobre crecimiento de ventas',
  sales_growth: 'Crecimiento de ventas',
  ticket_growth: 'Ticket promedio',
  product_opportunity: 'Oportunidades en productos actuales',
  sales_trend: 'Tendencia de ventas',
  commercial_question: 'Consulta comercial por aclarar',
  price_simulation: 'Simulación de precio; faltan datos',
  greeting: 'Saludo',
  unrelated: 'Consulta fuera del alcance',
  module: 'Consulta de otro módulo'
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
  if (!intent && request.resolution?.topic) {
    details.push(RESOLUTION_LABELS[request.resolution.topic] || 'Respuesta local');
  }
  if (intent) details.push('Intención: ' + (INTENT_LABELS[intent] || 'Consulta comercial'));

  const previousFrom = formatHistoryDateOnly(period.previousFrom);
  const previousTo = formatHistoryDateOnly(period.previousTo);
  if (previousFrom || previousTo) details.push(`Comparación: ${previousFrom || '—'} a ${previousTo || '—'}`);
  else if (request.compare === true) details.push('Comparación: activada');

  if (scenario.productName) details.push(`Producto: ${scenario.productName}`);
  if (scenario.goalType) details.push(`Tipo de meta: ${GOAL_TYPE_LABELS[scenario.goalType] || scenario.goalType}`);
  if (Number.isFinite(scenario.targetValue)) details.push(`Objetivo: ${['gross_margin', 'product_margin'].includes(scenario.goalType) ? `${scenario.targetValue}%` : formatAnalysisValue.formatMoney(scenario.targetValue)}`);
  if (scenario.changeType) details.push(`Variable: ${{ sales: 'ventas', ticket: 'ticket promedio', product: 'producto' }[scenario.changeType] || scenario.changeType}`);
  if (Number.isFinite(scenario.changePercent)) details.push(`Cambio simulado: ${scenario.changePercent}%`);
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
      assortment: deterministic.assortment,
      contributors: deterministic.contributors,
      growthSignals: deterministic.growthSignals,
      productOpportunities: deterministic.productOpportunities,
      productRisks: deterministic.productRisks,
      priceSimulation: deterministic.priceSimulation,
      promotionSimulation: deterministic.promotionSimulation,
      comboOpportunities: deterministic.comboOpportunities,
      goalSimulation: deterministic.goalSimulation,
      whatIfSimulation: deterministic.whatIfSimulation,
      strategyRequested: deterministic.strategyRequested,
      strategyCandidates: deterministic.strategyCandidates,
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
    providerCalled: typeof report.result.providerCalled === 'boolean' ? report.result.providerCalled : null,
    quotaOutcome: report.result.quotaOutcome || 'not_confirmed',
    intentResolution: report.request?.resolution || null
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
  useLayoutEffect(() => {
    historyContextTokenRef.current = historyContextToken;
  }, [historyContextToken]);

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
    : (questionResolution.kind === 'needs_context' && ['goal_simulation', 'what_if_analysis'].includes(questionResolution.intent)
      ? questionResolution.intent
      : (!question.trim() ? 'profitability_summary' : null));
  const strategyRequested = intent === 'commercial_strategy'
    || (intent === 'goal_simulation' && isCommercialStrategyQuestion(question));
  const scenarioIntent = ['goal_simulation', 'what_if_analysis'].includes(intent);
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
    const inferred = inferCommercialScenarioFromQuestion(question);
    setScenario(inferred.intent === intent ? inferred.scenario : {});
    setProductSearch('');
    setPromotionMode('discountPercent');
    setCompare(intent === 'explain_change' || strategyRequested
      || ['sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend', 'assortment_analysis'].includes(intent));
  }, [intent, question, strategyRequested]);

  useEffect(() => {
    const loadsProducts = intent === 'price_simulation' || intent === 'promotion_opportunity'
      || (intent === 'goal_simulation' && scenario.goalType === 'product_margin')
      || (intent === 'what_if_analysis' && scenario.changeType === 'product');
    const includeUnknownCosts = intent === 'what_if_analysis' && scenario.changeType === 'product';
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
    loadSalesProfitabilityProducts({ period, includeUnknownCosts })
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
  }, [period, intent, scenario.goalType, scenario.changeType]);

  const selectIntent = (text) => {
    const inferred = inferCommercialScenarioFromQuestion(text);
    setScenario(inferred.scenario || {});
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
    const inferred = inferCommercialScenarioFromQuestion(nextQuestion);
    setScenario(inferred.scenario || {});
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
      const resolution = resolveCommercialIntent(question, { scenario });
      const resolvedIntent = resolution.kind === 'supported' ? resolution.intent : null;
      const normalizedScenario = resolution.kind === 'supported'
        ? normalizeScenarioForIntent(resolvedIntent, scenario)
        : {};
      const compareEnabled = resolution.kind === 'supported'
        && (['sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend', 'assortment_analysis'].includes(resolvedIntent)
          || (resolvedIntent === 'commercial_strategy' || (resolvedIntent === 'goal_simulation' && isCommercialStrategyQuestion(question)))
          || (resolvedIntent === 'explain_change' && compare === true));
      const previousPeriod = compareEnabled ? buildPreviousPeriod(period) : null;
      const requestContext = {
        question,
        resolvedIntent,
        resolution: {
          kind: resolution.kind,
          topic: resolution.topic || resolution.reason || null,
          confidence: resolution.confidence || 'high',
          missingContext: Array.isArray(resolution.missingContext) ? resolution.missingContext : []
        },
        compare: compareEnabled,
        period: resolution.kind === 'supported'
          ? {
            from: period.from,
            to: period.to,
            previousFrom: previousPeriod?.from || null,
            previousTo: previousPeriod?.to || null,
            timezone: businessTimezone
          }
          : {},
        scenario: normalizedScenario
      };

      if (resolution.kind !== 'supported') {
        const completedResult = {
          response: createCommercialLocalResponse(resolution),
          usageStatus: null,
          providerCalled: false,
          quotaOutcome: 'not_consumed',
          intentResolution: resolution,
          reportSource: 'local'
        };
        setResult(completedResult);
        setDownloadContext(null);
        if (resolution.kind !== 'identity') {
          void persistHistoryEntry({ completedResult, requestContext, queriedAt, contextToken: requestContextToken });
        }
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
          <div className="commercial-ai-card__topline"><span className="commercial-ai-card__icon" aria-hidden="true"><Globe2 size={22} /></span><span className="commercial-ai-status commercial-ai-status--muted">Próximamente</span></div>
          <h2>Ecommerce</h2><p>Analiza pedidos, catálogo y oportunidades de tu tienda en línea.</p>
          <div className="commercial-ai-card__availability"><ShieldCheck size={16} aria-hidden="true" /><span>Este agente aún no está disponible.</span></div>
        </article>
      </section>

      <section className="commercial-ai-workspace" aria-labelledby="sales-agent-title">
        <div className="commercial-ai-workspace__heading">
          <div><p className="commercial-ai-eyebrow">Agente activo</p><h2 id="sales-agent-title">Pregúntale a {LIA_IDENTITY.name} sobre tu negocio</h2><p className="commercial-ai-intro">{LIA_IDENTITY.capabilities}</p></div>
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

          {(questionResolution.kind === 'supported' || scenarioIntent || !question.trim()) && (
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
              {(['sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend', 'assortment_analysis'].includes(intent) || strategyRequested)
                && <p className="commercial-ai-comparison-note">Se incluirá el periodo anterior de duración equivalente cuando haya datos disponibles.</p>}
            </div>
          )}

          {scenarioIntent && (
            <div className="commercial-ai-scenario-panel">
              <p className="commercial-ai-label">Parámetros del escenario</p>
              <div className="commercial-ai-scenario-form">
                {intent === 'goal_simulation' ? (
                  <>
                    <label className="commercial-ai-label" htmlFor="sales-agent-goal-type">Tipo de meta
                      <span className="commercial-ai-select-wrap">
                        <select id="sales-agent-goal-type" name="goalType" value={scenario.goalType || ''} onChange={(event) => {
                          const goalType = event.target.value;
                          setScenario((current) => ({ ...current, goalType, ...(goalType === 'product_margin' ? {} : { productName: undefined }) }));
                        }}>
                          <option value="">Selecciona una meta</option>
                          <option value="revenue">Ventas netas</option>
                          <option value="gross_profit">Utilidad bruta</option>
                          <option value="average_ticket">Ticket promedio</option>
                          <option value="gross_margin">Margen bruto</option>
                          <option value="product_margin">Margen de un producto</option>
                        </select>
                        <ChevronDown size={15} aria-hidden="true" />
                      </span>
                    </label>
                    <label className="commercial-ai-label" htmlFor="sales-agent-goal-target">{['gross_margin', 'product_margin'].includes(scenario.goalType) ? 'Margen objetivo (%)' : 'Valor objetivo'}
                      <input id="sales-agent-goal-target" name="targetValue" type="number" min="0.01" max={['gross_margin', 'product_margin'].includes(scenario.goalType) ? '99.9' : undefined} step={['gross_margin', 'product_margin'].includes(scenario.goalType) ? '0.1' : '0.01'} placeholder="Obligatorio" value={scenario.targetValue ?? ''} onChange={handleScenarioChange} />
                    </label>
                    {scenario.goalType === 'product_margin' && (
                      <label className="commercial-ai-label" htmlFor="sales-agent-goal-product">Producto con costo conocido
                        <span className="commercial-ai-select-wrap">
                          <select id="sales-agent-goal-product" name="productName" value={scenario.productName || ''} onChange={handleScenarioChange} disabled={isLoadingProducts || productOptions.length === 0}>
                            <option value="">{isLoadingProducts ? 'Cargando productos…' : 'Selecciona un producto'}</option>
                            {scenario.productName && !productOptions.some((product) => product.name === scenario.productName) && <option value={scenario.productName}>{scenario.productName} · verificar historial</option>}
                            {filteredProductOptions.map((product) => <option key={product.name} value={product.name}>{product.name}</option>)}
                          </select>
                          <ChevronDown size={15} aria-hidden="true" />
                        </span>
                      </label>
                    )}
                  </>
                ) : (
                  <>
                    <label className="commercial-ai-label" htmlFor="sales-agent-what-if-type">Variable a modificar
                      <span className="commercial-ai-select-wrap">
                        <select id="sales-agent-what-if-type" name="changeType" value={scenario.changeType || ''} onChange={(event) => {
                          const changeType = event.target.value;
                          setScenario((current) => ({ ...current, changeType, ...(changeType === 'product' ? {} : { productName: undefined }) }));
                        }}>
                          <option value="">Selecciona una variable</option>
                          <option value="sales">Ventas netas</option>
                          <option value="ticket">Ticket promedio</option>
                          <option value="product">Producto</option>
                        </select>
                        <ChevronDown size={15} aria-hidden="true" />
                      </span>
                    </label>
                    <label className="commercial-ai-label" htmlFor="sales-agent-what-if-percent">Cambio porcentual
                      <input id="sales-agent-what-if-percent" name="changePercent" type="number" min="-99.9" max="500" step="0.1" placeholder="De -99.9% a 500%" value={scenario.changePercent ?? ''} onChange={handleScenarioChange} />
                    </label>
                    {scenario.changeType === 'product' && (
                      <label className="commercial-ai-label" htmlFor="sales-agent-what-if-product">Producto con ventas históricas
                        <span className="commercial-ai-select-wrap">
                          <select id="sales-agent-what-if-product" name="productName" value={scenario.productName || ''} onChange={handleScenarioChange} disabled={isLoadingProducts || productOptions.length === 0}>
                            <option value="">{isLoadingProducts ? 'Cargando productos…' : 'Selecciona un producto'}</option>
                            {scenario.productName && !productOptions.some((product) => product.name === scenario.productName) && <option value={scenario.productName}>{scenario.productName} · verificar historial</option>}
                            {filteredProductOptions.map((product) => <option key={product.name} value={product.name}>{product.name}</option>)}
                          </select>
                          <ChevronDown size={15} aria-hidden="true" />
                        </span>
                      </label>
                    )}
                  </>
                )}
              </div>
              {intent === 'goal_simulation' && <p className="commercial-ai-caution">Las metas describen una brecha matemática. El precio objetivo de producto requiere costo completo y no cambia el precio real.</p>}
              {intent === 'what_if_analysis' && <p className="commercial-ai-caution">El límite admite cambios de −99.9% a 500%. La simulación no predice la demanda.</p>}
              {scenario.goalType === 'product_margin' && productLoadError && <p className="commercial-ai-inline-error">{productLoadError}</p>}
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
            <p>Periodo: <b>{period.from} a {period.to}</b>{(intent === 'explain_change' && compare || strategyRequested || ['sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend', 'assortment_analysis'].includes(intent)) && ' · con comparación'}</p>
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
