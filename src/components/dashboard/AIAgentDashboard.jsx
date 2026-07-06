import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  BrainCircuit,
  Calendar,
  CheckCircle,
  DollarSign,
  History,
  Package,
  RefreshCw,
  Sparkles,
  Users,
  WifiOff,
  Wrench
} from 'lucide-react';
import { buildAgentPayload, DATE_RANGES, formatDateRangeLabel } from '../../utils/buildAgentPayload';
import { buildPrompt, validateAgentData } from '../../utils/aiPromptBuilder';
import { analyzeWithAI, AIApiError, validateAIConnection, getAIConfigStatus } from '../../services/aiService';
import {
  getLocalAIAnalysisDetail,
  getLocalAIAnalysisHistory,
  saveLocalAIAnalysis
} from '../../services/aiAnalysisLocalHistoryService';
import { getAvailableAgentTools, runAgentTools } from '../../agents/agentToolRegistry';
import { resolveAgentAction, executeAgentAction } from '../../agents/agentActionRouter';
import { useAgentPreview } from '../../hooks/dashboard/useAgentPreview';
import { normalizeBusinessTypes } from '../../utils/businessType';
import DataPreviewBanner from './DataPreviewBanner';
import AgentActionConfirmModal from './AgentActionConfirmModal';
import AIAgentHistoryPanel from './AIAgentHistoryPanel';
import StructuredAnalysisResult from './AIAgentStructuredResult';
import './AIAgentDashboard.css';
import './AIAgentStructuredResult.css';

const isBrowserOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

const AGENTS = [
  { id: 'inventoryAuditor', name: 'Auditor de Inventario', description: 'Analiza mermas, productos de baja rotación y alertas de stock', icon: Package, color: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' },
  { id: 'financialAnalyst', name: 'Analista Financiero', description: 'Analiza ticket promedio, horarios de mayor venta y métodos de pago', icon: DollarSign, color: '#10b981', gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' },
  { id: 'customerStrategist', name: 'Estratega de Clientes', description: 'Analiza recurrencia, deudores y ticket promedio por cliente', icon: Users, color: '#6366f1', gradient: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }
];

const DATE_RANGE_OPTIONS = [
  { id: DATE_RANGES.TODAY, label: 'Hoy' },
  { id: DATE_RANGES.LAST_7_DAYS, label: 'Últimos 7 días' },
  { id: DATE_RANGES.LAST_30_DAYS, label: 'Últimos 30 días' },
  { id: DATE_RANGES.THIS_MONTH, label: 'Este Mes' },
  { id: DATE_RANGES.LAST_MONTH, label: 'Mes Anterior' }
];

const AgentCard = ({ agent, isSelected, onSelect, disabled }) => {
  const Icon = agent.icon;
  return (
    <div
      className={`agent-card ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={() => !disabled && onSelect(agent.id)}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => !disabled && event.key === 'Enter' && onSelect(agent.id)}
      style={{ '--agent-color': agent.color, '--agent-gradient': agent.gradient }}
    >
      <div className="agent-card-header">
        <div className="agent-icon-wrapper" style={{ background: agent.gradient }}>
          <Icon size={24} color="white" />
        </div>
        {isSelected && <div className="selected-badge"><CheckCircle size={14} /></div>}
      </div>
      <div className="agent-card-body">
        <h4 className="agent-name">{agent.name}</h4>
        <p className="agent-description">{agent.description}</p>
      </div>
    </div>
  );
};

const DateRangeSelector = ({ selectedRange, onSelect, disabled }) => (
  <div className="date-range-selector">
    <label className="selector-label"><Calendar size={16} />Período de Análisis</label>
    <div className="selector-content">
      <select
        className="selector-trigger"
        value={selectedRange}
        onChange={(event) => onSelect(event.target.value)}
        disabled={disabled}
      >
        {DATE_RANGE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </div>
  </div>
);

const ToolPreview = ({ tools }) => {
  if (!tools?.length) return null;
  return (
    <div className="data-preview-banner">
      <div className="preview-header"><Wrench size={16} /><span>Herramientas internas disponibles:</span></div>
      <ul className="preview-metrics">
        {tools.slice(0, 6).map(tool => (
          <li key={tool.id}><span className="metric-label">{tool.id}</span><span className="metric-value">lista</span></li>
        ))}
      </ul>
    </div>
  );
};

export default function AIAgentDashboard({ sales = [], menu = [], customers = [], wasteLogs = [], businessType = [] }) {
  const navigate = useNavigate();
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedDateRange, setSelectedDateRange] = useState(DATE_RANGES.LAST_7_DAYS);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [lastToolRun, setLastToolRun] = useState(null);
  const [pendingGuidedAction, setPendingGuidedAction] = useState(null);
  const [savedAnalyses, setSavedAnalyses] = useState([]);
  const [selectedSavedAnalysis, setSelectedSavedAnalysis] = useState(null);
  const [historyMessage, setHistoryMessage] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState({ isOnline: isBrowserOnline(), isApiReady: false, isChecking: true, error: null, provider: null, model: null });

  const normalizedBusinessTypes = useMemo(() => normalizeBusinessTypes(businessType, 'abarrotes'), [businessType]);
  const activeAgent = useMemo(() => AGENTS.find(agent => agent.id === selectedAgent), [selectedAgent]);
  const availableTools = useMemo(() => selectedAgent ? getAvailableAgentTools({ agentType: selectedAgent, businessTypes: normalizedBusinessTypes }) : [], [selectedAgent, normalizedBusinessTypes]);
  const { preview, isCalculating: isPreviewLoading } = useAgentPreview(selectedAgent, selectedDateRange, sales, menu, wasteLogs, customers);

  const isDataEmpty = useMemo(() => {
    if (!selectedAgent) return true;
    if (selectedAgent === 'inventoryAuditor') return menu.length === 0;
    if (selectedAgent === 'financialAnalyst') return sales.length === 0;
    if (selectedAgent === 'customerStrategist') return customers.length === 0;
    return false;
  }, [selectedAgent, menu, sales, customers]);

  const loadLocalHistory = useCallback(async () => {
    setIsHistoryLoading(true);
    setHistoryError(null);
    try {
      const analyses = await getLocalAIAnalysisHistory({ agentType: selectedAgent || undefined, includeArchived: false, limit: 25 });
      setSavedAnalyses(analyses);
    } catch (error) {
      console.warn('No se pudo cargar el historial local de IA:', error);
      setHistoryError('No se pudo cargar el historial guardado en este dispositivo.');
    } finally {
      setIsHistoryLoading(false);
    }
  }, [selectedAgent]);

  const validateConnection = useCallback(async () => {
    setConnectionStatus(prev => ({ ...prev, isChecking: true }));
    const configStatus = getAIConfigStatus();
    if (!configStatus.hasKey) {
      setConnectionStatus({ isOnline: isBrowserOnline(), isApiReady: false, isChecking: false, error: `Falta API Key para ${configStatus.provider.toUpperCase()}`, provider: configStatus.provider, model: configStatus.model });
      return;
    }
    try {
      const result = await validateAIConnection({ timeoutMs: 5000 });
      setConnectionStatus({ isOnline: isBrowserOnline(), isApiReady: result.valid, isChecking: false, error: result.valid ? null : result.error, provider: result.provider, model: result.model });
    } catch (error) {
      setConnectionStatus({ isOnline: isBrowserOnline(), isApiReady: false, isChecking: false, error: `Error de API: ${error.message}`, provider: configStatus.provider, model: configStatus.model });
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => { setConnectionStatus(prev => ({ ...prev, isOnline: true })); validateConnection(); };
    const handleOffline = () => setConnectionStatus(prev => ({ ...prev, isOnline: false, isApiReady: false }));
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    validateConnection();
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [validateConnection]);

  useEffect(() => { loadLocalHistory(); }, [loadLocalHistory]);
  useEffect(() => {
    setAnalysisResult(null);
    setAnalysisError(null);
    setLastToolRun(null);
    setPendingGuidedAction(null);
  }, [selectedAgent, selectedDateRange]);

  const handleAnalyze = useCallback(async () => {
    if (!selectedAgent || !selectedDateRange) return;
    if (!connectionStatus.isOnline) { setAnalysisError('Sin conexión. Verifica tu conexión a internet para análisis con IA.'); return; }
    if (!connectionStatus.isApiReady) { setAnalysisError(`API no disponible: ${connectionStatus.error || 'Error de configuración'}`); return; }

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    setLastToolRun(null);
    setPendingGuidedAction(null);
    setSelectedSavedAnalysis(null);
    setHistoryMessage(null);
    setHistoryError(null);

    try {
      const aggregatedPayload = await buildAgentPayload(selectedAgent, selectedDateRange, { menu, wasteLogs, sales, customers });
      const validation = validateAgentData(selectedAgent, aggregatedPayload);
      if (!validation.valid) throw new Error(validation.reason);

      const agentToolRun = await runAgentTools({ agentType: selectedAgent, businessTypes: normalizedBusinessTypes, rawData: { menu, wasteLogs, sales, customers }, aggregatedPayload });
      setLastToolRun(agentToolRun);

      const { systemPrompt, userPrompt } = buildPrompt(
        selectedAgent,
        { ...aggregatedPayload, agentToolRun },
        { businessType: normalizedBusinessTypes.join(', '), totalCustomers: customers.length, dateRange: formatDateRangeLabel(selectedDateRange) }
      );
      const response = await analyzeWithAI(systemPrompt, userPrompt, { model: connectionStatus.model, provider: connectionStatus.provider, temperature: 0.2, maxTokens: 2048, timeoutMs: 60000 });
      setAnalysisResult(response);

      try {
        await saveLocalAIAnalysis({
          agentType: selectedAgent,
          agentName: activeAgent?.name || selectedAgent,
          dateRange: selectedDateRange,
          dateRangeLabel: formatDateRangeLabel(selectedDateRange),
          resultContent: response,
          businessTypes: normalizedBusinessTypes,
          toolRunSummary: {
            availableToolCount: agentToolRun?.availableToolCount || availableTools.length,
            executedToolCount: Array.isArray(agentToolRun?.results) ? agentToolRun.results.length : 0,
            toolIds: Array.isArray(agentToolRun?.results) ? agentToolRun.results.map(tool => tool.id).filter(Boolean) : []
          }
        });
        setHistoryMessage('Análisis guardado en este dispositivo.');
        await loadLocalHistory();
      } catch (historySaveError) {
        console.warn('El análisis IA se generó, pero no se pudo guardar localmente:', historySaveError);
        setHistoryError('El análisis se generó, pero no se pudo guardar en este dispositivo.');
      }
    } catch (error) {
      console.error('Error en análisis IA:', error);
      setAnalysisError(error instanceof AIApiError ? error.message : error.message || 'Error al generar análisis. Intenta nuevamente.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [activeAgent, availableTools.length, connectionStatus, customers, loadLocalHistory, menu, normalizedBusinessTypes, sales, selectedAgent, selectedDateRange, wasteLogs]);

  const handleOpenSavedAnalysis = useCallback(async (analysisId) => {
    setIsHistoryLoading(true);
    setHistoryError(null);
    setHistoryMessage(null);
    try {
      const analysis = await getLocalAIAnalysisDetail(analysisId);
      if (!analysis) { setHistoryError('No se encontró el análisis guardado en este dispositivo.'); return; }
      setSelectedSavedAnalysis(analysis);
      setAnalysisResult(null);
      setAnalysisError(null);
      setLastToolRun(null);
      setPendingGuidedAction(null);
    } catch (error) {
      console.warn('No se pudo abrir el análisis guardado:', error);
      setHistoryError('No se pudo abrir el análisis guardado.');
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  const handleOpenGuidedAction = useCallback((action) => setPendingGuidedAction(resolveAgentAction(action)), []);
  const handleConfirmGuidedAction = useCallback(() => {
    if (!pendingGuidedAction) return;
    const result = executeAgentAction(pendingGuidedAction, navigate);
    if (!result.success) { setAnalysisError(result.message || 'No se pudo ejecutar la acción guiada.'); return; }
    setPendingGuidedAction(null);
  }, [navigate, pendingGuidedAction]);

  const handleGenerateCurrentFromSaved = useCallback(() => {
    if (selectedSavedAnalysis?.agentType) setSelectedAgent(selectedSavedAnalysis.agentType);
    if (selectedSavedAnalysis?.dateRange) setSelectedDateRange(selectedSavedAnalysis.dateRange);
    setSelectedSavedAnalysis(null);
  }, [selectedSavedAnalysis]);

  const isButtonDisabled = isAnalyzing || !connectionStatus.isApiReady || isPreviewLoading || isDataEmpty;

  return (
    <div className="ai-agent-dashboard">
      <header className="ai-dashboard-header">
        <div className="header-content">
          <BrainCircuit size={28} className="header-icon" />
          <div className="header-text">
            <h2 className="header-title">Agentes de IA</h2>
            <p className="header-subtitle">Análisis inteligente con herramientas internas y acciones guiadas</p>
          </div>
        </div>
        <div className={`connection-indicator ${connectionStatus.isApiReady ? 'online' : connectionStatus.isOnline ? 'warning' : 'offline'}`}>
          {connectionStatus.isChecking ? <><RefreshCw size={16} className="spin-icon" /><span>Validando API...</span></> : connectionStatus.isApiReady ? <><div className="status-dot" /><span>{connectionStatus.model} ({connectionStatus.provider})</span></> : connectionStatus.isOnline ? <><AlertCircle size={16} /><span>API no disponible</span></> : <><WifiOff size={16} /><span>Sin conexión</span></>}
        </div>
      </header>

      <section className="agent-selection">
        <h3 className="section-heading"><Sparkles size={18} />Selecciona un Agente Especializado</h3>
        <div className="agents-grid">
          {AGENTS.map(agent => <AgentCard key={agent.id} agent={agent} isSelected={selectedAgent === agent.id} onSelect={setSelectedAgent} disabled={isAnalyzing || !connectionStatus.isApiReady || connectionStatus.isChecking} />)}
        </div>
      </section>

      {selectedAgent && <section className="date-selection"><DateRangeSelector selectedRange={selectedDateRange} onSelect={setSelectedDateRange} disabled={isAnalyzing || !connectionStatus.isApiReady || connectionStatus.isChecking} /></section>}
      {selectedAgent && selectedDateRange && <><DataPreviewBanner preview={preview} isCalculating={isPreviewLoading} isDataEmpty={isDataEmpty} /><ToolPreview tools={availableTools} /></>}

      {selectedAgent && selectedDateRange && (
        <section className="analyze-action">
          <button className="analyze-button" onClick={handleAnalyze} disabled={isButtonDisabled} type="button">
            {isAnalyzing ? <><RefreshCw size={20} className="spin-icon" /><span>Ejecutando herramientas y analizando...</span></> : !connectionStatus.isOnline ? <><WifiOff size={20} /><span>Sin Conexión</span></> : !connectionStatus.isApiReady ? <><AlertCircle size={20} /><span>API No Disponible</span></> : <><Sparkles size={20} /><span>Generar Análisis con IA</span></>}
          </button>
          {!connectionStatus.isOnline && <p className="offline-hint"><AlertCircle size={14} />Conéctate a internet para usar los agentes de IA</p>}
          {connectionStatus.isOnline && !connectionStatus.isApiReady && connectionStatus.error && <p className="offline-hint"><AlertCircle size={14} />{connectionStatus.error}</p>}
        </section>
      )}

      <AIAgentHistoryPanel analyses={savedAnalyses} isLoading={isHistoryLoading} message={historyMessage} error={historyError} selectedAgent={selectedAgent} onOpen={handleOpenSavedAnalysis} />

      {isAnalyzing && <section className="analysis-state"><div className="state-indicator"><div className="pulse-ring" /><BrainCircuit size={32} className="analyzing-icon" /></div><p className="state-text">Procesando herramientas internas y preparando acciones guiadas...</p></section>}
      {analysisError && <section className="analysis-error"><AlertCircle size={24} /><div className="error-content"><h4>Error en Análisis</h4><p>{analysisError}</p></div><button className="retry-button" onClick={handleAnalyze} disabled={isAnalyzing || !connectionStatus.isApiReady || connectionStatus.isChecking} type="button">Reintentar</button></section>}

      {selectedSavedAnalysis && !isAnalyzing && (
        <section className="ai-saved-analysis-detail">
          <div className="ai-saved-analysis-header">
            <div><span className="ai-saved-analysis-kicker"><History size={16} />Análisis guardado</span><h3>{selectedSavedAnalysis.agentName || 'Agente IA'}</h3><p className="ai-saved-analysis-meta">Generado el: {selectedSavedAnalysis.generatedAtLabel}{selectedSavedAnalysis.dateRangeLabel ? ` • ${selectedSavedAnalysis.dateRangeLabel}` : ''}</p></div>
            <button className="ai-history-secondary-button" type="button" onClick={() => setSelectedSavedAnalysis(null)}>Volver al historial</button>
          </div>
          <div className="ai-saved-analysis-notice">Este análisis corresponde a los datos disponibles cuando fue generado. Consultarlo no consume una nueva consulta IA. Este análisis está guardado automáticamente en este dispositivo.</div>
          <div className="ai-saved-analysis-actions">
            <button className="ai-history-primary-button" type="button" onClick={handleGenerateCurrentFromSaved}><Sparkles size={16} />Generar nuevo análisis con datos actuales</button>
          </div>
          <StructuredAnalysisResult result={selectedSavedAnalysis.resultContent} onAction={handleOpenGuidedAction} />
        </section>
      )}

      {analysisResult && !isAnalyzing && !selectedSavedAnalysis && (
        <section className="analysis-result-container">
          <div className="result-header"><div className="result-agent" style={{ '--agent-color': activeAgent?.color }}>{activeAgent && <activeAgent.icon size={20} />}<span>{activeAgent?.name}</span></div><span className="result-range">{formatDateRangeLabel(selectedDateRange)}{lastToolRun?.availableToolCount ? ` • ${lastToolRun.availableToolCount} tools` : ''}</span></div>
          <StructuredAnalysisResult result={analysisResult} onAction={handleOpenGuidedAction} />
        </section>
      )}

      {!selectedAgent && !analysisResult && !isAnalyzing && !selectedSavedAnalysis && <section className="empty-state"><Activity size={48} className="empty-icon" /><h3>Selecciona un agente para comenzar</h3><p>Cada agente se especializa en un área del negocio y usa herramientas internas antes de consultar la IA.</p></section>}
      <AgentActionConfirmModal isOpen={Boolean(pendingGuidedAction)} action={pendingGuidedAction} onClose={() => setPendingGuidedAction(null)} onConfirm={handleConfirmGuidedAction} />
    </div>
  );
}
