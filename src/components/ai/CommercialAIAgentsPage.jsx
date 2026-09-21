import {
  AlertTriangle,
  BarChart3,
  Calculator,
  ChevronDown,
  DatabaseZap,
  Globe2,
  Lightbulb,
  Send,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { runSalesProfitabilityAgent } from '../../services/ai/salesProfitabilityAgentService';
import {
  buildPeriodRange,
  formatAnalysisValue,
  inferSalesProfitabilityIntent
} from '../../services/ai/salesProfitabilityAnalytics';
import './CommercialAIAgentsPage.css';

const SUGGESTED_QUESTIONS = [
  { label: 'Explica el cambio de mi margen', intent: 'explain_change' },
  { label: 'Detecta mis productos problemáticos', intent: 'product_risk' },
  { label: 'Simula aumentar precios', intent: 'price_simulation' },
  { label: 'Encuentra oportunidades de combos', intent: 'combo_opportunity' },
  { label: 'Simula una promoción', intent: 'promotion_opportunity' }
];

const PERIOD_OPTIONS = [
  { value: 7, label: 'Últimos 7 días' },
  { value: 30, label: 'Últimos 30 días' },
  { value: 90, label: 'Últimos 90 días' },
  { value: 365, label: 'Últimos 12 meses' }
];

const EMPTY_ARRAY = Object.freeze([]);
const formatValue = (calculation) => calculation?.formattedValue || formatAnalysisValue.formatMoney(calculation?.value);

function Section({ title, icon: Icon, children, tone = '' }) {
  return (
    <section className={`commercial-ai-section ${tone ? `commercial-ai-section--${tone}` : ''}`}>
      <div className="commercial-ai-section__heading"><Icon size={17} aria-hidden="true" /><h3>{title}</h3></div>
      {children}
    </section>
  );
}

function CalculationList({ calculations = EMPTY_ARRAY }) {
  if (!calculations.length) return <p className="commercial-ai-muted">No hay cálculos disponibles.</p>;
  return (
    <div className="commercial-ai-calculations">
      {calculations.map((calculation) => (
        <div className="commercial-ai-calculation" key={`${calculation.label}-${calculation.formula}-${calculation.period?.from || 'period'}`}>
          <div><strong>{calculation.label}</strong><span>{calculation.formula}</span></div>
          <b>{formatValue(calculation)}</b>
        </div>
      ))}
    </div>
  );
}

function ProductEvidence({ products = EMPTY_ARRAY }) {
  if (!products.length) return <p className="commercial-ai-muted">No hay productos con evidencia suficiente.</p>;
  return (
    <div className="commercial-ai-table-wrap">
      <table className="commercial-ai-table">
        <caption className="sr-only">Productos involucrados en el análisis</caption>
        <thead><tr><th>Producto</th><th>Unidades</th><th>Ventas</th><th>Margen</th></tr></thead>
        <tbody>{products.map((product) => (
          <tr key={product.name}><th scope="row">{product.name}</th><td>{formatAnalysisValue.formatNumber(product.quantity, 0)}</td><td>{formatAnalysisValue.formatMoney(product.netSales)}</td><td>{formatAnalysisValue.formatPercent(product.margin)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function AnalysisResult({ result }) {
  const response = result?.response || {};
  const facts = Array.isArray(response.facts) ? response.facts : EMPTY_ARRAY;
  const products = response.current?.products || facts.filter((fact) => fact && fact.label && fact.quantity !== undefined);
  const recommendations = Array.isArray(response.recommendations) ? response.recommendations : EMPTY_ARRAY;
  const scenarios = Array.isArray(response.scenarios) ? response.scenarios : EMPTY_ARRAY;

  return (
    <div className="commercial-ai-result" aria-live="polite">
      <div className="commercial-ai-result__header">
        <div><p className="commercial-ai-eyebrow">Resultado estructurado</p><h2>{response.executiveSummary || response.answer}</h2></div>
        <span className={`commercial-ai-confidence commercial-ai-confidence--${response.confidence || 'low'}`}>Confianza {response.confidence || 'low'}</span>
      </div>
      {response.explanation && <p className="commercial-ai-result__explanation">{response.explanation}</p>}
      <div className="commercial-ai-result__meta">
        <span>Fuente: {response.source || 'mixed'}</span><span>Ventas válidas: {response.coverage?.validSales ?? '—'}</span><span>Cobertura de costos: {formatAnalysisValue.formatPercent(response.coverage?.costCoverage)}</span>
        {result.usageStatus && <span>Uso: {result.usageStatus.used} / {result.usageStatus.limit}</span>}
      </div>
      <div className="commercial-ai-result__grid">
        <Section title="Datos utilizados" icon={DatabaseZap}><ProductEvidence products={products.slice(0, 12)} /></Section>
        <Section title="Cálculos determinísticos" icon={Calculator}><CalculationList calculations={response.calculations} /></Section>
      </div>
      {scenarios.length > 0 && <Section title="Escenarios simulados" icon={BarChart3} tone="violet"><div className="commercial-ai-scenario-grid">{scenarios.slice(0, 8).map((scenario) => (
        <article className="commercial-ai-scenario" key={`${scenario.label || scenario.products?.join('-') || 'scenario'}-${scenario.volume ?? 'volume'}`}><strong>{scenario.label || scenario.products?.join(' + ') || 'Escenario'}</strong>{scenario.volume !== undefined && <span>Volumen: {formatAnalysisValue.formatNumber(scenario.volume, 1)}</span>}{scenario.utility !== undefined && <span>Utilidad: {formatAnalysisValue.formatMoney(scenario.utility)}</span>}{scenario.margin !== undefined && <span>Margen: {formatAnalysisValue.formatPercent(scenario.margin)}</span>}{scenario.note && <small>{scenario.note}</small>}</article>
      ))}</div></Section>}
      <div className="commercial-ai-result__grid">
        <Section title="Supuestos y limitaciones" icon={AlertTriangle} tone="amber"><ul className="commercial-ai-list">{(response.assumptions || EMPTY_ARRAY).map((item) => <li key={`a-${item}`}>{item}</li>)}{(response.limitations || EMPTY_ARRAY).map((item) => <li key={`l-${item}`}><b>Limitación:</b> {item}</li>)}</ul></Section>
        <Section title="Recomendación" icon={Lightbulb} tone="green">{recommendations.length ? recommendations.map((recommendation) => <article className="commercial-ai-recommendation" key={`${recommendation.title}-${recommendation.effort || 'effort'}`}><strong>{recommendation.title}</strong><p>{recommendation.explanation}</p><span>Impacto esperado: {recommendation.expectedImpact}</span><small>Requiere confirmación manual · Esfuerzo: {recommendation.effort}</small></article>) : <p className="commercial-ai-muted">No hay recomendación confiable con esta cobertura.</p>}</Section>
      </div>
    </div>
  );
}

export default function CommercialAIAgentsPage() {
  const [question, setQuestion] = useState('');
  const [intent, setIntent] = useState('explain_change');
  const [periodDays, setPeriodDays] = useState(30);
  const [compare, setCompare] = useState(true);
  const [scenario, setScenario] = useState({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [result, setResult] = useState(null);
  const period = useMemo(() => buildPeriodRange({ days: periodDays }), [periodDays]);
  const productOptions = result?.response?.current?.products || EMPTY_ARRAY;

  const selectIntent = (nextIntent, text) => { setIntent(nextIntent); setQuestion(text); setAnalysisError(null); };
  const handleScenarioChange = (event) => { const { name, value } = event.target; setScenario((current) => ({ ...current, [name]: value === '' ? undefined : value })); };
  const handleAnalyze = async (event) => {
    event.preventDefault();
    if (!question.trim() || isAnalyzing) return;
    setIsAnalyzing(true); setAnalysisError(null); setResult(null);
    try {
      const requestKey = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${question}`;
      const response = await runSalesProfitabilityAgent({ question, intent: intent || inferSalesProfitabilityIntent(question), period, compare, scenario, requestKey });
      setResult(response);
    } catch (error) { setAnalysisError(error?.message || 'No se pudo completar el análisis.'); }
    finally { setIsAnalyzing(false); }
  };

  return (
    <main className="commercial-ai-page" aria-labelledby="commercial-ai-title">
      <header className="commercial-ai-hero"><div className="commercial-ai-hero__icon" aria-hidden="true"><Sparkles size={24} /></div><div><p className="commercial-ai-eyebrow">Centro de agentes IA</p><h1 id="commercial-ai-title">Agentes IA comerciales</h1><p className="commercial-ai-intro">Ventas y rentabilidad combina reportes autorizados con cálculos reproducibles para ayudarte a decidir.</p></div></header>
      <section className="commercial-ai-card-grid" aria-label="Agentes IA comerciales disponibles">
        <article className="commercial-ai-card commercial-ai-card--violet commercial-ai-card--active"><div className="commercial-ai-card__topline"><span className="commercial-ai-card__icon" aria-hidden="true"><BarChart3 size={22} /></span><span className="commercial-ai-status">Disponible</span></div><h2>Ventas y rentabilidad</h2><p>Explica cambios de margen, detecta productos problemáticos y simula precios, combos y promociones.</p><div className="commercial-ai-card__availability"><ShieldCheck size={16} aria-hidden="true" /><span>Solo lectura: no modifica precios, productos ni datos financieros.</span></div></article>
        <article className="commercial-ai-card commercial-ai-card--blue commercial-ai-card--disabled" aria-disabled="true"><div className="commercial-ai-card__topline"><span className="commercial-ai-card__icon" aria-hidden="true"><Globe2 size={22} /></span><span className="commercial-ai-status commercial-ai-status--muted">FEATURE_NOT_READY</span></div><h2>Ecommerce</h2><p>Analiza pedidos, catálogo, productos online y oportunidades para mejorar tu tienda.</p><div className="commercial-ai-card__availability"><ShieldCheck size={16} aria-hidden="true" /><span>Disponible en la siguiente fase.</span></div></article>
      </section>
      <section className="commercial-ai-workspace" aria-labelledby="sales-agent-title">
        <div className="commercial-ai-workspace__heading"><div><p className="commercial-ai-eyebrow">Agente activo</p><h2 id="sales-agent-title">Pregunta sobre tu negocio</h2></div><span className="commercial-ai-readonly"><ShieldCheck size={15} /> Solo lectura y simulación</span></div>
        <form onSubmit={handleAnalyze}>
          <label className="commercial-ai-label" htmlFor="sales-agent-question">Pregunta libre</label>
          <textarea id="sales-agent-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ej. ¿Por qué bajó mi margen este periodo?" rows={3} maxLength={1200} />
          <div className="commercial-ai-suggestions" aria-label="Preguntas sugeridas">{SUGGESTED_QUESTIONS.map((suggestion) => <button type="button" className={`commercial-ai-suggestion ${intent === suggestion.intent ? 'is-selected' : ''}`} key={suggestion.intent} onClick={() => selectIntent(suggestion.intent, suggestion.label)}>{suggestion.label}</button>)}</div>
          <div className="commercial-ai-filters">
            <label className="commercial-ai-label" htmlFor="sales-agent-period">Periodo<span className="commercial-ai-select-wrap"><select id="sales-agent-period" value={periodDays} onChange={(event) => setPeriodDays(Number(event.target.value))}>{PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></span></label>
            <label className="commercial-ai-checkbox"><input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} /> Comparar con el periodo anterior</label>
            <label className="commercial-ai-label" htmlFor="sales-agent-intent">Intención<span className="commercial-ai-select-wrap"><select id="sales-agent-intent" value={intent} onChange={(event) => setIntent(event.target.value)}>{SUGGESTED_QUESTIONS.map((option) => <option key={option.intent} value={option.intent}>{option.label}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></span></label>
          </div>
          {(intent === 'price_simulation' || intent === 'promotion_opportunity') && <div className="commercial-ai-scenario-form"><label className="commercial-ai-label" htmlFor="sales-agent-product">Producto<span className="commercial-ai-select-wrap"><select id="sales-agent-product" name="productName" value={scenario.productName || ''} onChange={handleScenarioChange}><option value="">Usar el producto principal del periodo</option>{productOptions.map((product) => <option key={product.name} value={product.name}>{product.name}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></span></label><label className="commercial-ai-label">Precio nuevo<input name={intent === 'price_simulation' ? 'newPrice' : 'promotionalPrice'} type="number" min="0" step="0.01" placeholder="Opcional" value={scenario[intent === 'price_simulation' ? 'newPrice' : 'promotionalPrice'] || ''} onChange={handleScenarioChange} /></label>{intent === 'promotion_opportunity' && <label className="commercial-ai-label">Descuento %<input name="discountPercent" type="number" min="0" max="100" step="0.1" placeholder="Opcional" value={scenario.discountPercent || ''} onChange={handleScenarioChange} /></label>}<label className="commercial-ai-label">Volumen esperado<input name="historicalVolume" type="number" min="0" step="1" placeholder="Volumen histórico" value={scenario.historicalVolume || ''} onChange={handleScenarioChange} /></label></div>}
          <div className="commercial-ai-submit-row"><p>Periodo: <b>{period.from} a {period.to}</b>{compare && ' · comparación comparable'}</p><button className="commercial-ai-analyze" type="submit" disabled={!question.trim() || isAnalyzing}><Send size={16} aria-hidden="true" /> {isAnalyzing ? 'Analizando…' : 'Analizar'}</button></div>
        </form>
        {isAnalyzing && <div className="commercial-ai-loading" role="status"><span className="commercial-ai-spinner" /> Consultando reportes autorizados y preparando cálculos…</div>}
        {analysisError && <div className="commercial-ai-error" role="alert"><AlertTriangle size={18} /> {analysisError}</div>}
        {result && <AnalysisResult result={result} />}
      </section>
      <aside className="commercial-ai-notice" role="note"><ShieldCheck size={18} aria-hidden="true" /><p>La IA explica evidencia calculada por código. Las recomendaciones requieren confirmación y no ejecutan acciones.</p></aside>
    </main>
  );
}
