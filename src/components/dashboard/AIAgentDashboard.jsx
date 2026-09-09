import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
  WifiOff
} from 'lucide-react';
import { buildAgentPayload, DATE_RANGES, formatDateRangeLabel } from '../../utils/buildAgentPayload';
import { buildPrompt, validateAgentData } from '../../utils/aiPromptBuilder';
import { classifyParsedAgentResponse, parseAgentResponse } from '../../utils/parseAgentResponse';
import { analyzeWithAI, AIApiError, validateAIConnection, getAIConfigStatus } from '../../services/aiService';
import { assertCurrentAIAgentActor, hasCurrentActorAIAgentPermission } from '../../services/auth/aiAgentAuthorization';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import {
  getLocalAIAnalysisDetail,
  getLocalAIAnalysisHistory,
  saveLocalAIAnalysis
} from '../../services/aiAnalysisLocalHistoryService';
import { getAvailableAgentTools, runAgentTools } from '../../agents/agentToolRegistry';
import { resolveAgentAction, executeAgentAction } from '../../agents/agentActionRouter';
import { useAgentPreview } from '../../hooks/dashboard/useAgentPreview';
import { normalizeBusinessTypes } from '../../utils/businessType';
import { readAIReportUiState, writeAIReportUiState } from '../../utils/aiReportUiState';
import DataPreviewBanner from './DataPreviewBanner';
import AgentActionConfirmModal from './AgentActionConfirmModal';
import AIAgentHistoryPanel from './AIAgentHistoryPanel';
import AIAgentUsageLegend from './AIAgentUsageLegend';
import StructuredAnalysisResult from './AIAgentStructuredResult';
import './AIAgentDashboard.css';
import './AIAgentStructuredResult.css';

const isBrowserOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

const AGENTS = [
  { id: 'inventoryAuditor', name: 'Auditor de inventario', description: 'Mermas, baja rotacion y alertas de stock.', icon: Package, color: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' },
  { id: 'financialAnalyst', name: 'Analista financiero', description: 'Ticket promedio, horarios fuertes y metodos de pago.', icon: DollarSign, color: '#10b981', gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' },
  { id: 'customerStrategist', name: 'Estratega de clientes', description: 'Recurrencia, deudores y ticket promedio por cliente.', icon: Users, color: '#6366f1', gradient: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }
];

const DATE_RANGE_OPTIONS = [
  { id: DATE_RANGES.TODAY, label: 'Hoy' },
  { id: DATE_RANGES.LAST_7_DAYS, label: 'Ultimos 7 dias' },
  { id: DATE_RANGES.LAST_30_DAYS, label: 'Ultimos 30 dias' },
  { id: DATE_RANGES.THIS_MONTH, label: 'Este mes' },
  { id: DATE_RANGES.LAST_MONTH, label: 'Mes anterior' }
];

const EMPTY_ARRAY = [];

const AgentOption = ({ agent, isSelected, onSelect, disabled }) => {
  const Icon = agent.icon;

  return (
    <button
      className={`ai-agent-option ${isSelected ? 'is-selected' : ''}`}
      onClick={() => !disabled && onSelect(agent.id)}
      disabled={disabled}
      type="button"
      style={{ '--agent-color': agent.color, '--agent-gradient': agent.gradient }}
    >
      <span className="ai-agent-option-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="ai-agent-option-copy">
        <span className="ai-agent-option-name">{agent.name}</span>
        <span className="ai-agent-option-description">{agent.description}</span>
      </span>
      {isSelected && <CheckCircle size={16} className="ai-agent-option-check" />}
    </button>
  );
};

const DateRangeSelector = ({ selectedRange, onSelect, disabled }) => (
  <label className="ai-agent-date-selector">
    <span className="ai-agent-date-label">
      <Calendar size={14} />
      Periodo
    </span>
    <span className="ai-agent-date-field">
      <select
        className="ai-agent-date-select"
        value={selectedRange}
        onChange={(event) => onSelect(event.target.value)}
        disabled={disabled}
      >
        {DATE_RANGE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </span>
  </label>
);

export default function AIAgentDashboard({ sales = EMPTY_ARRAY, menu = EMPTY_ARRAY, customers = EMPTY_ARRAY, wasteLogs = EMPTY_ARRAY, businessType = EMPTY_ARRAY }) {
  const navigate = useNavigate();
  const [selectedAgent, setSelectedAgent] = useState(() => readAIReportUiState().selectedAgent);
  const [selectedDateRange, setSelectedDateRange] = useState(() => readAIReportUiState().selectedDateRange || DATE_RANGES.LAST_7_DAYS);
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
  const analysisInFlightRef = useRef(false);
  const analysisRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const isMountedRef = useRef(false);
  const shouldRestoreSavedReportRef = useRef(true);
  const persistedReportIdRef = useRef(readAIReportUiState().selectedReportId);
  const actorSnapshot = useActorRuntimeSnapshot();
  const currentActorCanUseAIAgents = hasCurrentActorAIAgentPermission(actorSnapshot);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      analysisRequestRef.current += 1;
      historyRequestRef.current += 1;
    };
  }, []);

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
    const requestId = ++historyRequestRef.current;
    setIsHistoryLoading(true);
    setHistoryError(null);
    try {
      const analyses = await getLocalAIAnalysisHistory({ agentType: selectedAgent || undefined, includeArchived: false, limit: 25 });
      if (!isMountedRef.current || requestId !== historyRequestRef.current) return;
      setSavedAnalyses(analyses);

      if (shouldRestoreSavedReportRef.current) {
        shouldRestoreSavedReportRef.current = false;
        const savedReport = persistedReportIdRef.current
          ? analyses.find(analysis => analysis.id === persistedReportIdRef.current)
          : null;

        if (savedReport) {
          setSelectedSavedAnalysis(savedReport);
          setAnalysisResult(null);
          setAnalysisError(null);
          if (!selectedAgent && savedReport.agentType) setSelectedAgent(savedReport.agentType);
        } else if (persistedReportIdRef.current) {
          persistedReportIdRef.current = null;
          writeAIReportUiState({ selectedReportId: null });
        }
      }
    } catch (error) {
      if (!isMountedRef.current || requestId !== historyRequestRef.current) return;
      console.warn('No se pudo cargar el historial local de IA:', error);
      setHistoryError('No se pudo cargar el historial guardado en este dispositivo.');
    } finally {
      if (isMountedRef.current && requestId === historyRequestRef.current) setIsHistoryLoading(false);
    }
  }, [selectedAgent]);

  const validateConnection = useCallback(async () => {
    setConnectionStatus(prev => ({ ...prev, isChecking: true }));
    if (!currentActorCanUseAIAgents) {
      setConnectionStatus({
        isOnline: isBrowserOnline(),
        isApiReady: false,
        isChecking: false,
        error: 'El usuario actual no tiene permiso para usar agentes de IA.',
        provider: null,
        model: null
      });
      return;
    }
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
  }, [currentActorCanUseAIAgents]);

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
  const resetTransientAnalysis = useCallback(() => {
    setAnalysisResult(null);
    setAnalysisError(null);
    setLastToolRun(null);
    setPendingGuidedAction(null);
  }, []);

  const handleSelectAgent = useCallback((agentId) => {
    if (analysisInFlightRef.current) {
      analysisRequestRef.current += 1;
      analysisInFlightRef.current = false;
    }
    setSelectedAgent(agentId);
    writeAIReportUiState({ selectedAgent: agentId, selectedReportId: null });
    persistedReportIdRef.current = null;
    resetTransientAnalysis();
  }, [resetTransientAnalysis]);

  const handleSelectDateRange = useCallback((dateRange) => {
    if (analysisInFlightRef.current) {
      analysisRequestRef.current += 1;
      analysisInFlightRef.current = false;
    }
    setSelectedDateRange(dateRange);
    writeAIReportUiState({ selectedDateRange: dateRange, selectedReportId: null });
    persistedReportIdRef.current = null;
    resetTransientAnalysis();
  }, [resetTransientAnalysis]);

  const handleAnalyze = useCallback(async () => {
    if (analysisInFlightRef.current) return;
    if (!selectedAgent || !selectedDateRange) return;
    if (!currentActorCanUseAIAgents) {
      setAnalysisError('El usuario actual no tiene permiso para usar agentes de IA.');
      return;
    }
    if (!connectionStatus.isOnline) { setAnalysisError('Sin conexion. Verifica tu conexion a internet para analisis con IA.'); return; }
    if (!connectionStatus.isApiReady) { setAnalysisError(`API no disponible: ${connectionStatus.error || 'Error de configuracion'}`); return; }

    analysisInFlightRef.current = true;
    const requestId = ++analysisRequestRef.current;
    setIsAnalyzing(true);
    setAnalysisError(null);
    setPendingGuidedAction(null);
    setSelectedSavedAnalysis(null);
    persistedReportIdRef.current = null;
    writeAIReportUiState({ selectedReportId: null });
    setHistoryMessage(null);
    setHistoryError(null);

    let analysisContext = null;

    try {
      const aggregatedPayload = await buildAgentPayload(selectedAgent, selectedDateRange, { menu, wasteLogs, sales, customers });
      assertCurrentAIAgentActor();
      const validation = validateAgentData(selectedAgent, aggregatedPayload);
      if (!validation.valid) throw new Error(validation.reason);

      const agentToolRun = await runAgentTools({ agentType: selectedAgent, businessTypes: normalizedBusinessTypes, rawData: { menu, wasteLogs, sales, customers }, aggregatedPayload });
      analysisContext = { aggregatedPayload, agentToolRun };
      if (isMountedRef.current && requestId === analysisRequestRef.current) setLastToolRun(agentToolRun);

      const { systemPrompt, userPrompt } = buildPrompt(
        selectedAgent,
        aggregatedPayload,
        { businessType: normalizedBusinessTypes.join(', '), totalCustomers: customers.length, dateRange: selectedDateRange },
        agentToolRun
      );
      const response = await analyzeWithAI(systemPrompt, userPrompt, { model: connectionStatus.model, provider: connectionStatus.provider, temperature: 0.2, maxTokens: 2048, timeoutMs: 60000 });
      const generatedAt = new Date().toISOString();
      const rawResultContent = response.rawResultContent || response.content || '';
      const parsedResult = parseAgentResponse(rawResultContent, { finishReason: response.providerMetadata?.finish_reason });
      const classification = classifyParsedAgentResponse({
        parsedResult,
        providerStatus: response.providerHttpStatus ?? response.httpStatus ?? response.providerMetadata?.provider_response_status ?? 200,
        providerError: Boolean(response.transportError || response.timedOut || Number(response.errorMetadata?.status) >= 400)
      });
      const isIncomplete = classification.reportStatus === 'incomplete';
      const normalizedResult = {
        ...response,
        generatedAt,
        rawResultContent,
        parsedResult,
        agentToolRun,
        coverage: aggregatedPayload.coverage || parsedResult.coverage,
        ...classification,
        status: classification.reportStatus,
        incomplete: isIncomplete
      };
      if (isMountedRef.current && requestId === analysisRequestRef.current) setAnalysisResult(normalizedResult);

      try {
        const savedRecord = await saveLocalAIAnalysis({
          agentType: selectedAgent,
          agentName: activeAgent?.name || selectedAgent,
          dateRange: selectedDateRange,
          dateRangeLabel: formatDateRangeLabel(selectedDateRange),
          rawResultContent,
          parsedResult,
          resultFormat: parsedResult.resultFormat,
          coverage: aggregatedPayload.coverage || parsedResult.coverage,
          usage: response.usage,
          providerMetadata: response.providerMetadata,
          status: normalizedResult.status,
          providerStatus: normalizedResult.providerStatus,
          providerHttpStatus: normalizedResult.providerHttpStatus,
          parseStatus: normalizedResult.parseStatus,
          reportStatus: normalizedResult.reportStatus,
          coverageStatus: normalizedResult.coverageStatus,
          errorMetadata: response.errorMetadata,
          factSnapshot: aggregatedPayload,
          agentToolRun,
          businessTypes: normalizedBusinessTypes,
          toolRunSummary: {
            availableToolCount: agentToolRun?.availableToolCount || availableTools.length,
            executedToolCount: Array.isArray(agentToolRun?.results) ? agentToolRun.results.length : 0,
            toolIds: Array.isArray(agentToolRun?.results) ? agentToolRun.results.flatMap(tool => tool.id ? [tool.id] : []) : []
          }
        });
        if (isMountedRef.current && requestId === analysisRequestRef.current) {
          if (savedRecord?.id) {
            persistedReportIdRef.current = savedRecord.id;
            writeAIReportUiState({ selectedReportId: savedRecord.id });
          }
          setHistoryMessage(savedRecord.persistence === 'fallback'
            ? 'Analisis guardado en almacenamiento de recuperación local.'
            : 'Analisis guardado en este dispositivo.');
        }
        if (isMountedRef.current && requestId === analysisRequestRef.current) await loadLocalHistory();
      } catch (historySaveError) {
        console.warn('El analisis IA se genero, pero no se pudo guardar localmente:', historySaveError);
        if (isMountedRef.current && requestId === analysisRequestRef.current) setHistoryError('El analisis se genero, pero no se pudo guardar en este dispositivo.');
      }
    } catch (error) {
      if (error instanceof AIApiError && analysisContext) {
        const failurePayload = error.originalError && typeof error.originalError === 'object' ? error.originalError : {};
        const rawResultContent = typeof failurePayload.rawResultContent === 'string' ? failurePayload.rawResultContent : '';
        const parsedResult = rawResultContent
          ? parseAgentResponse(rawResultContent, { finishReason: failurePayload.providerMetadata?.finish_reason })
          : null;
        const failureRecord = {
          generatedAt: new Date().toISOString(),
          rawResultContent,
          parsedResult,
          resultFormat: parsedResult?.resultFormat || 'raw',
          coverage: analysisContext.aggregatedPayload.coverage || parsedResult?.coverage || null,
          usage: failurePayload.usage || null,
          providerMetadata: failurePayload.providerMetadata || null,
          status: 'failed',
          providerStatus: 'failed',
          providerHttpStatus: error.statusCode || null,
          parseStatus: parsedResult?.parseStatus || 'failed',
          reportStatus: 'failed',
          coverageStatus: parsedResult?.coverageStatus || 'unknown',
          errorMetadata: failurePayload.errorMetadata || { code: error.code || 'AI_ANALYSIS_FAILED', status: error.statusCode || null },
          factSnapshot: analysisContext.aggregatedPayload,
          agentToolRun: analysisContext.agentToolRun
        };

        try {
          await saveLocalAIAnalysis({
            agentType: selectedAgent,
            agentName: activeAgent?.name || selectedAgent,
            dateRange: selectedDateRange,
            dateRangeLabel: formatDateRangeLabel(selectedDateRange),
            ...failureRecord,
            businessTypes: normalizedBusinessTypes,
            toolRunSummary: {
              availableToolCount: analysisContext.agentToolRun?.availableToolCount || availableTools.length,
              executedToolCount: Array.isArray(analysisContext.agentToolRun?.results) ? analysisContext.agentToolRun.results.length : 0,
              toolIds: Array.isArray(analysisContext.agentToolRun?.results) ? analysisContext.agentToolRun.results.flatMap(tool => tool.id ? [tool.id] : []) : []
            }
          });
          setHistoryMessage('El intento fallido también quedó registrado localmente con su uso disponible.');
          if (isMountedRef.current && requestId === analysisRequestRef.current) await loadLocalHistory();
        } catch (historySaveError) {
          console.warn('No se pudo conservar el intento fallido de IA:', historySaveError);
        }

        if (isMountedRef.current && requestId === analysisRequestRef.current) {
          setAnalysisResult({
            ...failureRecord,
            content: rawResultContent,
            incomplete: true
          });
        }
      }
      if (isMountedRef.current && requestId === analysisRequestRef.current) {
        console.error('Error en analisis IA:', error);
        setAnalysisError(error instanceof AIApiError ? error.message : error.message || 'Error al generar analisis. Intenta nuevamente.');
      }
    } finally {
      if (requestId === analysisRequestRef.current) {
        analysisInFlightRef.current = false;
        if (isMountedRef.current) setIsAnalyzing(false);
      }
    }
  }, [activeAgent, availableTools.length, connectionStatus, currentActorCanUseAIAgents, customers, loadLocalHistory, menu, normalizedBusinessTypes, sales, selectedAgent, selectedDateRange, wasteLogs]);

  const handleOpenSavedAnalysis = useCallback(async (analysisId) => {
    const requestId = ++historyRequestRef.current;
    setIsHistoryLoading(true);
    setHistoryError(null);
    setHistoryMessage(null);
    try {
      const analysis = await getLocalAIAnalysisDetail(analysisId);
      if (!isMountedRef.current || requestId !== historyRequestRef.current) return;
      if (!analysis) {
        persistedReportIdRef.current = null;
        writeAIReportUiState({ selectedReportId: null });
        setHistoryError('No se encontro el analisis guardado en este dispositivo.');
        return;
      }
      setSelectedSavedAnalysis(analysis);
      if (analysis.agentType) setSelectedAgent(analysis.agentType);
      if (analysis.dateRange) setSelectedDateRange(analysis.dateRange);
      persistedReportIdRef.current = analysis.id;
      writeAIReportUiState({
        selectedAgent: analysis.agentType,
        selectedDateRange: analysis.dateRange || selectedDateRange,
        selectedReportId: analysis.id
      });
      setAnalysisResult(null);
      setAnalysisError(null);
      setLastToolRun(null);
      setPendingGuidedAction(null);
    } catch (error) {
      if (!isMountedRef.current || requestId !== historyRequestRef.current) return;
      console.warn('No se pudo abrir el analisis guardado:', error);
      setHistoryError('No se pudo abrir el analisis guardado.');
    } finally {
      if (isMountedRef.current && requestId === historyRequestRef.current) setIsHistoryLoading(false);
    }
  }, [selectedDateRange]);

  const handleOpenGuidedAction = useCallback((action) => setPendingGuidedAction(resolveAgentAction(action)), []);
  const handleConfirmGuidedAction = useCallback(() => {
    if (!pendingGuidedAction) return;
    const result = executeAgentAction(pendingGuidedAction, navigate);
    if (!result.success) { setAnalysisError(result.message || 'No se pudo ejecutar la accion guiada.'); return; }
    setPendingGuidedAction(null);
  }, [navigate, pendingGuidedAction]);

  const handleGenerateCurrentFromSaved = useCallback(() => {
    if (selectedSavedAnalysis?.agentType) setSelectedAgent(selectedSavedAnalysis.agentType);
    if (selectedSavedAnalysis?.dateRange) setSelectedDateRange(selectedSavedAnalysis.dateRange);
    persistedReportIdRef.current = null;
    writeAIReportUiState({
      selectedAgent: selectedSavedAnalysis?.agentType || selectedAgent,
      selectedDateRange: selectedSavedAnalysis?.dateRange || selectedDateRange,
      selectedReportId: null
    });
    setSelectedSavedAnalysis(null);
  }, [selectedAgent, selectedDateRange, selectedSavedAnalysis]);

  const isButtonDisabled = isAnalyzing || !currentActorCanUseAIAgents || !connectionStatus.isApiReady || isPreviewLoading || isDataEmpty;
  const hasReadySelection = Boolean(selectedAgent && selectedDateRange);
  const selectedDateRangeLabel = formatDateRangeLabel(selectedDateRange);
  const currentAgentTitle = activeAgent?.name || 'Elige un agente';
  const currentAgentDescription = activeAgent?.description || 'Selecciona el area que quieres revisar y confirma el periodo antes de generar el analisis.';

  return (
    <div className="ai-agent-dashboard">
      <AIAgentUsageLegend
        enabled={currentActorCanUseAIAgents}
        connectionStatus={connectionStatus}
        onRefreshStatus={validateConnection}
      />

      <section className="ai-agent-workflow" aria-label="Configurar analisis IA">
        <div className="ai-agent-rail">
          <div className="ai-agent-rail-header">
            <span>Area</span>
            <strong>{selectedAgent ? 'Seleccionada' : 'Pendiente'}</strong>
          </div>

          <div className="ai-agent-options">
            {AGENTS.map(agent => (
              <AgentOption
                key={agent.id}
                agent={agent}
                isSelected={selectedAgent === agent.id}
                onSelect={handleSelectAgent}
                disabled={isAnalyzing || !connectionStatus.isApiReady || connectionStatus.isChecking}
              />
            ))}
          </div>
        </div>

        <div className="ai-agent-command-panel">
          <div className="ai-agent-command-header">
            <div className="ai-agent-command-copy">
              <span className="ai-agent-command-kicker">Consulta</span>
              <h3>{currentAgentTitle}</h3>
              <p>{currentAgentDescription}</p>
            </div>

            {selectedAgent && (
              <DateRangeSelector
                selectedRange={selectedDateRange}
                onSelect={handleSelectDateRange}
                disabled={isAnalyzing || !connectionStatus.isApiReady || connectionStatus.isChecking}
              />
            )}
          </div>

          {hasReadySelection ? (
            <>
              <DataPreviewBanner preview={preview} isCalculating={isPreviewLoading} isDataEmpty={isDataEmpty} />

              <section className="ai-agent-analyze-action">
                <button className="ai-agent-analyze-button" onClick={handleAnalyze} disabled={isButtonDisabled} type="button">
                  {isAnalyzing ? <><RefreshCw size={18} className="spin-icon" /><span>Analizando datos</span></> : !connectionStatus.isOnline ? <><WifiOff size={18} /><span>Sin conexion</span></> : !connectionStatus.isApiReady ? <><AlertCircle size={18} /><span>No disponible</span></> : <><Sparkles size={18} /><span>Generar analisis</span></>}
                </button>
                {!connectionStatus.isOnline && <p className="ai-agent-hint"><AlertCircle size={14} />Conectate a internet para usar los agentes de IA.</p>}
                {connectionStatus.isOnline && !connectionStatus.isApiReady && connectionStatus.error && <p className="ai-agent-hint"><AlertCircle size={14} />{connectionStatus.error}</p>}
              </section>

              {isAnalyzing && !analysisResult && (
                <section className="analysis-state">
                  <div className="state-indicator">
                    <div className="pulse-ring" />
                    <BrainCircuit size={32} className="analyzing-icon" />
                  </div>
                  <p className="state-text">Procesando datos y preparando acciones guiadas...</p>
                </section>
              )}

              {isAnalyzing && analysisResult && (
                <div className="analysis-refresh-indicator" role="status" aria-live="polite">
                  <RefreshCw size={15} className="spin-icon" />
                  <span>Actualizando el análisis; el resultado anterior permanece visible.</span>
                </div>
              )}

              {analysisError && (
                <section className="analysis-error">
                  <AlertCircle size={24} />
                  <div className="error-content">
                    <h4>Error en analisis</h4>
                    <p>{analysisError}</p>
                  </div>
                  <button className="retry-button" onClick={handleAnalyze} disabled={isAnalyzing || !connectionStatus.isApiReady || connectionStatus.isChecking} type="button">Reintentar</button>
                </section>
              )}

              {analysisResult && !selectedSavedAnalysis && (
                <section className="analysis-result-container">
                  <div className="result-header">
                    <div className="result-agent" style={{ '--agent-color': activeAgent?.color }}>
                      {activeAgent && <activeAgent.icon size={20} />}
                      <span>{activeAgent?.name}</span>
                    </div>
                    <span className="result-range">{selectedDateRangeLabel}{lastToolRun?.availableToolCount ? ` - ${lastToolRun.availableToolCount} herramientas` : ''}</span>
                  </div>
                  <StructuredAnalysisResult result={analysisResult} onAction={handleOpenGuidedAction} />
                </section>
              )}
            </>
          ) : (
            <div className="ai-agent-setup-empty">
              <Activity size={20} />
              <span>Selecciona un agente para preparar el analisis.</span>
            </div>
          )}
        </div>
      </section>

      {selectedSavedAnalysis && !isAnalyzing && (
        <section className="ai-saved-analysis-detail">
          <div className="ai-saved-analysis-header">
            <div><span className="ai-saved-analysis-kicker"><History size={16} />Analisis guardado</span><h3>{selectedSavedAnalysis.agentName || 'Agente IA'}</h3><p className="ai-saved-analysis-meta">Generado el: {selectedSavedAnalysis.generatedAtLabel}{selectedSavedAnalysis.dateRangeLabel ? ` - ${selectedSavedAnalysis.dateRangeLabel}` : ''}</p></div>
            <button className="ai-history-secondary-button" type="button" onClick={() => setSelectedSavedAnalysis(null)}>Volver al historial</button>
          </div>
          <div className="ai-saved-analysis-notice">Este analisis corresponde a los datos disponibles cuando fue generado. Consultarlo no consume una nueva consulta IA.</div>
          <StructuredAnalysisResult result={selectedSavedAnalysis} onAction={handleOpenGuidedAction} />
          <div className="ai-saved-analysis-actions">
            <button className="ai-history-primary-button" type="button" onClick={handleGenerateCurrentFromSaved}><Sparkles size={16} />Generar nuevo analisis con datos actuales</button>
          </div>
        </section>
      )}

      {!selectedSavedAnalysis && (
        <AIAgentHistoryPanel analyses={savedAnalyses} isLoading={isHistoryLoading} message={historyMessage} error={historyError} selectedAgent={selectedAgent} onOpen={handleOpenSavedAnalysis} />
      )}

      <AgentActionConfirmModal isOpen={Boolean(pendingGuidedAction)} action={pendingGuidedAction} onClose={() => setPendingGuidedAction(null)} onConfirm={handleConfirmGuidedAction} />
    </div>
  );
}
