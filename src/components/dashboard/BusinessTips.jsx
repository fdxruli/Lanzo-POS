// src/components/dashboard/BusinessTips.jsx
import React, { useMemo, useState, useCallback } from 'react';
import { 
  Star, TrendingUp, AlertTriangle, Lightbulb, DollarSign, Package, Users, 
  Target, Zap, Clock, ChefHat, Percent, Activity, CheckCircle, Info, BrainCircuit,
  TrendingDown, Calendar, ArrowRight
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useSalesStore } from '../../store/useSalesStore';

// ============================================================
// 1. CONFIGURACIÓN Y CONSTANTES (Sin números mágicos)
// ============================================================
const CONFIG = {
  MIN_SALES_FOR_ANALYSIS: 10,
  MIN_SALES_FOR_COMBOS: 20,
  THRESHOLDS: {
    HIGH_WASTE_PERCENT: 4,
    LOW_MARGIN_PERCENT: 15,
    HEALTHY_MARGIN_MIN: 20,
    HEALTHY_MARGIN_EXCELLENT: 30,
    MISSING_COST_WARNING_PERCENT: 30,
    CASH_FLOW_RATIO: 5, // Deuda vs Venta Diaria
    DEAD_STOCK_AMOUNT: 2000,
    MOMENTUM_GROWTH: 1.2, // 20% crecimiento
    MOMENTUM_DROP: 0.8    // 20% caída
  }
};

const TIP_TYPES = {
  DANGER: 'danger',
  WARNING: 'warning',
  SUCCESS: 'success',
  INFO: 'info',
  INTRO: 'intro'
};

// ============================================================
// 2. HELPERS PUROS (Lógica de negocio aislada)
// ============================================================

/**
 * Normaliza y compara fechas para ventanas de tiempo
 */
const getDateDiffDays = (dateFrom, dateTo = new Date()) => {
  return (dateTo - new Date(dateFrom)) / (1000 * 60 * 60 * 24);
};

/**
 * Genera un mapa de estadísticas agregado en una sola iteración
 */
const aggregateSalesData = (sales) => {
  let totalRevenue = 0;
  let totalCost = 0;
  let itemsCount = 0;
  let productsWithoutCost = 0;
  
  const productStats = new Map(); // ID -> { qty, revenue, name }
  const dayStats = new Map();     // DayName -> Revenue
  const timeWindows = {
    last7d: 0,
    last30d: 0,
    prevMonth: 0 // 30-60 días atrás
  };

  sales.forEach(sale => {
    const saleTotal = sale.total || 0;
    totalRevenue += saleTotal;
    
    // Análisis temporal
    const daysAgo = getDateDiffDays(sale.timestamp);
    if (daysAgo <= 7) timeWindows.last7d += saleTotal;
    if (daysAgo <= 30) timeWindows.last30d += saleTotal;
    else if (daysAgo <= 60) timeWindows.prevMonth += saleTotal;

    // Análisis por día de semana
    const dayName = new Date(sale.timestamp).toLocaleDateString('es-MX', { weekday: 'long' });
    const capDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    dayStats.set(capDay, (dayStats.get(capDay) || 0) + saleTotal);

    // Análisis de items
    sale.items?.forEach(item => {
      itemsCount++;
      const cost = item.cost || 0;
      if (cost === 0) productsWithoutCost++;
      totalCost += (cost * item.quantity);

      const id = item.parentId || item.id;
      const current = productStats.get(id) || { qty: 0, revenue: 0, name: item.name };
      productStats.set(id, {
        qty: current.qty + item.quantity,
        revenue: current.revenue + ((item.price || 0) * item.quantity),
        name: item.name
      });
    });
  });

  return {
    totalRevenue,
    totalCost,
    itemsCount,
    productsWithoutCost,
    productStats,
    dayStats,
    timeWindows
  };
};

// ============================================================
// 3. ANALIZADORES ESPECÍFICOS (Separación de responsabilidades)
// ============================================================

const analyzeFinancialHealth = (data, tips) => {
  const { totalRevenue, totalCost, itemsCount, productsWithoutCost } = data;
  
  // Calidad de datos
  const missingCostPct = itemsCount > 0 ? (productsWithoutCost / itemsCount) * 100 : 0;
  if (missingCostPct > CONFIG.THRESHOLDS.MISSING_COST_WARNING_PERCENT) {
    tips.push({
      id: 'missing-costs',
      type: TIP_TYPES.WARNING,
      icon: 'DollarSign',
      priority: 1,
      title: 'Calibración de Ganancias',
      message: `El ${missingCostPct.toFixed(0)}% de tus productos vendidos no tienen costo registrado. La utilidad calculada no será real.`,
      suggestions: ['Edita tus productos y agrega el "Costo de Compra".', 'Usa la herramienta "Reparar Ganancias" en Configuración.'],
      action: { label: 'Ir a Productos', link: '/productos' }
    });
  }

  // Margen Global (Red de seguridad)
  const globalProfit = totalRevenue - totalCost;
  const globalMargin = totalRevenue > 0 ? (globalProfit / totalRevenue) * 100 : 0;
  
  if (tips.length === 0) { // Solo si no hay alertas más graves
    const isHealthy = globalMargin >= CONFIG.THRESHOLDS.HEALTHY_MARGIN_MIN;
    const isExcellent = globalMargin >= CONFIG.THRESHOLDS.HEALTHY_MARGIN_EXCELLENT;
    
    tips.push({
      id: 'margin-analysis',
      type: isExcellent ? TIP_TYPES.SUCCESS : (isHealthy ? TIP_TYPES.INFO : TIP_TYPES.WARNING),
      icon: isHealthy ? 'CheckCircle' : 'Target',
      priority: 10, // Baja prioridad
      title: isHealthy ? 'Salud del Negocio: Estable' : 'Objetivo: Mejorar Margen',
      message: `Tu margen global es del ${globalMargin.toFixed(1)}%. ${globalMargin < 20 ? 'Busca llegar al 20-30%.' : 'Estás en un rango saludable.'}`,
      suggestions: isHealthy 
        ? ['Mantén el control de costos.', 'Explora productos premium.'] 
        : ['Revisa costos con proveedores.', 'Reduce mermas.', 'Promociona productos rentables.']
    });
  }
};

const analyzeTrends = (data, tips) => {
  const { timeWindows } = data;
  const avgWeekly = timeWindows.last30d / 4;

  if (timeWindows.last30d > 1000) {
    // Momentum
    if (timeWindows.last7d > avgWeekly * CONFIG.THRESHOLDS.MOMENTUM_GROWTH) {
      const growth = ((timeWindows.last7d / avgWeekly - 1) * 100).toFixed(0);
      tips.push({
        id: 'momentum-up', type: TIP_TYPES.SUCCESS, icon: 'TrendingUp', priority: 2,
        title: `¡Impulso Semanal! (+${growth}%)`,
        message: 'Tus ventas recientes superan tu promedio habitual.',
        suggestions: ['Asegura stock de lo más vendido.', 'Aprovecha el tráfico para fidelizar.']
      });
    } else if (timeWindows.last7d < avgWeekly * CONFIG.THRESHOLDS.MOMENTUM_DROP && timeWindows.last7d > 0) {
      const drop = ((1 - timeWindows.last7d / avgWeekly) * 100).toFixed(0);
      tips.push({
        id: 'momentum-down', type: TIP_TYPES.WARNING, icon: 'TrendingDown', priority: 3,
        title: `Semana Lenta (-${drop}%)`,
        message: 'Las ventas recientes están por debajo de tu promedio.',
        suggestions: ['Contacta a clientes frecuentes.', 'Verifica si te falta stock clave.']
      });
    }

    // Crecimiento Mensual
    if (timeWindows.prevMonth > 0) {
      const growth = ((timeWindows.last30d - timeWindows.prevMonth) / timeWindows.prevMonth) * 100;
      tips.push({
        id: 'monthly-growth',
        type: growth > 0 ? TIP_TYPES.SUCCESS : TIP_TYPES.INFO,
        icon: growth > 0 ? 'TrendingUp' : 'Activity',
        priority: 4,
        title: growth > 0 ? `Crecimiento Mensual (+${growth.toFixed(1)}%)` : `Comparativa Mensual (${growth.toFixed(1)}%)`,
        message: `Este mes ${growth > 0 ? 'subiste' : 'variaste'} ventas respecto al mes anterior.`,
        suggestions: growth > 0 ? ['Identifica qué funcionó y repítelo.'] : ['Analiza factores externos (clima, fechas).']
      });
    }
  }
};

const analyzeOperations = (data, tips, customers, sales, wasteLogs, businessType) => {
  // Flujo de Caja (Deuda)
  const totalDebt = customers.reduce((sum, c) => sum + (c.debt || 0), 0);
  const dailyAvg = sales.length > 0 ? data.totalRevenue / sales.length : 0; // Aproximación simple

  if (dailyAvg > 0 && totalDebt > dailyAvg * CONFIG.THRESHOLDS.CASH_FLOW_RATIO) {
    tips.push({
      id: 'cash-flow', type: TIP_TYPES.DANGER, icon: 'AlertTriangle', priority: 1,
      title: 'Alerta de Flujo de Caja',
      message: `Tienes $${totalDebt.toFixed(2)} en deuda pendiente. Es alto comparado con tu venta promedio.`,
      suggestions: ['Envía recordatorios de cobro.', 'Limita nuevos créditos.'],
      action: { label: 'Ver Deudores', link: '/clientes' }
    });
  }

  // Día Estrella
  const bestDay = Array.from(data.dayStats.entries()).sort((a, b) => b[1] - a[1])[0];
  if (bestDay) {
    tips.push({
      id: 'peak-day', type: TIP_TYPES.INFO, icon: 'Calendar', priority: 6,
      title: `Día Fuerte: ${bestDay[0]}`,
      message: `Históricamente, los ${bestDay[0]} son tus mejores días.`,
      suggestions: ['Prepara stock extra el día anterior.', 'Programa personal de refuerzo.']
    });
  }

  // Mermas (Solo Restaurantes/Comida)
  if (businessType.some(t => t.includes('food') || t.includes('fruteria'))) {
    const totalWaste = wasteLogs.reduce((sum, w) => sum + (w.lossAmount || 0), 0);
    const wasteRatio = data.totalRevenue > 0 ? (totalWaste / data.totalRevenue) * 100 : 0;
    
    if (wasteRatio > CONFIG.THRESHOLDS.HIGH_WASTE_PERCENT) {
      tips.push({
        id: 'high-waste', type: TIP_TYPES.DANGER, icon: 'ChefHat', priority: 2,
        title: `Merma Alta (${wasteRatio.toFixed(1)}%)`,
        message: `Estás perdiendo $${totalWaste.toFixed(2)} en desperdicios.`,
        action: { label: 'Revisar Mermas', link: '/ventas' }
      });
    }
  }
};

const analyzeInventoryInsights = (data, tips, menu, businessType) => {
  // Inventario Estancado (Dead Stock) - Solo para Retail
  if (businessType.some(t => ['abarrotes', 'tienda', 'apparel', 'hardware'].includes(t))) {
    let deadStockMoney = 0;
    let count = 0;
    
    // Nota: Esto solo detecta productos que NO se han vendido en el periodo de 'sales' cargado.
    // Si 'sales' es pequeño, esto podría dar falsos positivos. Idealmente se necesita 'lastSaleDate' en el producto.
    menu.forEach(p => {
      if (p.stock > 0 && !data.productStats.has(p.id)) {
        count++;
        deadStockMoney += ((p.cost || 0) * p.stock);
      }
    });

    if (deadStockMoney > CONFIG.THRESHOLDS.DEAD_STOCK_AMOUNT) {
      tips.push({
        id: 'dead-stock', type: TIP_TYPES.WARNING, icon: 'Package', priority: 5,
        title: `Capital Congelado: $${deadStockMoney.toFixed(0)}`,
        message: `Tienes ${count} productos con stock que no se han vendido recientemente.`,
        suggestions: ['Arma ofertas de liquidación.', 'Mejora la exhibición de estos productos.']
      });
    }
  }

  // Producto "Falso Amigo" (Alto volumen, bajo margen)
  let falseFriend = null;
  for (const [id, stat] of data.productStats.entries()) {
    const prod = menu.find(p => p.id === id);
    if (prod && prod.price > 0 && prod.cost > 0) {
      const margin = (prod.price - prod.cost) / prod.price;
      if (stat.qty > 10 && margin * 100 < CONFIG.THRESHOLDS.LOW_MARGIN_PERCENT) {
        falseFriend = prod;
        break; // Encontramos uno, suficiente para el tip
      }
    }
  }

  if (falseFriend) {
    tips.push({
      id: 'false-friend', type: TIP_TYPES.INFO, icon: 'Activity', priority: 5,
      title: `Optimización: ${falseFriend.name}`,
      message: 'Es un producto popular pero deja poco margen (<15%).',
      suggestions: ['Sube ligeramente el precio.', 'Negocia mejor costo con el proveedor.', 'Úsalo como gancho para vender otros productos.']
    });
  }
};

// ============================================================
// 4. CUSTOM HOOK (Lógica principal)
// ============================================================

const useBusinessIntelligence = (sales, menu, customers, wasteLogs, businessType) => {
  return useMemo(() => {
    const tips = [];

    // Nivel 0: Sin datos
    if (!sales || sales.length === 0) {
      return [{
        id: 'welcome', type: TIP_TYPES.INTRO, icon: 'Zap', priority: 1,
        title: '🚀 Iniciando Motores',
        message: 'El sistema de inteligencia está activo. Registra tus primeras ventas para recibir análisis.',
        action: { label: 'Ir a Punto de Venta', link: '/' }
      }];
    }

    // Nivel 1: Modo Aprendizaje
    if (sales.length < CONFIG.MIN_SALES_FOR_ANALYSIS) {
      tips.push({
        id: 'learning', type: TIP_TYPES.INFO, icon: 'BrainCircuit', priority: 1,
        title: 'Calibrando Algoritmo...',
        message: `Analizando ${sales.length} ventas. Necesito un poco más de historia para detectar tendencias confiables.`
      });
      return tips;
    }

    // Ejecución de análisis
    const aggregatedData = aggregateSalesData(sales);
    
    analyzeFinancialHealth(aggregatedData, tips);
    analyzeTrends(aggregatedData, tips);
    analyzeOperations(aggregatedData, tips, customers, sales, wasteLogs, businessType);
    analyzeInventoryInsights(aggregatedData, tips, menu, businessType);

    // Ordenar por prioridad (menor número = mayor prioridad)
    return tips.sort((a, b) => a.priority - b.priority);

  }, [sales, menu, customers, wasteLogs, businessType]);
};

// ============================================================
// 5. SUB-COMPONENTES DE PRESENTACIÓN
// ============================================================

const getIconComponent = (iconName) => {
  const IconMap = {
    Star, TrendingUp, AlertTriangle, Lightbulb, DollarSign, Package, Users,
    Target, Zap, Clock, ChefHat, Percent, Activity, CheckCircle, Info, BrainCircuit,
    TrendingDown, Calendar
  };
  const Icon = IconMap[iconName] || Lightbulb;
  return <Icon size={24} />;
};

const getCardStyles = (type) => {
  const isLight = type === TIP_TYPES.INFO;
  // Definimos estilos base usando variables CSS para consistencia con el tema
  const variants = {
    [TIP_TYPES.DANGER]: { 
      background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)', 
      borderColor: '#7f1d1d', textColor: 'white' 
    },
    [TIP_TYPES.WARNING]: { 
      background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', 
      borderColor: '#b45309', textColor: 'white' 
    },
    [TIP_TYPES.SUCCESS]: { 
      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
      borderColor: '#047857', textColor: 'white' 
    },
    [TIP_TYPES.INTRO]: { 
      background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', 
      borderColor: '#3730a3', textColor: 'white' 
    },
    [TIP_TYPES.INFO]: { 
      background: 'var(--card-background-color)', 
      borderColor: 'var(--secondary-color)', textColor: 'var(--text-dark)' 
    }
  };
  return { ...variants[type], isLight };
};

const TipCard = ({ tip, isExpanded, onToggle }) => {
  const styles = getCardStyles(tip.type);
  const Icon = getIconComponent(tip.icon);

  return (
    <div
      onClick={tip.suggestions ? onToggle : undefined}
      role={tip.suggestions ? "button" : "article"}
      tabIndex={tip.suggestions ? 0 : -1}
      className={`tip-card ${isExpanded ? 'expanded' : ''}`}
      style={{
        background: styles.background,
        color: styles.textColor,
        border: `1px solid ${styles.isLight ? 'var(--border-color)' : styles.borderColor}`,
        borderLeft: `5px solid ${styles.borderColor}`,
        borderRadius: '12px',
        padding: '1.25rem',
        marginBottom: '1rem',
        cursor: tip.suggestions ? 'pointer' : 'default',
        boxShadow: styles.isLight ? 'none' : '0 4px 12px rgba(0,0,0,0.15)',
        position: 'relative',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease'
      }}
    >
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        <div style={{
          backgroundColor: styles.isLight ? 'var(--light-background)' : 'rgba(255,255,255,0.2)',
          color: styles.isLight ? 'var(--secondary-color)' : 'white',
          borderRadius: '10px',
          padding: '0.6rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          {Icon}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
            <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '700' }}>{tip.title}</h4>
            {tip.priority <= 2 && (
              <span style={{
                backgroundColor: styles.isLight ? styles.borderColor : 'rgba(255,255,255,0.3)',
                color: styles.isLight ? 'white' : 'inherit',
                padding: '2px 8px', borderRadius: '12px', fontSize: '0.65rem',
                fontWeight: 'bold', textTransform: 'uppercase'
              }}>
                Relevante
              </span>
            )}
          </div>

          <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.5', opacity: 0.95 }}>
            {tip.message}
          </p>

          {tip.suggestions && isExpanded && (
            <div style={{ 
              marginTop: '1rem', 
              padding: '12px', 
              backgroundColor: styles.isLight ? 'var(--light-background)' : 'rgba(0,0,0,0.15)', 
              borderRadius: '8px',
              animation: 'fadeIn 0.3s ease-out'
            }}>
              <p style={{ fontWeight: 'bold', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '8px', opacity: 0.8 }}>
                Acciones Recomendadas:
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
                {tip.suggestions.map((s, i) => <li key={i} style={{ marginBottom: '4px' }}>{s}</li>)}
              </ul>
              
              {tip.action && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.location.href = tip.action.link;
                  }}
                  style={{
                    marginTop: '12px',
                    width: '100%',
                    padding: '8px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: styles.isLight ? 'var(--secondary-color)' : 'white',
                    color: styles.isLight ? 'white' : styles.borderColor,
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px'
                  }}
                >
                  {tip.action.label} <ArrowRight size={16} />
                </button>
              )}
            </div>
          )}

          {tip.suggestions && !isExpanded && (
            <div style={{ marginTop: '0.8rem', fontSize: '0.75rem', opacity: 0.8, display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span>▼ Toca para ver recomendaciones</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 6. COMPONENTE PRINCIPAL
// ============================================================

export default function BusinessTips({ sales, menu, customers }) {
  const [expandedTipId, setExpandedTipId] = useState(null);
  
  // Consumimos stores necesarios
  const wasteLogs = useSalesStore(state => state.wasteLogs);
  const companyProfile = useAppStore(state => state.companyProfile);
  
  // Memoizamos el tipo de negocio
  const businessType = useMemo(() => {
    let types = companyProfile?.business_type || [];
    if (typeof types === 'string') types = types.split(',').map(s => s.trim().toLowerCase());
    return types;
  }, [companyProfile?.business_type]);

  // Obtenemos los tips del hook
  const tips = useBusinessIntelligence(sales, menu, customers, wasteLogs, businessType);

  const handleToggle = useCallback((id) => {
    setExpandedTipId(prev => prev === id ? null : id);
  }, []);

  return (
    <div className="business-tips-container" style={{
      backgroundColor: 'var(--card-background-color)',
      borderRadius: '16px',
      padding: '1.5rem',
      boxShadow: 'var(--box-shadow)',
      border: '1px solid var(--border-color)',
      height: '100%'
    }}>
      <h3 className="subtitle" style={{ 
        marginBottom: '1.5rem', 
        display: 'flex', 
        alignItems: 'center', 
        gap: '10px' 
      }}>
        <BrainCircuit size={24} color="var(--primary-color)" />
        Inteligencia LANZO
        {tips.length > 0 && tips[0].id === 'learning' && (
          <span style={{
            fontSize: '0.7rem', 
            backgroundColor: '#e0e7ff', 
            color: '#4338ca', 
            padding: '2px 8px', 
            borderRadius: '10px'
          }}>
            Aprendiendo
          </span>
        )}
      </h3>

      <div className="tips-list">
        {tips.map((tip) => (
          <TipCard 
            key={tip.id} 
            tip={tip} 
            isExpanded={expandedTipId === tip.id} 
            onToggle={() => handleToggle(tip.id)}
          />
        ))}
        {tips.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--text-light)', fontStyle: 'italic' }}>
            Todo parece estar en orden. ¡Sigue vendiendo para obtener más consejos!
          </p>
        )}
      </div>
    </div>
  );
}