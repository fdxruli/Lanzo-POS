/**
 * OperationalDiagnostics.jsx
 *
 * Orquestador de UI para diagnóstico operativo del negocio.
 * Alterna entre diagnóstico clásico basado en reglas duras y el dashboard de agentes de IA.
 * Los agentes IA quedan disponibles solo cuando la licencia trae ai_agents=true.
 */

import React, { useMemo, useState, useCallback, useEffect } from 'react';
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
import { useRestaurantDiagnostics } from '../../hooks/diagnostics/useRestaurantDiagnostics';
import { usePharmacyDiagnostics } from '../../hooks/diagnostics/usePharmacyDiagnostics';
import { useRetailDiagnostics } from '../../hooks/diagnostics/useRetailDiagnostics';
import AIAgentDashboard from './AIAgentDashboard';
import AIAgentUsageLegend from './AIAgentUsageLegend';
import { normalizeBusinessType, normalizeBusinessTypes } from '../../utils/businessType';
import './OperationalDiagnostics.css';

const BUSINESS_TYPE_MAPPING = {
  food_service: { diagnosticType: 'restaurant', label: 'Restaurante / Cocina', icon: ChefHat },
  'verduleria/fruteria': { diagnosticType: 'restaurant', label: 'Fruteria / Verduleria', icon: ShoppingCart },
  farmacia: { diagnosticType: 'pharmacy', label: 'Farmacia', icon: Pill },
  abarrotes: { diagnosticType: 'retail', label: 'Abarrotes', icon: ShoppingCart },
  apparel: { diagnosticType: 'retail', label: 'Ropa', icon: ShoppingCart },
  hardware: { diagnosticType: 'retail', label: 'Ferreteria', icon: ShoppingCart },
  otro: { diagnosticType: 'retail', label: 'Negocio', icon: ShoppingCart }
};

const DIAGNOSTIC_HOOKS = {
  restaurant: useRestaurantDiagnostics,
  pharmacy: usePharmacyDiagnostics,
  retail: useRetailDiagnostics
};

const ALERT_TYPE_CONFIG = {
  danger: { icon: XCircle, className: 'alert-danger', label: 'Crítico' },
  warning: { icon: AlertTriangle, className: 'alert-warning', label: 'Advertencia' },
  info: { icon: AlertCircle, className: 'alert-info', label: 'Información' },
  success: { icon: CheckCircle, className: 'alert-success', label: 'Correcto' }
};

const CATEGORY_CONFIG = {
  revenue: { label: 'Ingresos', icon: DollarSign },
  operations: { label: 'Operaciones', icon: Activity },
  inventory: { label: 'Inventario', icon: Package },
  pricing: { label: 'Precios', icon: TrendingUp }
};

const hasAIAgentsEntitlement = (licenseDetails) => {
  if (!licenseDetails?.valid) return false;

  const features = licenseDetails.features || {};
  const planCode = String(
    licenseDetails.plan_code ||
    licenseDetails.planCode ||
    licenseDetails.plan ||
    ''
  ).toLowerCase();

  return (
    features.ai_agents === true ||
    licenseDetails.ai_agents === true ||
    planCode.includes('pro')
  );
};

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

const AlertCard = React.memo(({ alert, onNavigate }) => {
  const TypeConfig = ALERT_TYPE_CONFIG[alert.type] || ALERT_TYPE_CONFIG.info;
  const TypeIcon = TypeConfig.icon;
  const CategoryConfig = CATEGORY_CONFIG[alert.category] || { label: 'General', icon: Activity };
  const CategoryIcon = CategoryConfig.icon;

  const handleClick = useCallback(() => {
    if (alert.link) onNavigate?.(alert.link);
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
          {String(alert.message || '').split('\n').map((line, index, arr) => (
            <React.Fragment key={`${alert.id}-line-${index}`}>
              {line}
              {index < arr.length - 1 && <br />}
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
            Ir ahora
            <TrendingUp size={14} />
          </button>
        )}
      </div>
    </div>
  );
});

AlertCard.displayName = 'AlertCard';

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

const BusinessTypeSelector = ({ currentType, onSelect }) => {
  const types = useMemo(() => {
    return Object.entries(BUSINESS_TYPE_MAPPING).map(([type, config]) => ({
      ...config,
      type
    }));
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

const SummaryCard = ({ icon: Icon, label, value, theme }) => (
  <div className="summary-card">
    <div className={`summary-icon ${theme}`}>
      <Icon size={20} />
    </div>
    <div className="summary-content">
      <span className="summary-label">{label}</span>
      <span className="summary-value">{value}</span>
    </div>
  </div>
);

export default function OperationalDiagnostics({
  allowRubroOverride = false,
  onNavigate,
  sales = [],
  menu = [],
  customers = [],
  wasteLogs = []
}) {
  const [rubroOverride, setRubroOverride] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(() => Date.now());
  const [showAIAgent, setShowAIAgent] = useState(false);

  const companyProfile = useAppStore(state => state.companyProfile);
  const licenseDetails = useAppStore(state => state.licenseDetails);

  const businessTypeString = useMemo(() => {
    if (rubroOverride) return normalizeBusinessType(rubroOverride, 'abarrotes');
    return normalizeBusinessTypes(companyProfile?.business_type, 'abarrotes')[0];
  }, [companyProfile, rubroOverride]);

  const businessTypeArray = useMemo(() => [businessTypeString], [businessTypeString]);
  const diagnosticType = BUSINESS_TYPE_MAPPING[businessTypeString]?.diagnosticType || 'retail';
  const DiagnosticHook = DIAGNOSTIC_HOOKS[diagnosticType] || DIAGNOSTIC_HOOKS.retail;
  const diagnostics = DiagnosticHook(lastRefresh);
  const canUseAIAgents = useMemo(() => hasAIAgentsEntitlement(licenseDetails), [licenseDetails]);

  useEffect(() => {
    if (!canUseAIAgents && showAIAgent) {
      setShowAIAgent(false);
    }
  }, [canUseAIAgents, showAIAgent]);

  const handleNavigate = useCallback((link) => {
    if (onNavigate) {
      onNavigate(link);
    } else {
      window.location.href = link;
    }
  }, [onNavigate]);

  const handleRefresh = useCallback(() => {
    setLastRefresh(Date.now());
  }, []);

  const handleToggleMode = useCallback(() => {
    if (!canUseAIAgents && !showAIAgent) return;
    setShowAIAgent(prev => !prev);
  }, [canUseAIAgents, showAIAgent]);

  const currentTypeConfig = BUSINESS_TYPE_MAPPING[businessTypeString] || { label: 'Negocio', icon: Activity };
  const TypeIcon = currentTypeConfig.icon;

  const renderClassicContent = () => {
    if (diagnostics.isLoading) return <DiagnosticSkeleton />;

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

    if (!diagnostics.alerts || diagnostics.alerts.length === 0) {
      return <NoAlertsState businessType={businessTypeString} />;
    }

    return (
      <div className="alerts-list">
        {diagnostics.alerts.map(alert => (
          <AlertCard key={alert.id} alert={alert} onNavigate={handleNavigate} />
        ))}
      </div>
    );
  };

  return (
    <div className="operational-diagnostics">
      <div className="diagnostics-header">
        <div className="header-content">
          <div className="header-icon-wrapper">
            {showAIAgent ? <Bot size={28} className="header-icon" /> : <TypeIcon size={28} className="header-icon" />}
          </div>
          <div className="header-text">
            <h2 className="header-title">
              {showAIAgent ? 'Agentes de IA' : 'Diagnóstico Operativo'}
            </h2>
            <p className="header-subtitle">
              {showAIAgent
                ? 'Análisis inteligente con contexto de tu negocio'
                : `${currentTypeConfig.label} • ${diagnostics.summary?.totalAlerts || 0} alertas${diagnostics.summary?.criticalCount > 0 ? ` (${diagnostics.summary.criticalCount} críticas)` : ''}`
              }
            </p>
          </div>
        </div>

        <div className="header-actions">
          {canUseAIAgents && (
            <button className="mode-toggle-button" onClick={handleToggleMode} type="button">
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
          )}

          {allowRubroOverride && (
            <BusinessTypeSelector currentType={businessTypeString} onSelect={setRubroOverride} />
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
              {diagnostics.isLoading ? <Loader2 size={18} className="spinning" /> : <RefreshCw size={18} />}
            </button>
          )}
        </div>
      </div>

      {!showAIAgent && diagnostics.summary && !diagnostics.isLoading && (
        <div className="diagnostics-summary">
          {diagnostics.summary.ticketLeakage && (
            <SummaryCard
              icon={DollarSign}
              label="Fuga de Ticket"
              value={`${Math.round(diagnostics.summary.ticketLeakage.leakageRate * 100)}%`}
              theme="revenue"
            />
          )}

          {diagnostics.summary.wasteImpact && (
            <SummaryCard
              icon={Activity}
              label="Merma"
              value={`${Math.round(diagnostics.summary.wasteImpact.wasteRatio * 100)}%`}
              theme="operations"
            />
          )}

          {diagnostics.summary.expirationRisk && (
            <SummaryCard
              icon={Package}
              label="Caducidad"
              value={`${diagnostics.summary.expirationRisk.criticalCount + diagnostics.summary.expirationRisk.warningCount} lotes`}
              theme="inventory"
            />
          )}

          {diagnostics.summary.stockoutRisk && (
            <SummaryCard
              icon={TrendingDown}
              label="Quiebre Stock"
              value={`${diagnostics.summary.stockoutRisk.criticalCount + diagnostics.summary.stockoutRisk.warningCount} productos`}
              theme="inventory"
            />
          )}

          {diagnostics.summary.deadStock && (
            <SummaryCard
              icon={Clock}
              label="Capital Muerto"
              value={`$${diagnostics.summary.deadStock.totalDeadStockValue.toFixed(0)}`}
              theme="inventory"
            />
          )}

          {diagnostics.summary.margins && (
            <SummaryCard
              icon={TrendingUp}
              label="Margen Prom."
              value={`${diagnostics.summary.margins.avgMargin.toFixed(1)}%`}
              theme="pricing"
            />
          )}
        </div>
      )}

      <div className="diagnostics-content">
        {showAIAgent && canUseAIAgents ? (
          <>
            <AIAgentUsageLegend enabled={canUseAIAgents} />
            <AIAgentDashboard
              sales={sales}
              menu={menu}
              customers={customers}
              wasteLogs={wasteLogs}
              businessType={businessTypeArray}
            />
          </>
        ) : renderClassicContent()}
      </div>

      <div className="diagnostics-footer">
        <span className="last-update">
          <Clock size={12} />
          Actualizado: {new Date(lastRefresh).toLocaleTimeString()}
        </span>

        {diagnostics.rawData && (
          <span className="data-summary">
            {diagnostics.rawData.salesCount || 0} ventas •
            {diagnostics.rawData.menuCount || diagnostics.rawData.inventoryCount || 0} productos •
            {diagnostics.rawData.batchesCount || 0} lotes
          </span>
        )}
      </div>
    </div>
  );
}
