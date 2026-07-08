/**
 * OperationalDiagnostics.jsx
 *
 * UI coordinator for operational diagnostics. Keeps the rule-based diagnostic
 * flow and the AI agent dashboard, but presents the classic view as a compact
 * mobile-first work queue instead of a card-heavy dashboard.
 */

import { memo, useMemo, useState, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
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
  danger: { icon: XCircle, className: 'alert-danger', label: 'Critico', shortLabel: 'Critico' },
  warning: { icon: AlertTriangle, className: 'alert-warning', label: 'Advertencia', shortLabel: 'Aviso' },
  info: { icon: AlertCircle, className: 'alert-info', label: 'Informacion', shortLabel: 'Info' },
  success: { icon: CheckCircle, className: 'alert-success', label: 'Correcto', shortLabel: 'OK' }
};

const CATEGORY_CONFIG = {
  revenue: { label: 'Ingresos', icon: DollarSign },
  operations: { label: 'Operacion', icon: Activity },
  inventory: { label: 'Inventario', icon: Package },
  pricing: { label: 'Precios', icon: TrendingUp }
};

const EMPTY_ARRAY = [];

const METRIC_LABELS = {
  leakageRate: 'Fuga',
  affectedTickets: 'Tickets afectados',
  potentialLostRevenue: 'Venta no capturada',
  avgDrinkPrice: 'Ticket extra promedio',
  wasteCost: 'Costo de merma',
  grossProfit: 'Utilidad bruta',
  wasteRatio: 'Peso de merma',
  currentStock: 'Stock actual',
  avgDailySales: 'Venta diaria',
  daysUntilStockout: 'Dias para agotarse',
  estimatedLostSales: 'Venta perdida estimada',
  capitalAtRisk: 'Capital en riesgo',
  batchCount: 'Lotes',
  avgDaysToExpiry: 'Dias promedio',
  productsAtRisk: 'Productos en riesgo',
  lostRevenue: 'Venta en riesgo',
  deadCapital: 'Capital detenido',
  productCount: 'Productos',
  potentialRevenue: 'Venta potencial',
  missingCostProducts: 'Sin costo',
  revenueAtRisk: 'Venta sin costo',
  criticalProducts: 'Productos criticos',
  warningProducts: 'Productos en aviso',
  avgMargin: 'Margen promedio',
  impactOnProfit: 'Impacto en utilidad',
  affectedProducts: 'Productos afectados',
  avgIncrease: 'Aumento promedio',
  totalIncrease: 'Aumento total'
};

const metricLabel = (key) => {
  if (METRIC_LABELS[key]) return METRIC_LABELS[key];
  return String(key)
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (letter) => letter.toUpperCase())
    .trim();
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
    <div className="skeleton-line short" />
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
);

const AlertCard = memo(({ alert, onNavigate }) => {
  const TypeConfig = ALERT_TYPE_CONFIG[alert.type] || ALERT_TYPE_CONFIG.info;
  const TypeIcon = TypeConfig.icon;
  const CategoryConfig = CATEGORY_CONFIG[alert.category] || { label: 'General', icon: Activity };
  const CategoryIcon = CategoryConfig.icon;

  const handleClick = useCallback(() => {
    if (alert.link) onNavigate?.(alert.link);
  }, [alert.link, onNavigate]);

  const metrics = Object.entries(alert.metrics || {}).filter(([, value]) => value !== null && value !== undefined);

  return (
    <article className={`diagnostic-alert ${TypeConfig.className}`}>
      <div className="alert-leading" aria-hidden="true">
        <TypeIcon size={18} />
      </div>

      <div className="alert-main">
        <div className="alert-meta">
          <span className="alert-type-badge">{TypeConfig.shortLabel}</span>
          <span className="alert-category">
            <CategoryIcon size={13} />
            {CategoryConfig.label}
          </span>
          {alert.priority === 1 && <span className="priority-badge">Alta</span>}
        </div>

        <div className="alert-body">
          <h4 className="alert-title">{alert.title}</h4>
          <p className="alert-message">{alert.message}</p>
        </div>

        {metrics.length > 0 && (
          <dl className="alert-metrics">
            {metrics.map(([key, value]) => (
              <div key={key} className="metric-item">
                <dt className="metric-label">{metricLabel(key)}</dt>
                <dd className="metric-value">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="alert-footer">
          <p className="alert-action">
            <CheckCircle size={14} />
            <span>{alert.action}</span>
          </p>

          {alert.link && (
            <button className="alert-action-button" type="button" onClick={handleClick}>
              Revisar
              <TrendingUp size={14} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
});

AlertCard.displayName = 'AlertCard';

const NoAlertsState = ({ businessType }) => {
  const typeConfig = BUSINESS_TYPE_MAPPING[businessType] || { label: 'Negocio' };

  return (
    <div className="no-alerts-state">
      <div className="no-alerts-icon">
        <CheckCircle size={26} />
      </div>
      <div>
        <h3 className="no-alerts-title">Operacion sin avisos</h3>
        <p className="no-alerts-message">
          No se detectaron alertas operativas para {typeConfig.label}.
        </p>
        <p className="no-alerts-hint">
          Sigue registrando ventas para mantener el diagnostico actualizado.
        </p>
      </div>
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
    <label className="business-type-selector">
      <span className="selector-label">
        <Activity size={14} />
        Rubro
      </span>
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
    </label>
  );
};

const SummaryMetric = ({ icon: Icon, label, value, theme }) => (
  <div className={`summary-metric ${theme}`}>
    <Icon size={16} />
    <span className="summary-label">{label}</span>
    <strong className="summary-value">{value}</strong>
  </div>
);

export default function OperationalDiagnostics({
  allowRubroOverride = false,
  onNavigate,
  sales = EMPTY_ARRAY,
  menu = EMPTY_ARRAY,
  customers = EMPTY_ARRAY,
  wasteLogs = EMPTY_ARRAY
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
  const effectiveShowAIAgent = Boolean(showAIAgent && canUseAIAgents);

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
    if (!canUseAIAgents && !effectiveShowAIAgent) return;
    setShowAIAgent(prev => !prev);
  }, [canUseAIAgents, effectiveShowAIAgent]);

  const currentTypeConfig = BUSINESS_TYPE_MAPPING[businessTypeString] || { label: 'Negocio', icon: Activity };
  const TypeIcon = currentTypeConfig.icon;

  const summaryItems = useMemo(() => {
    const summary = diagnostics.summary;
    if (!summary || diagnostics.isLoading) return [];

    return [
      summary.ticketLeakage && {
        icon: DollarSign,
        label: 'Fuga ticket',
        value: `${Math.round(summary.ticketLeakage.leakageRate * 100)}%`,
        theme: 'revenue'
      },
      summary.wasteImpact && {
        icon: Activity,
        label: 'Merma',
        value: `${Math.round(summary.wasteImpact.wasteRatio * 100)}%`,
        theme: 'operations'
      },
      summary.expirationRisk && {
        icon: Package,
        label: 'Caducidad',
        value: `${summary.expirationRisk.criticalCount + summary.expirationRisk.warningCount} lotes`,
        theme: 'inventory'
      },
      summary.stockoutRisk && {
        icon: TrendingDown,
        label: 'Stock',
        value: `${summary.stockoutRisk.criticalCount + summary.stockoutRisk.warningCount} productos`,
        theme: 'inventory'
      },
      summary.deadStock && {
        icon: Clock,
        label: 'Capital muerto',
        value: `$${summary.deadStock.totalDeadStockValue.toFixed(0)}`,
        theme: 'inventory'
      },
      summary.margins && {
        icon: TrendingUp,
        label: 'Margen prom.',
        value: `${summary.margins.avgMargin.toFixed(1)}%`,
        theme: 'pricing'
      }
    ].filter(Boolean);
  }, [diagnostics.summary, diagnostics.isLoading]);

  const statusText = effectiveShowAIAgent
    ? 'Analisis con agentes IA'
    : `${diagnostics.summary?.totalAlerts || 0} alertas${diagnostics.summary?.criticalCount > 0 ? `, ${diagnostics.summary.criticalCount} criticas` : ''}`;

  const renderClassicContent = () => {
    if (diagnostics.isLoading) return <DiagnosticSkeleton />;

    if (diagnostics.error) {
      return (
        <div className="diagnostic-error">
          <AlertCircle size={30} />
          <h3>Error en diagnostico</h3>
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
    <section className="operational-diagnostics" aria-label="Diagnostico operativo">
      <header className="diagnostics-header">
        <div className="header-content">
          <div className="header-icon-wrapper" aria-hidden="true">
            {effectiveShowAIAgent ? <Bot size={22} className="header-icon" /> : <TypeIcon size={22} className="header-icon" />}
          </div>
          <div className="header-text">
            <span className="header-kicker">{effectiveShowAIAgent ? 'Modo IA' : currentTypeConfig.label}</span>
            <h2 className="header-title">
              {effectiveShowAIAgent ? 'Agentes de IA' : 'Diagnostico operativo'}
            </h2>
            <p className="header-subtitle">{statusText}</p>
          </div>
        </div>

        <div className="header-actions">
          {canUseAIAgents && (
            <button
              className={`mode-toggle-button ${effectiveShowAIAgent ? 'is-diagnostic-entry' : 'is-ai-entry'}`}
              onClick={handleToggleMode}
              type="button"
              aria-label={effectiveShowAIAgent ? 'Ver diagnostico operativo' : 'Activar agente IA'}
            >
              {effectiveShowAIAgent ? (
                <>
                  <span className="mode-toggle-icon" aria-hidden="true">
                    <BrainCircuit size={18} />
                  </span>
                  <span className="mode-toggle-copy">
                    <span className="mode-toggle-kicker">Volver a accion</span>
                    <strong>Diagnostico operativo</strong>
                    <small>Alertas claras para decidir ahora</small>
                  </span>
                  <ArrowLeft size={16} className="mode-toggle-arrow" aria-hidden="true" />
                </>
              ) : (
                <>
                  <span className="mode-toggle-icon" aria-hidden="true">
                    <Bot size={18} />
                  </span>
                  <span className="mode-toggle-copy">
                    <span className="mode-toggle-kicker">Analisis avanzado</span>
                    <strong>Activar Agente IA</strong>
                    <small>Detecta oportunidades con mas contexto</small>
                  </span>
                  <ArrowRight size={16} className="mode-toggle-arrow" aria-hidden="true" />
                </>
              )}
            </button>
          )}

          {allowRubroOverride && (
            <BusinessTypeSelector currentType={businessTypeString} onSelect={setRubroOverride} />
          )}

          {!effectiveShowAIAgent && (
            <button
              className="refresh-button-small"
              onClick={handleRefresh}
              disabled={diagnostics.isLoading}
              type="button"
              aria-label="Actualizar diagnostico"
              title="Actualizar diagnostico"
            >
              {diagnostics.isLoading ? <Loader2 size={18} className="spinning" /> : <RefreshCw size={18} />}
            </button>
          )}
        </div>
      </header>

      {!effectiveShowAIAgent && summaryItems.length > 0 && (
        <div className="diagnostics-summary" aria-label="Resumen del diagnostico">
          {summaryItems.map((item) => (
            <SummaryMetric
              key={`${item.label}-${item.value}`}
              icon={item.icon}
              label={item.label}
              value={item.value}
              theme={item.theme}
            />
          ))}
        </div>
      )}

      <div className="diagnostics-content">
        {effectiveShowAIAgent ? (
          <AIAgentDashboard
            sales={sales}
            menu={menu}
            customers={customers}
            wasteLogs={wasteLogs}
            businessType={businessTypeArray}
          />
        ) : renderClassicContent()}
      </div>

      <footer className="diagnostics-footer">
        <span className="last-update">
          <Clock size={12} />
          Actualizado {new Date(lastRefresh).toLocaleTimeString()}
        </span>

        {diagnostics.rawData && (
          <span className="data-summary">
            {diagnostics.rawData.salesCount || 0} ventas / {diagnostics.rawData.menuCount || diagnostics.rawData.inventoryCount || 0} productos / {diagnostics.rawData.batchesCount || 0} lotes
          </span>
        )}
      </footer>
    </section>
  );
}
