/**
 * AIAgentDashboard - Componente modular de IA para análisis de negocio
 * 
 * Reemplaza el bot genérico por agentes especializados que requieren:
 * - Selección obligatoria de rango de fechas
 * - Elección de área específica de análisis
 * - Capa de agregación de datos (sin datos crudos)
 * - Prompts estructurados con contexto del negocio
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  BrainCircuit,
  Package,
  DollarSign,
  Users,
  Calendar,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  WifiOff,
  RefreshCw,
  ChevronDown,
  Sparkles,
  Clock,
  BarChart3,
  PieChart,
  Activity
} from 'lucide-react';
import { buildAgentPayload, DATE_RANGES, formatDateRangeLabel } from '../../utils/buildAgentPayload';
import { buildPrompt, parseMarkdownResponse, validateAgentData } from '../../utils/aiPromptBuilder';
import { analyzeWithAI, AIApiError, validateAIConnection, getAIConfigStatus } from '../../services/aiService';
import './AIAgentDashboard.css';

// ============================================================
// 1. CONFIGURACIÓN Y CONSTANTES
// ============================================================

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

// ============================================================
// 2. SUB-COMPONENTES
// ============================================================

/**
 * Selector de Rango de Fechas
 */
const DateRangeSelector = ({ selectedRange, onSelect, disabled }) => {
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = DATE_RANGE_OPTIONS.find(opt => opt.id === selectedRange);
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
          onClick={() => setIsOpen(!isOpen)}
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

/**
 * Tarjeta de Agente Seleccionable
 */
const AgentCard = ({ agent, isSelected, onSelect, disabled }) => {
  const Icon = agent.icon;

  return (
    <div
      className={`agent-card ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={() => !disabled && onSelect(agent.id)}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => !disabled && e.key === 'Enter' && onSelect(agent.id)}
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

/**
 * Skeleton Loader para estado de análisis
 */
const AnalysisSkeleton = () => {
  return (
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
};

/**
 * Renderizado de respuesta Markdown parseada
 */
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
      {sections.map((section, idx) => (
        <div key={idx} className="result-section">
          <h4 className="section-title">{section.title}</h4>
          <ul className="section-items">
            {section.items.map((item, itemIdx) => (
              <li key={itemIdx}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

// ============================================================
// 3. COMPONENTE PRINCIPAL
// ============================================================

export default function AIAgentDashboard({ sales = [], menu = [], customers = [], wasteLogs = [], businessType = [] }) {
  // Estados de selección
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedDateRange, setSelectedDateRange] = useState(DATE_RANGES.LAST_7_DAYS);

  // Estados de análisis
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);

  // Estado de conexión - ahora dinámico
  const [connectionStatus, setConnectionStatus] = useState({
    isOnline: navigator.onLine,
    isApiReady: false,
    isChecking: true,
    error: null,
    provider: null,
    model: null
  });

  // Escuchar cambios de conexión y validar API
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

    // Validación inicial
    validateConnection();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Función para validar conexión con la API
  const validateConnection = async () => {
    setConnectionStatus(prev => ({ ...prev, isChecking: true }));

    const configStatus = getAIConfigStatus();

    // Si no hay API Key, mostrar error inmediato
    if (!configStatus.hasKey) {
      setConnectionStatus({
        isOnline: navigator.onLine,
        isApiReady: false,
        isChecking: false,
        error: 'API Key no configurada. Agrega VITE_AI_API_KEY en tu archivo .env',
        provider: configStatus.provider,
        model: configStatus.model
      });
      return;
    }

    try {
      const result = await validateAIConnection({ timeoutMs: 15000 });

      setConnectionStatus({
        isOnline: navigator.onLine,
        isApiReady: result.valid,
        isChecking: false,
        error: result.valid ? null : result.error,
        provider: result.provider,
        model: result.model
      });
    } catch (error) {
      setConnectionStatus({
        isOnline: navigator.onLine,
        isApiReady: false,
        isChecking: false,
        error: error.message || 'Error al validar conexión',
        provider: configStatus.provider,
        model: configStatus.model
      });
    }
  };

  // Contexto del negocio para el prompt
  const businessContext = useMemo(() => ({
    businessType: businessType.join(', ') || 'No especificado',
    totalCustomers: customers.length
  }), [businessType, customers]);

  // Manejador de análisis
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

    try {
      // Paso 1: Construir payload agregado (simula extracción de Dexie)
      const aggregatedPayload = await buildAgentPayload(selectedAgent, selectedDateRange, {
        menu,
        wasteLogs,
        sales,
        customers
      });

      // Paso 2: Validar datos mínimos
      const validation = validateAgentData(selectedAgent, aggregatedPayload);
      if (!validation.valid) {
        throw new Error(validation.reason);
      }

      // Paso 3: Construir prompt estructurado
      const { systemPrompt, userPrompt } = buildPrompt(
        selectedAgent,
        aggregatedPayload,
        { ...businessContext, dateRange: formatDateRangeLabel(selectedDateRange) }
      );

      // Paso 4: Llamar a la API de IA real
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
      
      // Manejo específico de errores de la API de IA
      if (error instanceof AIApiError) {
        setAnalysisError(error.message);
      } else {
        setAnalysisError(error.message || 'Error al generar análisis. Intenta nuevamente.');
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedAgent, selectedDateRange, connectionStatus, menu, wasteLogs, sales, customers, businessContext]);

  // Resetear análisis al cambiar agente o rango
  useEffect(() => {
    setAnalysisResult(null);
    setAnalysisError(null);
  }, [selectedAgent, selectedDateRange]);

  // Agente seleccionado
  const activeAgent = useMemo(
    () => AGENTS.find(a => a.id === selectedAgent),
    [selectedAgent]
  );

  return (
    <div className="ai-agent-dashboard">
      {/* Header */}
      <header className="ai-dashboard-header">
        <div className="header-content">
          <BrainCircuit size={28} className="header-icon" />
          <div className="header-text">
            <h2 className="header-title">Agentes de IA</h2>
            <p className="header-subtitle">
              Análisis inteligente de tu negocio sin exponer datos crudos
            </p>
          </div>
        </div>

        {/* Indicador de conexión */}
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

      {/* Selector de Agente */}
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

      {/* Selector de Fecha */}
      {selectedAgent && (
        <section className="date-selection">
          <DateRangeSelector
            selectedRange={selectedDateRange}
            onSelect={setSelectedDateRange}
            disabled={isAnalyzing || !connectionStatus.isApiReady || connectionStatus.isChecking}
          />
        </section>
      )}

      {/* Botón de Análisis */}
      {selectedAgent && selectedDateRange && (
        <section className="analyze-action">
          <button
            className="analyze-button"
            onClick={handleAnalyze}
            disabled={isAnalyzing || !connectionStatus.isApiReady || connectionStatus.isChecking}
            type="button"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw size={20} className="spin-icon" />
                <span>Analizando datos...</span>
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

      {/* Estado de Carga */}
      {isAnalyzing && (
        <section className="analysis-state">
          <div className="state-indicator">
            <div className="pulse-ring" />
            <BrainCircuit size={32} className="analyzing-icon" />
          </div>
          <p className="state-text">
            Procesando datos agregados...
          </p>
          <AnalysisSkeleton />
        </section>
      )}

      {/* Error */}
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

      {/* Resultado */}
      {analysisResult && !isAnalyzing && (
        <section className="analysis-result-container">
          <div className="result-header">
            <div className="result-agent" style={{ '--agent-color': activeAgent?.color }}>
              {activeAgent && <activeAgent.icon size={20} />}
              <span>{activeAgent?.name}</span>
            </div>
            <span className="result-range">
              {formatDateRangeLabel(selectedDateRange)}
            </span>
          </div>
          <AnalysisResult result={analysisResult} />
        </section>
      )}

      {/* Estado vacío inicial */}
      {!selectedAgent && !analysisResult && !isAnalyzing && (
        <section className="empty-state">
          <Activity size={48} className="empty-icon" />
          <h3>Selecciona un agente para comenzar</h3>
          <p>
            Cada agente se especializa en un área de tu negocio.
            Los datos se agregan localmente antes de cualquier análisis.
          </p>
        </section>
      )}
    </div>
  );
}
