import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  ShoppingBag,
  CreditCard,
  DollarSign,
  Package,
  Activity,
  Ticket
} from 'lucide-react';
import { useSalesStore } from '../../store/useSalesStore';
import './StatsGrid.css';
import Ticker from '../layout/Ticker';

export default function StatsGrid({ stats }) {
  const sales = useSalesStore((state) => state.sales);
  const [timeRange, setTimeRange] = useState('today'); // 'today' | 'all'

  const metrics = useMemo(() => {
    const isToday = timeRange === 'today';
    let revenue = 0, profit = 0, orders = 0, items = 0;
    let hasMissingCosts = false; // Flag local para la vista actual

    if (isToday) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const relevantSales = sales.filter(s => new Date(s.timestamp) >= startOfDay && s.fulfillmentStatus !== 'cancelled');

      relevantSales.forEach(s => {
        revenue += s.total;
        orders += 1;
        s.items.forEach(item => {
          items += item.quantity;

          // REGLA ESTRICTA: Detectar costo nulo/indefinido
          let rawCost = item.cost;
          if (rawCost === null || rawCost === undefined) {
            hasMissingCosts = true;
            rawCost = 0; // Fallback para no romper la matemática
          }

          profit += (item.price - rawCost) * item.quantity;
        });
      });
    } else {
      revenue = stats.totalRevenue;
      profit = stats.totalNetProfit;
      orders = stats.totalOrders;
      items = stats.totalItemsSold;
      hasMissingCosts = stats.hasMissingCosts || false; // Leemos el flag del store
    }

    const avgTicket = orders > 0 ? revenue / orders : 0;
    const marginPercent = revenue > 0 ? (profit / revenue) * 100 : 0;

    return {
      revenue, profit, orders, items, avgTicket, marginPercent,
      inventory: stats.inventoryValue,
      hasMissingCosts // Exportamos el flag a la UI
    };
  }, [stats, sales, timeRange]);

  const formatCurrency = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);

  return (
    <div className="stats-container-wrapper">

      {/* --- HEADER MEJORADO --- */}
      <div className="stats-header-controls">
        <div className="stats-header-title">
          <h3>Resumen de Negocio</h3>
          {/* SUBTÍTULO DINÁMICO QUE EXPLICA TODO */}
          <p className="stats-subtitle">
            {timeRange === 'today'
              ? '📊 Mostrando solo las ventas de HOY.'
              : '🌎 Mostrando el acumulado desde que iniciaste.'}
          </p>
        </div>

        <div className="time-filter-toggle">
          <button
            className={`filter-pill ${timeRange === 'today' ? 'active' : ''}`}
            onClick={() => setTimeRange('today')}
            title="Ver solo lo de hoy"
          >
            📅 Hoy
          </button>
          <button
            className={`filter-pill ${timeRange === 'all' ? 'active' : ''}`}
            onClick={() => setTimeRange('all')}
            title="Ver acumulado histórico"
          >
            🌎 Total Global
          </button>
        </div>
      </div>

      <div className="stats-grid-modern">

        {/* TARJETA 1: INGRESOS */}
        <div className="stat-card-modern revenue-card">
          <div className="card-icon-wrapper green">
            <DollarSign size={24} />
          </div>
          <div className="card-content">
            <span className="card-label">Ventas {timeRange === 'today' ? 'del Día' : 'Totales'}</span>
            <h2 className="card-value-main">{formatCurrency(metrics.revenue)}</h2>
            <div className="card-trend positive">
              <Activity size={14} />
              <span>Dinero ingresado</span>
            </div>
          </div>
          <div className="card-bg-decoration"></div>
        </div>

        {/* TARJETA 2: UTILIDAD */}
        <div className={`stat-card-modern profit-card ${metrics.hasMissingCosts ? 'border-red-500' : ''}`}>
          <div className="card-icon-wrapper purple">
            <TrendingUp size={24} />
          </div>
          <div className="card-content">
            <span className="card-label">Ganancia Estimada</span>
            <h2 className="card-value-main">{formatCurrency(metrics.profit)}</h2>

            {/* RENDER CONDICIONAL DE ANOMALÍA */}
            {metrics.hasMissingCosts ? (
              <div className="text-red-500 text-xs font-bold mt-1 flex items-center gap-1">
                ⚠️ Margen inexacto (Faltan costos en inventario)
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
            <ShoppingBag size={18} className="text-gray" />
          </div>
          <div className="card-value-small">{metrics.orders}</div>
          <small className="text-muted">
            {timeRange === 'today' ? 'Tickets cobrados hoy' : 'Tickets totales'}
          </small>
        </div>

        {/* TARJETA 4: TICKET PROMEDIO */}
        <div className="stat-card-modern small-card">
          <div className="card-header-small">
            <span className="card-label">Promedio x Venta</span>
            <Ticket size={18} className="text-gray" />
          </div>
          <div className="card-value-small">{formatCurrency(metrics.avgTicket)}</div>
          <small className="text-muted">Gasto por cliente</small>
        </div>

        {/* TARJETA 5: PRODUCTOS */}
        <div className="stat-card-modern small-card">
          <div className="card-header-small">
            <span className="card-label">Prod. Vendidos</span>
            <Package size={18} className="text-gray" />
          </div>
          <div className="card-value-small">{metrics.items}</div>
          <small className="text-muted">Unidades entregadas</small>
        </div>

        {/* TARJETA 6: INVENTARIO (Fijo) */}
        <div className={`stat-card-modern inventory-card ${metrics.inventory === null ? 'border-red-500 bg-red-50' : ''}`}>
          <div className="inventory-content">
            <div>
              <span className="card-label">Dinero en Mercancía</span>
              {metrics.inventory === null ? (
                <div className="flex flex-col gap-1 mt-1">
                  <h3 className="inventory-value text-red-600 text-lg font-bold">No disponible</h3>
                  <span className="text-red-500 text-xs font-semibold">⚠️ Error de cálculo en sistema</span>
                </div>
              ) : (
                <h3 className="inventory-value">{formatCurrency(metrics.inventory)}</h3>
              )}
            </div>
            <div className="inventory-icon">
              <Package size={32} strokeWidth={1.5} className={metrics.inventory === null ? "text-red-400" : ""} />
            </div>
          </div>
          {metrics.inventory !== null && (
            <div className="inventory-bar-container">
              <div className="inventory-bar" style={{ width: '100%' }}></div>
            </div>
          )}
          <small className={metrics.inventory === null ? "text-red-400" : "text-muted-light"}>
            {metrics.inventory === null ? "Cálculo abortado para prevenir daños." : "Valor actual de tu stock"}
          </small>
        </div>

      </div>
    </div>
  );
}