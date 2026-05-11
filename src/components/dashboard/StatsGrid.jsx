// src/components/dashboard/StatsGrid.jsx
import React, { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp,
  ShoppingBag,
  CreditCard,
  DollarSign,
  Package,
  Activity,
  Ticket,
  Calendar,
  Globe,
  BarChart2,
  AlertTriangle,
  Clock,
  TrendingDown
} from 'lucide-react';
import { useSalesStore } from '../../store/useSalesStore';
import './StatsGrid.css';
import Ticker from '../layout/Ticker';
import TopProducts from './TopProducts';
import TopCustomers from './TopCustomers';
import { AreaTrendChart, BarWeekdayChart, MiniLineChart, WeekdayHeatmap, MetricWithTrend } from './TrendChart';

// Periodos disponibles
const TIME_PERIODS = {
  today: { label: 'Hoy', days: 1 },
  last7: { label: '7 días', days: 7 },
  last15: { label: '15 días', days: 15 },
  thisMonth: { label: 'Este mes', days: 'month' },
  all: { label: 'Total', days: Infinity }
};

export default function StatsGrid({ stats, customers = [] }) {
  const sales = useSalesStore((state) => state.sales);
  const [timeRange, setTimeRange] = useState('today');
  const [animatedValues, setAnimatedValues] = useState({
    revenue: 0,
    profit: 0,
    orders: 0,
    items: 0
  });

  // Calcular métricas para el periodo seleccionado
  const metrics = useMemo(() => {
    const now = new Date();
    const period = TIME_PERIODS[timeRange];

    // Calcular fecha de inicio del periodo (a las 00:00:00)
    let startDate = null;

    if (period.days === 1) {
      // Hoy: desde las 00:00
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period.days === 'month') {
      // Este mes: desde el día 1 a las 00:00
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period.days === Infinity) {
      // Todo el historial
      startDate = null;
    } else {
      // Últimos N días: desde hace (N-1) días a las 00:00 hasta hoy
      // Ej: "7 días" = hoy + 6 días anteriores = 7 días totales
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      startDate.setDate(startDate.getDate() - (period.days - 1));
    }

    // Filtrar ventas por periodo
    const filteredSales = sales.filter(sale => {
      if (sale.fulfillmentStatus === 'cancelled') return false;

      const saleDate = new Date(sale.timestamp);

      if (period.days === 1) {
        // Hoy: desde las 00:00
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return saleDate >= startOfDay;
      }

      if (period.days === 'month') {
        // Este mes
        return saleDate.getMonth() === now.getMonth() &&
          saleDate.getFullYear() === now.getFullYear();
      }

      if (period.days === Infinity) {
        // Todo el historial
        return true;
      }

      // Últimos N días: venta >= startDate
      return saleDate >= startDate;
    });

    // Calcular métricas principales
    let revenue = 0;
    let profitConfirmed = 0;      // ← Ganancia confirmada (con costo)
    let estimatedProfit = 0;      // ← Ganancia estimada (sin costo = 100% ingreso)
    const orders = filteredSales.length;
    let items = 0;
    let confirmedRevenue = 0;     // ← Ingresos con costo conocido
    let unconfirmedRevenue = 0;   // ← Ingresos sin costo registrado
    let hasMissingCosts = false;

    filteredSales.forEach(sale => {
      revenue += Number(sale.total) || 0;

      sale.items.forEach(item => {
        items += item.quantity;
        const rawCost = item.cost;
        const itemRevenue = (item.price || 0) * item.quantity;

        if (rawCost === null || rawCost === undefined || rawCost === '' || Number(rawCost) === 0) {
          hasMissingCosts = true;
          estimatedProfit += itemRevenue;  // ← 100% como ganancia bruta
          unconfirmedRevenue += itemRevenue;
        } else {
          confirmedRevenue += itemRevenue;
          profitConfirmed += ((item.price || 0) - rawCost) * item.quantity;
        }
      });
    });

    const totalProfit = profitConfirmed + estimatedProfit;

    const avgTicket = orders > 0 ? revenue / orders : 0;
    //const marginPercent = validRevenue > 0 ? (profit / validRevenue) * 100 : 0;
    //const coveragePercent = revenue > 0 ? (validRevenue / revenue) * 100 : 100;
    const marginPercent = revenue > 0 ? (totalProfit / revenue) * 100 : 0;

    // Calcular métricas del periodo anterior para tendencia
    let prevPeriodStart = null;

    if (period.days === 1) {
      // No hay comparación para "hoy"
      prevPeriodStart = null;
    } else if (period.days === 'month') {
      // Mes anterior completo (primer día del mes anterior)
      prevPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    } else if (period.days !== Infinity) {
      // Periodo anterior de mismos días
      // El periodo anterior termina el día antes de startDate
      const prevPeriodEnd = new Date(startDate);
      prevPeriodEnd.setDate(prevPeriodEnd.getDate() - 1);
      // Calcular inicio: mismo número de días que el periodo actual
      prevPeriodStart = new Date(prevPeriodEnd);
      prevPeriodStart.setDate(prevPeriodStart.getDate() - (period.days - 1));
    }

    const prevPeriodSales = prevPeriodStart !== null ? sales.filter(sale => {
      if (sale.fulfillmentStatus === 'cancelled') return false;
      const saleDate = new Date(sale.timestamp);
      return saleDate >= prevPeriodStart && saleDate < startDate;
    }) : [];

    let prevRevenue = 0;
    prevPeriodSales.forEach(sale => {
      prevRevenue += Number(sale.total) || 0;
    });

    const revenueTrend = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;

    // Datos para gráficas - ventas por día de semana
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const dailyRevenueMap = {};
    filteredSales.forEach(sale => {
      const dayIndex = new Date(sale.timestamp).getDay();
      dailyRevenueMap[dayIndex] = (dailyRevenueMap[dayIndex] || 0) + (Number(sale.total) || 0);
    });
    
    const dailyRevenue = [];
    if (period.days <= 7) {
      // Para periodos cortos (Hoy, 7 días), ordenamos dinámicamente para que el eje X termine en "Hoy"
      const currentDayIndex = now.getDay();
      for (let i = 1; i <= 7; i++) {
        const dIndex = (currentDayIndex + i) % 7;
        dailyRevenue.push({ name: dayNames[dIndex], value: dailyRevenueMap[dIndex] || 0 });
      }
    } else {
      // Para periodos largos (15 días, mes, histórico), usamos orden estándar: Lunes a Domingo
      const standardOrder = [1, 2, 3, 4, 5, 6, 0];
      standardOrder.forEach(dIndex => {
        dailyRevenue.push({ name: dayNames[dIndex], value: dailyRevenueMap[dIndex] || 0 });
      });
    }

    // Evolución diaria para mini gráfica (formato Recharts)
    // Generar todos los días del periodo (incluso si no hay ventas)
    const dayMap = new Map();

    // Inicializar todos los días del periodo con valor 0
    const periodStart = period.days === 'month'
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : (period.days === Infinity
        ? null
        : new Date(now.getFullYear(), now.getMonth(), now.getDate() - (period.days - 1)));

    if (periodStart !== null) {
      const currentDate = new Date(periodStart);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      while (currentDate <= today) {
        const dateKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
        dayMap.set(dateKey, 0);
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    // Agregar ventas reales
    filteredSales.forEach(sale => {
      const d = new Date(sale.timestamp);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dayMap.set(dateKey, (dayMap.get(dateKey) || 0) + (Number(sale.total) || 0));
    });

    const evolutionData = Array.from(dayMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dateKey, value]) => {
        const parts = dateKey.split('-');
        if (parts.length !== 3) {
          return { name: 'Fecha inválida', value: Number(value) || 0 };
        }
        const [year, month, day] = parts;
        return { name: `${day}/${month}`, value: Number(value) || 0 };
      });

    return {
      revenue,
      profitConfirmed,
      estimatedProfit,
      totalProfit,
      orders,
      items,
      avgTicket,
      marginPercent,
      coveragePercent: revenue > 0 ? (confirmedRevenue / revenue) * 100 : 100,
      inventory: stats.inventoryValue,
      hasMissingCosts,
      revenueTrend,
      dailyRevenue,
      evolutionData,
      // Nuevos datos informativos:
      confirmedRevenue,
      unconfirmedRevenue
    };
  }, [stats, sales, timeRange]);

  const formatCurrency = (val) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);

  // Animación de conteo - se dispara al cambiar timeRange usando los valores de metrics directamente
  // Animación de conteo - reacciona a los cambios en las métricas para mostrar la info en cuanto cargue
  useEffect(() => {
    const duration = 300;
    const steps = 15;
    const interval = duration / steps;

    let step = 0;
    const timer = setInterval(() => {
      step++;
      const progress = step / steps;
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      setAnimatedValues(prev => ({
        revenue: prev.revenue + (metrics.revenue - prev.revenue) * easeProgress,
        profit: prev.profit + (metrics.totalProfit - prev.profit) * easeProgress,
        orders: Math.round(prev.orders + (metrics.orders - prev.orders) * easeProgress),
        items: Math.round(prev.items + (metrics.items - prev.items) * easeProgress)
      }));

      if (step >= steps) {
        clearInterval(timer);
      }
    }, interval);

    return () => clearInterval(timer);
  }, [timeRange]); // Únicamente timeRange como dependencia

  return (
    <div className="stats-container-wrapper">
      {/* Header con controles */}
      <div className="stats-header-controls">
        <div className="stats-header-title">
          <h3>Resumen de Negocio</h3>
          <p className="stats-subtitle">
            <BarChart2 size={16} />
            {TIME_PERIODS[timeRange].label === 'Hoy'
              ? ' Mostrando solo las ventas de HOY.'
              : ` Mostrando últimos ${TIME_PERIODS[timeRange].label}.`}
          </p>
        </div>

        {/* Selector de periodo - Mobile first: scroll horizontal */}
        <div className="time-filter-scroll">
          {Object.entries(TIME_PERIODS).map(([key, { label, days }]) => (
            <button
              key={key}
              className={`filter-pill ${timeRange === key ? 'active' : ''}`}
              onClick={() => setTimeRange(key)}
              title={`Ver últimos ${label}`}
            >
              {label === 'Hoy' && <Calendar size={14} />}
              {label === 'Total' && <Globe size={14} />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Gráfica de evolución temporal */}
      {metrics.evolutionData.length > 1 && (
        <div className="stats-evolution-card">
          <div className="evolution-header">
            <div className="evolution-title">
              <Activity size={18} />
              <span>Tendencia de Ventas</span>
            </div>
            <div className={`evolution-trend ${metrics.revenueTrend >= 0 ? 'positive' : 'negative'}`}>
              {metrics.revenueTrend >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
              <span>{metrics.revenueTrend >= 0 ? '+' : ''}{metrics.revenueTrend.toFixed(1)}%</span>
            </div>
          </div>
          <AreaTrendChart
            key={`area-${timeRange}`}
            data={metrics.evolutionData}
            height={200}
            color={metrics.revenueTrend >= 0 ? 'var(--success-color, #10b981)' : 'var(--error-color, #dc2626)'}
          />
        </div>
      )}

      {/* Grid de métricas principales */}
      <div className="stats-grid-modern">
        {/* TARJETA 1: INGRESOS */}
        <div className="stat-card-modern revenue-card">
          <div className="card-icon-wrapper green">
            <DollarSign size={24} />
          </div>
          <div className="card-content">
            <span className="card-label">Ventas</span>
            <h2 className="card-value-main">{formatCurrency(animatedValues.revenue || 0)}</h2>
            <div className={`card-trend ${metrics.revenueTrend >= 0 ? 'positive' : 'negative'}`}>
              {metrics.revenueTrend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              <span>{metrics.revenueTrend >= 0 ? '+' : ''}{metrics.revenueTrend.toFixed(1)}% vs periodo anterior</span>
            </div>
          </div>
        </div>

        {/* TARJETA 2: UTILIDAD */}
        <div className={`stat-card-modern profit-card ${metrics.hasMissingCosts && metrics.coveragePercent < 100 ? 'card-warning-state' : ''}`}>
          <div className="card-icon-wrapper purple">
            <TrendingUp size={24} />
          </div>
          <div className="card-content">
            <span className="card-label">Ganancia Estimada</span>
            <h2 className="card-value-main">{formatCurrency(animatedValues.profit || 0)}</h2>

            {metrics.hasMissingCosts && metrics.coveragePercent < 100 ? (
              <div className="error-message-inline" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginTop: '6px', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: '500' }}>
                    <strong>{formatCurrency(metrics.profitConfirmed)}</strong> confirmada
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.85rem' }}>
                    + <strong>{formatCurrency(metrics.estimatedProfit)}</strong> estimada (sin costo)
                  </span>
                </div>
                <small style={{ color: 'var(--text-muted)', fontSize: '0.70rem', marginTop: '2px', lineHeight: '1.2' }}>
                  Total: {formatCurrency(metrics.totalProfit)} | {metrics.coveragePercent.toFixed(1)}% tiene costo registrado
                </small>
              </div>
            ) : (
              <div className="card-mini-stats">
                <span className="mini-stat-pill">
                  Margen: <strong>{metrics.marginPercent.toFixed(1)}%</strong>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* TARJETA 3: PEDIDOS */}
        <div className="stat-card-modern small-card">
          <div className="card-header-small">
            <span className="card-label">Pedidos</span>
            <ShoppingBag size={18} className="icon-muted" />
          </div>
          <div className="card-value-small">{animatedValues.orders || 0}</div>
          <small className="text-muted">Tickets cobrados</small>
        </div>

        {/* TARJETA 4: TICKET PROMEDIO */}
        <div className="stat-card-modern small-card">
          <div className="card-header-small">
            <span className="card-label">Ticket Promedio</span>
            <Ticket size={18} className="icon-muted" />
          </div>
          <div className="card-value-small">{formatCurrency(metrics.avgTicket)}</div>
          <small className="text-muted">Gasto por cliente</small>
        </div>

        {/* TARJETA 5: PRODUCTOS */}
        <div className="stat-card-modern small-card">
          <div className="card-header-small">
            <span className="card-label">Prod. Vendidos</span>
            <Package size={18} className="icon-muted" />
          </div>
          <div className="card-value-small">{animatedValues.items || 0}</div>
          <small className="text-muted">Unidades entregadas</small>
        </div>

        {/* TARJETA 6: INVENTARIO */}
        <div className={`stat-card-modern inventory-card ${metrics.inventory === null ? 'card-error-state' : ''}`}>
          <div className="inventory-content">
            <div className="inventory-text-group">
              <span className="card-label">Dinero en Mercancía</span>
              {metrics.inventory === null ? (
                <div className="inventory-error-group">
                  <h3 className="inventory-value error-text">No disponible</h3>
                  <span className="error-message-inline small">
                    <AlertTriangle size={14} /> Error de cálculo
                  </span>
                </div>
              ) : (
                <h3 className="inventory-value">{formatCurrency(metrics.inventory)}</h3>
              )}
            </div>
            <div className="inventory-icon">
              <Package size={32} strokeWidth={1.5} className={metrics.inventory === null ? "icon-error" : "icon-primary"} />
            </div>
          </div>
          {metrics.inventory !== null && (
            <div className="inventory-bar-container">
              <div className="inventory-bar" style={{ width: '100%' }}></div>
            </div>
          )}
          <small className={`inventory-footer-text ${metrics.inventory === null ? "error-text-light" : "text-muted"}`}>
            {metrics.inventory === null ? "Cálculo abortado para prevenir daños." : "Valor actual de tu stock"}
          </small>
        </div>
      </div>

      {/* Sección de gráficas y datos adicionales */}
      <div className="stats-insights-section" style={{ alignItems: 'flex-start' }}>
        {/* Gráfica de días de semana */}
        {metrics.dailyRevenue.length > 0 && (
          <div className="stats-insight-card" style={{ width: '100%' }}>
            <div className="insight-header">
              <Calendar size={18} />
              <h4>Ventas por Día de Semana</h4>
            </div>
            <div style={{ marginTop: '10px' }}>
              <BarWeekdayChart
                key={`bar-${timeRange}`}
                data={metrics.dailyRevenue}
                height={260}
              />
            </div>
          </div>
        )}

        {/* Productos más vendidos */}
        <div className="stats-insight-card" style={{ width: '100%' }}>
          <TopProducts sales={sales} limit={5} />
        </div>

        {/* Clientes frecuentes */}
        <div className="stats-insight-card" style={{ width: '100%' }}>
          <TopCustomers sales={sales} customers={customers} limit={5} />
        </div>
      </div>
    </div>
  );
}
