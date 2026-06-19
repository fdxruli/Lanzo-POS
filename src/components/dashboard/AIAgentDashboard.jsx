/**
 * AIAgentDashboard - Componente modular de IA para análisis de negocio.
 *
 * El flujo ya no se limita a mandar un resumen plano a la IA:
 * 1. Agrega datos locales por agente.
 * 2. Ejecuta herramientas internas MCP-lite según agente/rubro.
 * 3. Inyecta los hallazgos estructurados al prompt.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  BrainCircuit,
  Package,
  DollarSign,
  Users,
  Calendar,
  AlertCircle,
  CheckCircle,
  WifiOff,
  RefreshCw,
  ChevronDown,
  Sparkles,
  Clock,
  BarChart3,
  Activity,
  Wrench
} from 'lucide-react';
import { buildAgentPayload, DATE_RANGES, formatDateRangeLabel } from '../../utils/buildAgentPayload';
import { buildPrompt, parseMarkdownResponse, validateAgentData } from '../../utils/aiPromptBuilder';
import { analyzeWithAI, AIApiError, validateAIConnection, getAIConfigStatus } from '../../services/aiService';
import { getAvailableAgentTools, runAgentTools } from '../../agents/agentToolRegistry';
import { useAgentPreview } from '../../hooks/dashboard/useAgentPreview';
import DataPreviewBanner from './DataPreviewBanner';
import './AIAgentDashboard.css';

const isBrowserOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

const AGENTS = [
  {
    id: 'inventoryAuditor',
    name: 'Auditor de Inventario',
    description: 'Analiza mermas, productos de baja rotación y alertas de stock',
    icon: Package,
    color: '#f59e0b',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
  },
  {
    id: 'financialAnalyst',
    name: 'Analista Financiero',
    description: 'Analiza ticket promedio, horarios de mayor venta y métodos de pago',
    icon: DollarSign,
    color: '#10b981',
    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
  },
  {
    id: 'customerStrategist',
    name: 'Estratega de Clientes',
    description: 'Analiza recurrencia, deudores y ticket promedio por cliente',
    icon: Users,
    color: '#6366f1',
    gradient: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
  }
];

const DATE_RANGE_OPTIONS = [
  { id: DATE_RANGES.TODAY, label: 'Hoy', icon: Clock },
  { id: DATE_RANGES.LAST_7_DAYS, label: 'Últimos 7 días', icon: Calendar },
  { id: DATE_RANGES.LAST_30_DAYS, label: 'Últimos 30 días', icon: Calendar },
  { id: DATE_RANGES.THIS_MONTH, label: 'Este Mes', icon: BarChart3 },
  { id: DATE_RANGES.LAST_MONTH, label: 'Mes Anterior', icon: BarChart3 }
];

const DateRangeSelector = ({ selectedRange, onSelect, disabled }) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = DATE_RANGE_OPTIONS.find(option => option.id === selectedRange);
  const SelectedIcon = selectedOption?.icon || Calendar;

  return (
    <div className="date-range-selector">
      <label className="selector-label">
        <Calendar size={16} />
        Período de Análisis
      </label>
      <div className="selector-content">
        <button
          className="selector-trigger"
          onClick={() => setIsOpen(prev => !prev)}
          disabled={disabled}
          type="button"
        >
          <SelectedIcon size={18} />
          <span>{selectedOption?.label || 'Seleccionar'}</span>
          <ChevronDown size={18} className={`chevron ${isOpen ? 'open' : ''}`} />
        </button>

        {isOpen && (
          <div className="selector-dropdown">
            {DATE_RANGE_OPTIONS.map(option => {
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  className={`dropdown-option ${selectedRange === option.id ? 'selected' : ''}`}
                  onClick={() => {
                    onSelect(option.id);
                    setIsOpen(false);
                  }}
                  disabled={disabled}
                  type="button"
                >
                  <Icon size={18} />
                  <span>{option.label}</span>
                  {selectedRange === option.id && <CheckCircle size={16} className="check-icon" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const AgentCard = ({ agent, isSelected, onSelect, disabled }) => {
  const Icon = agent.icon;

  return (
    <div
      className={`agent-card ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={() => !disabled && onSelect(agent.id)}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => !disabled && event.key === 'Enter' && onSelect(agent.id)}
      style={{
        '--agent-color': agent.color,
        '--agent-gradient': agent.gradient
      }}
    >
      <div className="agent-card-header">
        <div className="agent-icon-wrapper" style={{ background: agent.gradient }}>
          <Icon size={24} color="white" />
        </div>
        {isSelected && (
          <div className="selected-badge">
            <CheckCircle size={14} />
          </div>
        )}
      </div>

      <div className="agent-card-body">
        <h4 className="agent-name">{agent.name}</h4>
        <p className="agent-description">{agent.description}</p>
      </div>
    </div>
  );
};

const AnalysisSkeleton = () => (
  <div className="analysis-skeleton">
    <div className="skeleton-header">
      <div className="skeleton-line short" />
      <div className="skeleton-line medium" />
    </div>
    <div className="skeleton-section">
      <div className="skeleton-line full" />
      <div className="skeleton-line full" />
      <div className="skeleton-line short" />
    </div>
    <div className="skeleton-section">
      <div className="skeleton-line full" />
      <div className="skeleton-line full" />
    </div>
    <div className="skeleton-section">
      <div className="skeleton-line full" />
      <div className="skeleton-line medium" />
      <div className="skeleton-line short" />
    </div>
  </div>
);

const AnalysisResult = ({ result }) => {
  const sections = useMemo(() => parseMarkdownResponse(result), [result]);

  if (sections.length === 0) {
    return (
      <div className="analysis-result raw-markdown">
        <pre>{result}</pre>
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

const ToolPreview = ({ tools }) => {
  if (!tools?.length) return null;

  return (
    <div className="data-preview-banner">
      <div className="preview-header">
        <Wrench size={16} />
        <span>Herramientas internas disponibles:</span>
      </div>
      <ul className="preview-metrics">
        {tools.slice(0, 6).map(tool => (
          <li key={tool.id}>
            <span className="metric-label">{tool.id}</span>
            <span className="metric-value">lista</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default function AIAgentDashboard({ sales = [], menu = [], customers = [], wasteLogs = [], businessType = [] }) {
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedDateRange, setSelectedDateRange] = useState(DATE_RANGES.LAST_7_DAYS);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [lastToolRun, setLastToolRun] = useState(null);

  const [connectionStatus, setConnectionStatus] = useState({
    isOnline: isBrowserOnline(),
    isApiReady: false,
    isChecking: true,
    error: null,
    provider: null,
    model: null
  });

  const { preview, isCalculating: isPreviewLoading } = useAgentPreview(
    selectedAgent,
    selectedDateRange,
    sales,
    menu,
    wasteLogs,
    customers
  );

  const availableTools = useMemo(() => {
    if (!selectedAgent) return [];
    return getAvailableAgentTools({ agentType: selectedAgent, businessTypes: businessType });
  }, [selectedAgent, businessType]);

  const isDataEmpty = useMemo(() => {
    if (!selectedAgent) return true;
    if (selectedAgent === 'inventoryAuditor') return menu.length === 0;
    if (selectedAgent === 'financialAnalyst') return sales.length === 0;
    if (selectedAgent === 'customerStrategist') return customers.length === 0;
    return false;
  }, [selectedAgent, menu, sales, customers]);

  const isButtonDisabled = isAnalyzing || !connectionStatus.isApiReady || isPreviewLoading || isDataEmpty;

  const validateConnection = useCallback(async () => {
    setConnectionStatus(prev => ({ ...prev, isChecking: true }));
    const configStatus = getAIConfigStatus();

    if (!configStatus.hasKey) {
      setConnectionStatus({
        isOnline: isBrowserOnline(),
        isApiReady: false,
        isChecking: false,
        error: `Falta API Key para ${configStatus.provider.toUpperCase()}`,
        provider: configStatus.provider,
        model: configStatus.model
      });
      return;
    }

    try {
      const result = await validateAIConnection({ timeoutMs: 5000 });

      setConnectionStatus({
        isOnline: isBrowserOnline(),
        isApiReady: result.valid,
        isChecking: false,
        error: result.valid ? null : result.error,
        provider: result.provider,
        model: result.model
      });
    } catch (error) {
      setConnectionStatus({
        isOnline: isBrowserOnline(),
        isApiReady: false,
        isChecking: false,
        error: `Error de API: ${error.message}`,
        provider: configStatus.provider,
        model: configStatus.model
      });
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setConnectionStatus(prev => ({ ...prev, isOnline: true }));
      validateConnection();
    };
    const handleOffline = () => {
      setConnectionStatus(prev => ({ ...prev, isOnline: false, isApiReady: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    validateConnection();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [validateConnection]);

  const businessContext = useMemo(() => ({
    businessType: Array.isArray(businessType) ? businessType.join(', ') : String(businessType || 'No especificado'),
    totalCustomers: customers.length
  }), [businessType, customers]);

  const handleAnalyze = useCallback(async () => {
    if (!selectedAgent || !selectedDateRange) return;

    if (!connectionStatus.isOnline) {
      setAnalysisError('Sin conexión. Verifica tu conexión a internet para análisis con IA.');
      return;
    }

    if (!connectionStatus.isApiReady) {
      setAnalysisError(`API no disponible: ${connectionStatus.error || 'Error de configuración'}`);
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    setLastToolRun(null);

    try {
      const aggregatedPayload = await buildAgentPayload(selectedAgent, selectedDateRange, {
        menu,
        wasteLogs,
        sales,
        customers
      });

      const validation = validateAgentData(selectedAgent, aggregatedPayload);
      if (!validation.valid) throw new Error(validation.reason);

      const agentToolRun = await runAgentTools({
        agentType: selectedAgent,
        businessTypes: businessType,
        rawData: { menu, wasteLogs, sales, customers },
        aggregatedPayload
      });

      setLastToolRun(agentToolRun);

      const enrichedPayload = {
        ...aggregatedPayload,
        agentToolRun
      };

      const { systemPrompt, userPrompt } = buildPrompt(
        selectedAgent,
        enrichedPayload,
        {
          ...businessContext,
          dateRange: formatDateRangeLabel(selectedDateRange)
        }
      );

      const response = await analyzeWithAI(systemPrompt, userPrompt, {
        model: connectionStatus.model,
        provider: connectionStatus.provider,
        temperature: 0.2,
        maxTokens: 2048,
        timeoutMs: 60000
      });

      setAnalysisResult(response);
    } catch (error) {
      console.error('Error en análisis IA:', error);

      if (error instanceof AIApiError) {
        setAnalysisError(error.message);
      } else {
        setAnalysisError(error.message || 'Error al generar análisis. Intenta nuevamente.');
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedAgent, selectedDateRange, connectionStatus, menu, wasteLogs, sales, customers, businessContext, businessType]);

  useEffect(() => {
    setAnalysisResult(null);
    setAnalysisError(null);
    setLastToolRun(null);
  }, [selectedAgent, selectedDateRange]);

  const activeAgent = useMemo(
    () => AGENTS.find(agent => agent.id === selectedAgent),
    [selectedAgent]
  );

  return (
    <div className="ai-agent-dashboard">
      <header className="ai-dashboard-header">
        <div className="header-content">
          <BrainCircuit size={28} className="header-icon" />
          <div className="header-text">
            <h2 className="header-title">Agentes de IA</h2>
            <p className="header-subtitle">
              Análisis inteligente con herramientas internas del negocio
            </p>
          </div>
        </div>

        <div className={`connection-indicator ${connectionStatus.isApiReady ? 'online' : connectionStatus.isOnline ? 'warning' : 'offline'}`}>
          {connectionStatus.isChecking ? (
            <>
              <RefreshCw size={16} className="spin-icon" />
              <span>Validando API...</span>
            </>
          ) : connectionStatus.isApiReady ? (
            <>
              <div className="status-dot" />
              <span>{connectionStatus.model} ({connectionStatus.provider})</span>
            </>
          ) : connectionStatus.isOnline ? (
            <>
              <AlertCircle size={16} />
              <span>API no disponible</span>
            </>
          ) : (
            <>
              <WifiOff size={16} />
              <span>Sin conexión</span>
            </>
          )}
        </div>
      </header>

      <section className="agent-selection">
        <h3 className="section-heading">
          <Sparkles size={18} />
          Selecciona un Agente Especializado
        </h3>
        <div className="agents-grid">
          {AGENTS.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isSelected={selectedAgent === agent.id}
              onSelect={setSelectedAgent}
              disabled={isAnalyzing || !connectionStatus.isApiReady || connectionStatus.isChecking}
            />
          ))}
        </div>
      </section>

      {selectedAgent && (
        <section className="date-selection">
          <DateRangeSelector
            selectedRange={selectedDateRange}
            onSelect={setSelectedDateRange}
            disabled={isAnalyzing || !connectionStatus.isApiReady || connectionStatus.isChecking}
          />
        </section>
      )}

      {selectedAgent && selectedDateRange && (
        <>
          <DataPreviewBanner preview={preview} isCalculating={isPreviewLoading} isDataEmpty={isDataEmpty} />
          <ToolPreview tools={availableTools} />
        </>
      )}

      {selectedAgent && selectedDateRange && (
        <section className="analyze-action">
          <button
            className="analyze-button"
            onClick={handleAnalyze}
            disabled={isButtonDisabled}
            type="button"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw size={20} className="spin-icon" />
                <span>Ejecutando herramientas y analizando...</span>
              </>
            ) : !connectionStatus.isOnline ? (
              <>
                <WifiOff size={20} />
                <span>Sin Conexión</span>
              </>
            ) : !connectionStatus.isApiReady ? (
              <>
                <AlertCircle size={20} />
                <span>API No Disponible</span>
              </>
            ) : connectionStatus.isChecking ? (
              <>
                <RefreshCw size={20} className="spin-icon" />
                <span>Validando...</span>
              </>
            ) : (
              <>
                <Sparkles size={20} />
                <span>Generar Análisis con IA</span>
              </>
            )}
          </button>

          {!connectionStatus.isOnline && (
            <p className="offline-hint">
              <AlertCircle size={14} />
              Conéctate a internet para usar los agentes de IA
            </p>
          )}

          {connectionStatus.isOnline && !connectionStatus.isApiReady && connectionStatus.error && (
            <p className="offline-hint">
              <AlertCircle size={14} />
              {connectionStatus.error}
            </p>
          )}
        </section>
      )}

      {isAnalyzing && (
        <section className="analysis-state">
          <div className="state-indicator">
            <div className="pulse-ring" />
            <BrainCircuit size={32} className="analyzing-icon" />
          </div>
          <p className="state-text">
            Procesando datos agregados y herramientas internas...
          </p>
          <AnalysisSkeleton />
        </section>
      )}

      {analysisError && (
        <section className="analysis-error">
          <AlertCircle size={24} />
          <div className="error-content">
            <h4>Error en Análisis</h4>
            <p>{analysisError}</p>
          </div>
          <button
            className="retry-button"
            onClick={handleAnalyze}
            disabled={isAnalyzing || !connectionStatus.isApiReady || connectionStatus.isChecking}
            type="button"
          >
            Reintentar
          </button>
        </section>
      )}

      {analysisResult && !isAnalyzing && (
        <section className="analysis-result-container">
          <div className="result-header">
            <div className="result-agent" style={{ '--agent-color': activeAgent?.color }}>
              {activeAgent && <activeAgent.icon size={20} />}
              <span>{activeAgent?.name}</span>
            </div>
            <span className="result-range">
              {formatDateRangeLabel(selectedDateRange)}
              {lastToolRun?.availableToolCount ? ` • ${lastToolRun.availableToolCount} tools` : ''}
            </span>
          </div>
          <AnalysisResult result={analysisResult} />
        </section>
      )}

      {!selectedAgent && !analysisResult && !isAnalyzing && (
        <section className="empty-state">
          <Activity size={48} className="empty-icon" />
          <h3>Selecciona un agente para comenzar</h3>
          <p>
            Cada agente se especializa en un área del negocio y usa herramientas internas antes de consultar la IA.
          </p>
        </section>
      )}
    </div>
  );
}
