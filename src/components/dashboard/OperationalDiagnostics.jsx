/**
 * OperationalDiagnostics.jsx
 * 
 * Orquestador de UI para diagnóstico operativo del negocio.
 * Reemplaza a BusinessTips.jsx como módulo de alertas duras basadas en datos.
 * 
 * Responsabilidades:
 * - Leer rubro del negocio desde el store/perfil
 * - Renderizar el hook de diagnóstico correspondiente
 * - Manejar estados de carga y error
 * - Mostrar alertas accionables con métricas calculadas
 * 
 * NO contiene lógica de cálculo - delega todo a hooks especializados por rubro.
 */

import React, { useMemo, useEffect, useState, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  ChefHat,
  Clock,
  DollarSign,
  Loader2,
  Package,
  Pill,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  XCircle,
  ShoppingCart,
  AlertCircle,
  BrainCircuit,
  Bot
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useSalesStore } from '../../store/useSalesStore';
import { useRestaurantDiagnostics } from '../../hooks/diagnostics/useRestaurantDiagnostics';
import { usePharmacyDiagnostics } from '../../hooks/diagnostics/usePharmacyDiagnostics';
import { useRetailDiagnostics } from '../../hooks/diagnostics/useRetailDiagnostics';
import AIAgentDashboard from './AIAgentDashboard';
import './OperationalDiagnostics.css';

// ============================================================
// CONFIGURACIÓN Y MAPEO DE RUBROS
// ============================================================

const BUSINESS_TYPE_MAPPING = {
  // Restaurante / Comida
  restaurant: { type: 'restaurant', label: 'Restaurante', icon: ChefHat },
  'dark-kitchen': { type: 'restaurant', label: 'Dark Kitchen', icon: ChefHat },
  cocina: { type: 'restaurant', label: 'Cocina', icon: ChefHat },
  food: { type: 'restaurant', label: 'Comida', icon: ChefHat },
  fruteria: { type: 'restaurant', label: 'Frutería', icon: ShoppingCart },

  // Farmacia
  pharmacy: { type: 'pharmacy', label: 'Farmacia', icon: Pill },
  farmacia: { type: 'pharmacy', label: 'Farmacia', icon: Pill },
  drogueria: { type: 'pharmacy', label: 'Droguería', icon: Pill },

  // Retail / Abarrotes
  retail: { type: 'retail', label: 'Retail', icon: ShoppingCart },
  abarrotes: { type: 'retail', label: 'Abarrotes', icon: ShoppingCart },
  tienda: { type: 'retail', label: 'Tienda', icon: ShoppingCart },
  minimarket: { type: 'retail', label: 'Minimarket', icon: ShoppingCart },
  apparel: { type: 'retail', label: 'Ropa', icon: ShoppingCart },
  hardware: { type: 'retail', label: 'Ferretería', icon: ShoppingCart }
};

const DIAGNOSTIC_HOOKS = {
  restaurant: useRestaurantDiagnostics,
  pharmacy: usePharmacyDiagnostics,
  retail: useRetailDiagnostics
};

const ALERT_TYPE_CONFIG = {
  danger: {
    icon: XCircle,
    className: 'alert-danger',
    label: 'Crítico'
  },
  warning: {
    icon: AlertTriangle,
    className: 'alert-warning',
    label: 'Advertencia'
  },
  info: {
    icon: AlertCircle,
    className: 'alert-info',
    label: 'Información'
  },
  success: {
    icon: CheckCircle,
    className: 'alert-success',
    label: 'Correcto'
  }
};

const CATEGORY_CONFIG = {
  revenue: { label: 'Ingresos', icon: DollarSign },
  operations: { label: 'Operaciones', icon: Activity },
  inventory: { label: 'Inventario', icon: Package },
  pricing: { label: 'Precios', icon: TrendingUp }
};

// ============================================================
// SUB-COMPONENTES
// ============================================================

/**
 * Skeleton de carga para el estado isLoading
 */
const DiagnosticSkeleton = () => (
  <div className="diagnostic-skeleton">
    <div className="skeleton-header">
      <div className="skeleton-line short" />
      <div className="skeleton-line medium" />
    </div>
    <div className="skeleton-alerts">
      {[1, 2, 3].map(i => (
        <div key={i} className="skeleton-alert">
          <div className="skeleton-icon" />
          <div className="skeleton-content">
            <div className="skeleton-line full" />
            <div className="skeleton-line medium" />
            <div className="skeleton-line short" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

/**
 * Tarjeta de alerta individual
 */
const AlertCard = React.memo(({ alert, onNavigate }) => {
  const TypeConfig = ALERT_TYPE_CONFIG[alert.type] || ALERT_TYPE_CONFIG.info;
  const TypeIcon = TypeConfig.icon;
  const CategoryConfig = CATEGORY_CONFIG[alert.category] || { label: 'General', icon: Activity };
  const CategoryIcon = CategoryConfig.icon;

  const handleClick = useCallback(() => {
    if (alert.link) {
      onNavigate?.(alert.link);
    }
  }, [alert.link, onNavigate]);

  return (
    <div
      className={`diagnostic-alert ${TypeConfig.className} ${alert.link ? 'clickable' : ''}`}
      onClick={handleClick}
      role={alert.link ? 'button' : 'article'}
      tabIndex={alert.link ? 0 : -1}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
    >
      <div className="alert-header">
        <div className="alert-type-badge">
          <TypeIcon size={16} />
          <span>{TypeConfig.label}</span>
        </div>

        <div className="alert-category">
          <CategoryIcon size={14} />
          <span>{CategoryConfig.label}</span>
        </div>

        {alert.priority === 1 && (
          <div className="priority-badge high">
            <Activity size={12} />
            <span>Alta</span>
          </div>
        )}
      </div>

      <div className="alert-body">
        <h4 className="alert-title">{alert.title}</h4>
        <p className="alert-message">
          {alert.message.split('\n').map((line, i) => (
            <React.Fragment key={i}>
              {line}
              {i < alert.message.split('\n').length - 1 && <br />}
            </React.Fragment>
          ))}
        </p>
      </div>

      {alert.metrics && (
        <div className="alert-metrics">
          {Object.entries(alert.metrics).map(([key, value]) => {
            if (value === null || value === undefined) return null;
            return (
              <div key={key} className="metric-item">
                <span className="metric-label">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                <span className="metric-value">{value}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="alert-footer">
        <p className="alert-action">
          <CheckCircle size={14} />
          {alert.action}
        </p>

        {alert.link && (
          <button className="alert-action-button" type="button">
            Ir a {alert.link.replace('/?', '').split('=')[0]}
            <TrendingUp size={14} />
          </button>
        )}
      </div>
    </div>
  );
});

AlertCard.displayName = 'AlertCard';

/**
 * Estado vacío cuando no hay alertas
 */
const NoAlertsState = ({ businessType }) => {
  const typeConfig = BUSINESS_TYPE_MAPPING[businessType] || { label: 'Negocio' };

  return (
    <div className="no-alerts-state">
      <div className="no-alerts-icon">
        <CheckCircle size={48} />
      </div>
      <h3 className="no-alerts-title">Todo en Orden</h3>
      <p className="no-alerts-message">
        No se detectaron alertas operativas para tu {typeConfig.label}.
      </p>
      <p className="no-alerts-hint">
        Sigue registrando ventas para recibir diagnóstico continuo.
      </p>
    </div>
  );
};

/**
 * Selector de rubro (para depuración o cambio manual)
 */
const BusinessTypeSelector = ({ currentType, onSelect }) => {
  const types = useMemo(() => {
    const unique = new Map();
    Object.values(BUSINESS_TYPE_MAPPING).forEach(t => {
      if (!unique.has(t.type)) {
        unique.set(t.type, t);
      }
    });
    return Array.from(unique.values());
  }, []);

  return (
    <div className="business-type-selector">
      <label className="selector-label">
        <Activity size={16} />
        Rubro de Diagnóstico
      </label>
      <select
        value={currentType}
        onChange={(e) => onSelect(e.target.value)}
        className="selector-input"
      >
        {types.map(type => (
          <option key={type.type} value={type.type}>
            {type.label}
          </option>
        ))}
      </select>
    </div>
  );
};

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export default function OperationalDiagnostics({
  allowRubroOverride = false,
  onNavigate,
  sales = [],
  menu = [],
  customers = [],
  wasteLogs = []
}) {
  // Estado local para override de rubro (depuración)
  const [rubroOverride, setRubroOverride] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [showAIAgent, setShowAIAgent] = useState(false);

  // Obtener datos de las tiendas
  const companyProfile = useAppStore(state => state.companyProfile);

  // Memoizar datos para evitar referencias nuevas en cada render
  const stableSales = useMemo(() => sales, [sales]);
  const stableMenu = useMemo(() => menu, [menu]);
  const stableCustomers = useMemo(() => customers, [customers]);
  const stableWasteLogs = useMemo(() => wasteLogs, [wasteLogs]);
  
  // Determinar tipo de negocio (string para hooks)
  const businessTypeString = useMemo(() => {
    // Si hay override, usarlo
    if (rubroOverride) return rubroOverride;

    // Leer desde perfil
    let types = companyProfile?.business_type || [];
    if (typeof types === 'string') {
      types = types.split(',').map(s => s.trim().toLowerCase());
    }

    // Mapear primer tipo reconocido
    for (const type of types) {
      const mapped = BUSINESS_TYPE_MAPPING[type];
      if (mapped) return mapped.type;
    }

    // Default: retail
    return 'retail';
  }, [companyProfile, rubroOverride]);

  // businessType como array para AIAgentDashboard
  const businessTypeArray = useMemo(() => {
    return [businessTypeString];
  }, [businessTypeString]);

  // Seleccionar hook correspondiente
  const DiagnosticHook = DIAGNOSTIC_HOOKS[businessTypeString] || DIAGNOSTIC_HOOKS.retail;

  // Ejecutar diagnóstico
  const diagnostics = DiagnosticHook();

  // Manejar navegación
  const handleNavigate = useCallback((link) => {
    if (onNavigate) {
      onNavigate(link);
    } else {
      window.location.href = link;
    }
  }, [onNavigate]);

  // Forzar refresh (para depuración)
  const handleRefresh = useCallback(() => {
    setLastRefresh(Date.now());
  }, []);

  // Toggle entre modo diagnóstico y modo IA
  const handleToggleMode = useCallback(() => {
    setShowAIAgent(prev => !prev);
  }, []);

  // Renderizar contenido según estado
  const renderContent = () => {
    // Modo IA Agent
    if (showAIAgent) {
      return (
        <AIAgentDashboard
          sales={stableSales}
          menu={stableMenu}
          customers={stableCustomers}
          wasteLogs={stableWasteLogs}
          businessType={businessTypeArray}
        />
      );
    }

    // Estado de carga
    if (diagnostics.isLoading || diagnostics === Promise.resolve()) {
      return <DiagnosticSkeleton />;
    }

    // Estado de error
    if (diagnostics.error) {
      return (
        <div className="diagnostic-error">
          <AlertCircle size={32} />
          <h3>Error en Diagnóstico</h3>
          <p>{diagnostics.error}</p>
          <button onClick={handleRefresh} className="refresh-button" type="button">
            <RefreshCw size={16} />
            Reintentar
          </button>
        </div>
      );
    }

    // Sin alertas
    if (!diagnostics.alerts || diagnostics.alerts.length === 0) {
      return <NoAlertsState businessType={businessTypeString} />;
    }

    // Listado de alertas
    return (
      <div className="alerts-list">
        {diagnostics.alerts.map(alert => (
          <AlertCard
            key={alert.id}
            alert={alert}
            onNavigate={handleNavigate}
          />
        ))}
      </div>
    );
  };

  // Tipo de negocio actual (para display)
  const currentTypeConfig = BUSINESS_TYPE_MAPPING[businessTypeString] || { label: 'Negocio', icon: Activity };
  const TypeIcon = currentTypeConfig.icon;

  return (
    <div className="operational-diagnostics">
      {/* Header */}
      <div className="diagnostics-header">
        <div className="header-content">
          <div className="header-icon-wrapper">
            {showAIAgent ? (
              <Bot size={28} className="header-icon" />
            ) : (
              <TypeIcon size={28} className="header-icon" />
            )}
          </div>
          <div className="header-text">
            <h2 className="header-title">
              {showAIAgent ? 'Agentes de IA' : 'Diagnóstico Operativo'}
            </h2>
            <p className="header-subtitle">
              {showAIAgent
                ? 'Análisis inteligente con contexto de tu negocio'
                : `${currentTypeConfig.label} • ${diagnostics.summary?.totalAlerts || 0} alertas${diagnostics.summary?.criticalCount > 0
                  ? ` (${diagnostics.summary.criticalCount} críticas)`
                  : ''
                }`
              }
            </p>
          </div>
        </div>

        <div className="header-actions">
          <button
            className="mode-toggle-button"
            onClick={handleToggleMode}
            type="button"
          >
            {showAIAgent ? (
              <>
                <BrainCircuit size={16} />
                <span>Modo Clásico</span>
              </>
            ) : (
              <>
                <Bot size={16} />
                <span>Modo Agente IA</span>
              </>
            )}
          </button>

          {allowRubroOverride && (
            <BusinessTypeSelector
              currentType={businessTypeString}
              onSelect={setRubroOverride}
            />
          )}

          {!showAIAgent && (
            <button
              className="refresh-button-small"
              onClick={handleRefresh}
              disabled={diagnostics.isLoading}
              type="button"
              aria-label="Refrescar diagnóstico"
              title="Actualizar diagnóstico"
            >
              <RefreshCw size={18} className={diagnostics.isLoading ? 'spinning' : ''} />
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards (solo si hay datos y NO está en modo IA) */}
      {!showAIAgent && diagnostics.summary && !diagnostics.isLoading && (
        <div className="diagnostics-summary">
          {diagnostics.summary.ticketLeakage && (
            <div className="summary-card">
              <div className="summary-icon revenue">
                <DollarSign size={20} />
              </div>
              <div className="summary-content">
                <span className="summary-label">Fuga de Ticket</span>
                <span className="summary-value">
                  {Math.round(diagnostics.summary.ticketLeakage.leakageRate * 100)}%
                </span>
              </div>
            </div>
          )}

          {diagnostics.summary.wasteImpact && (
            <div className="summary-card">
              <div className="summary-icon operations">
                <Activity size={20} />
              </div>
              <div className="summary-content">
                <span className="summary-label">Merma</span>
                <span className="summary-value">
                  {Math.round(diagnostics.summary.wasteImpact.wasteRatio * 100)}%
                </span>
              </div>
            </div>
          )}

          {diagnostics.summary.expirationRisk && (
            <div className="summary-card">
              <div className="summary-icon inventory">
                <Package size={20} />
              </div>
              <div className="summary-content">
                <span className="summary-label">Caducidad</span>
                <span className="summary-value">
                  {diagnostics.summary.expirationRisk.criticalCount + diagnostics.summary.expirationRisk.warningCount} lotes
                </span>
              </div>
            </div>
          )}

          {diagnostics.summary.stockoutRisk && (
            <div className="summary-card">
              <div className="summary-icon inventory">
                <TrendingDown size={20} />
              </div>
              <div className="summary-content">
                <span className="summary-label">Quiebre Stock</span>
                <span className="summary-value">
                  {diagnostics.summary.stockoutRisk.criticalCount + diagnostics.summary.stockoutRisk.warningCount} productos
                </span>
              </div>
            </div>
          )}

          {diagnostics.summary.deadStock && (
            <div className="summary-card">
              <div className="summary-icon inventory">
                <Clock size={20} />
              </div>
              <div className="summary-content">
                <span className="summary-label">Capital Muerto</span>
                <span className="summary-value">
                  ${diagnostics.summary.deadStock.totalDeadStockValue.toFixed(0)}
                </span>
              </div>
            </div>
          )}

          {diagnostics.summary.margins && (
            <div className="summary-card">
              <div className="summary-icon pricing">
                <TrendingUp size={20} />
              </div>
              <div className="summary-content">
                <span className="summary-label">Margen Prom.</span>
                <span className="summary-value">
                  {diagnostics.summary.margins.avgMargin.toFixed(1)}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Contenido Principal */}
      <div className="diagnostics-content">
        {renderContent()}
      </div>

      {/* Footer con timestamp */}
      <div className="diagnostics-footer">
        <span className="last-update">
          <Clock size={12} />
          Actualizado: {new Date(lastRefresh).toLocaleTimeString()}
        </span>

        {diagnostics.rawData && (
          <span className="data-summary">
            {diagnostics.rawData.salesCount || 0} ventas •
            {diagnostics.rawData.menuCount || 0} productos •
            {diagnostics.rawData.batchesCount || 0} lotes
          </span>
        )}
      </div>
    </div>
  );
}
