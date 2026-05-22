// src/components/dashboard/StatsGrid.jsx
import { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp,
  ShoppingBag,
  DollarSign,
  Package,
  Activity,
  Ticket,
  Calendar,
  Globe,
  BarChart2,
  AlertTriangle,
  TrendingDown
} from 'lucide-react';
import { useSalesStore } from '../../store/useSalesStore';
import './StatsGrid.css';
import TopProducts from './TopProducts';
import TopCustomers from './TopCustomers';
import { AreaTrendChart, BarWeekdayChart } from './TrendChart';
import { getOrdersSince, loadData as loadDBData, STORES } from '../../services/db/index';


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
  const [filteredSales, setFilteredSales] = useState([]);
  const [prevPeriodSales, setPrevPeriodSales] = useState([]);
  const [isLoadingData, setIsLoadingData] = useState(true);



  const recentSalesLength = sales?.length || 0;
  const latestSaleId = sales?.[0]?.id || null;

  useEffect(() => {
    async function loadPeriodSales() {
      setIsLoadingData(true);
      try {
        const now = new Date();
        const period = TIME_PERIODS[timeRange];

        let startDate = null;
        if (period.days === 1) {
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (period.days === 'month') {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        } else if (period.days !== Infinity) {
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          startDate.setDate(startDate.getDate() - (period.days - 1));
        }

        let prevPeriodStart = null;
        if (period.days === 1) {
          prevPeriodStart = null;
        } else if (period.days === 'month') {
          prevPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        } else if (period.days !== Infinity) {
          const prevPeriodEnd = new Date(startDate);
          prevPeriodEnd.setDate(prevPeriodEnd.getDate() - 1);
          prevPeriodStart = new Date(prevPeriodEnd);
          prevPeriodStart.setDate(prevPeriodStart.getDate() - (period.days - 1));
        }

        let current = [];
        let previous = [];

        if (period.days === Infinity) {
          const allSales = await loadDBData(STORES.SALES);
          current = allSales || [];
        } else {
          const queryStart = prevPeriodStart || startDate;
          const salesData = await getOrdersSince(queryStart.toISOString());

          if (prevPeriodStart) {
            current = salesData.filter(s => new Date(s.timestamp) >= startDate);
            previous = salesData.filter(s => new Date(s.timestamp) >= prevPeriodStart && new Date(s.timestamp) < startDate);
          } else {
            current = salesData.filter(s => new Date(s.timestamp) >= startDate);
          }
        }

        const validCurrent = current.filter(sale => sale.fulfillmentStatus !== 'cancelled' && sale.status !== 'open' && sale.status !== 'cancelled');
        const validPrev = previous.filter(sale => sale.fulfillmentStatus !== 'cancelled' && sale.status !== 'open' && sale.status !== 'cancelled');

        setFilteredSales(validCurrent);
        setPrevPeriodSales(validPrev);

      } catch (err) {
        console.error("Error loading period sales", err);
      } finally {
        setIsLoadingData(false);
      }
    }
    loadPeriodSales();
  }, [timeRange, recentSalesLength, latestSaleId]);

  // Calcular métricas para el periodo seleccionado
  const metrics = useMemo(() => {
    const now = new Date();
    const period = TIME_PERIODS[timeRange];

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
      const parsedTotal = parseFloat(String(sale.total).replace(/[^0-9.-]+/g, ""));
      revenue += isNaN(parsedTotal) ? 0 : parsedTotal;

      (sale.items || []).forEach(item => {
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
    const marginPercent = revenue > 0 ? (totalProfit / revenue) * 100 : 0;

    // Calcular métricas del periodo anterior para tendencia
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
    const dayMap = new Map();

    const periodStart = period.days === 'month'
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : (period.days === Infinity
        ? null
        : new Date(now.getFullYear(), now.getMonth(), now.getDate() - (period.days - 1)));

    if (periodStart !== null) {
      const currentDate = new Date(periodStart);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // CORRECCIÓN: Inyectar punto de anclaje (ayer con valor 0) si el periodo es 1 día 
      // para permitir el trazo del área en Recharts.
      if (period.days === 1) {
        const yesterday = new Date(currentDate);
        yesterday.setDate(yesterday.getDate() - 1);
        const dateKeyYesterday = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
        dayMap.set(dateKeyYesterday, 0);
      }

      while (currentDate <= today) {
        const dateKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
        dayMap.set(dateKey, 0);
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

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
        const [, month, day] = parts;
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
      confirmedRevenue,
      unconfirmedRevenue,
      filteredSales
    };
  }, [stats, filteredSales, prevPeriodSales, timeRange]);

  const formatCurrency = (val) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);



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
          {Object.entries(TIME_PERIODS).map(([key, { label }]) => (
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
      {metrics.evolutionData.length > 0 && (
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
            <h2 className="card-value-main">{formatCurrency(metrics.revenue || 0)}</h2>
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
            <h2 className="card-value-main">{formatCurrency(metrics.totalProfit || 0)}</h2>

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
          <div className="card-value-small">{metrics.orders || 0}</div>
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
          <div className="card-value-small">{metrics.items || 0}</div>
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
                data={metrics.dailyRevenue}
                height={260}
              />
            </div>
          </div>
        )}

        {/* Productos más vendidos — filteredSales respeta el periodo y excluye abiertas/canceladas */}
        <div className="stats-insight-card" style={{ width: '100%' }}>
          <TopProducts sales={metrics.filteredSales} limit={5} />
        </div>

        {/* Clientes frecuentes — filteredSales respeta el periodo y excluye abiertas/canceladas */}
        <div className="stats-insight-card" style={{ width: '100%' }}>
          <TopCustomers sales={metrics.filteredSales} customers={customers} limit={5} />
        </div>
      </div>
    </div>
  );
}
