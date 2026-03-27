import React, { useState, useMemo } from 'react';
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
  AlertTriangle
} from 'lucide-react';
import { useSalesStore } from '../../store/useSalesStore';
import './StatsGrid.css';
import Ticker from '../layout/Ticker';

export default function StatsGrid({ stats }) {
  const sales = useSalesStore((state) => state.sales);
  const [timeRange, setTimeRange] = useState('today');

  const metrics = useMemo(() => {
    const isToday = timeRange === 'today';
    let revenue = 0, profit = 0, orders = 0, items = 0;
    let validRevenue = 0; // CORRECCIÓN: Declaración agregada
    let hasMissingCosts = false;

    if (isToday) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const relevantSales = sales.filter(s => new Date(s.timestamp) >= startOfDay && s.fulfillmentStatus !== 'cancelled');

      relevantSales.forEach(s => {
        revenue += Number(s.total) || 0;
        orders += 1;
        s.items.forEach(item => {
          items += item.quantity;

          let rawCost = item.cost;
          const itemRevenue = item.price * item.quantity; // CORRECCIÓN: Cálculo de la venta por producto

          if (rawCost === null || rawCost === undefined || rawCost === '' || Number(rawCost) === 0) {
            hasMissingCosts = true;
          } else {
            validRevenue += itemRevenue;
            profit += (item.price - rawCost) * item.quantity;
          }
        });
      });
    } else {
      revenue = stats.totalRevenue;
      profit = stats.totalNetProfit;
      orders = stats.totalOrders;
      items = stats.totalItemsSold;
      hasMissingCosts = stats.hasMissingCosts || false;
      // CORRECCIÓN: Debes asegurar que las métricas históricas también provean validRevenue. 
      // Si tu backend/store no lo provee, asume un fallback temporal:
      validRevenue = stats.validRevenue || revenue;
    }

    const avgTicket = orders > 0 ? revenue / orders : 0;

    // CORRECCIÓN: El margen debe calcularse sobre validRevenue, no sobre el revenue total, o estará diluido.
    const marginPercent = validRevenue > 0 ? (profit / validRevenue) * 100 : 0;

    // CORRECCIÓN: Cálculo requerido por el JSX
    const coveragePercent = revenue > 0 ? (validRevenue / revenue) * 100 : 100;

    return {
      revenue,
      profit,
      orders,
      items,
      avgTicket,
      marginPercent,
      coveragePercent, // CORRECCIÓN: Exportado para que el JSX (línea 98) no falle
      inventory: stats.inventoryValue,
      hasMissingCosts
    };
  }, [stats, sales, timeRange]);

  const formatCurrency = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);

  return (
    <div className="stats-container-wrapper">

      <div className="stats-header-controls">
        <div className="stats-header-title">
          <h3>Resumen de Negocio</h3>
          <p className="stats-subtitle">
            {timeRange === 'today' ? (
              <><BarChart2 size={16} /> Mostrando solo las ventas de HOY.</>
            ) : (
              <><Globe size={16} /> Mostrando el acumulado histórico.</>
            )}
          </p>
        </div>

        <div className="time-filter-toggle">
          <button
            className={`filter-pill ${timeRange === 'today' ? 'active' : ''}`}
            onClick={() => setTimeRange('today')}
            title="Ver solo lo de hoy"
          >
            <Calendar size={16} /> Hoy
          </button>
          <button
            className={`filter-pill ${timeRange === 'all' ? 'active' : ''}`}
            onClick={() => setTimeRange('all')}
            title="Ver acumulado histórico"
          >
            <Globe size={16} /> Total Global
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
        </div>

        {/* TARJETA 2: UTILIDAD */}
        <div className={`stat-card-modern profit-card ${metrics.hasMissingCosts && metrics.coveragePercent < 100 ? 'card-warning-state' : ''}`}>
          <div className="card-icon-wrapper purple">
            <TrendingUp size={24} />
          </div>
          <div className="card-content">
            <span className="card-label">Ganancia Estimada</span>
            <h2 className="card-value-main">{formatCurrency(metrics.profit)}</h2>

            {metrics.hasMissingCosts && metrics.coveragePercent < 100 ? (
              <div className="error-message-inline" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginTop: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <AlertTriangle size={14} className="error-icon-shrink" />
                  <span>Margen parcial calculado</span>
                </div>
                <small style={{ color: 'var(--text-muted)', fontSize: '0.70rem', marginTop: '2px', lineHeight: '1.2' }}>
                  Basado solo en el {metrics.coveragePercent.toFixed(1)}% de los ingresos totales (productos sin costo excluidos).
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
          <div className="card-value-small">{metrics.orders}</div>
          <small className="text-muted">
            {timeRange === 'today' ? 'Tickets cobrados hoy' : 'Tickets totales'}
          </small>
        </div>

        {/* TARJETA 4: TICKET PROMEDIO */}
        <div className="stat-card-modern small-card">
          <div className="card-header-small">
            <span className="card-label">Promedio x Venta</span>
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
          <div className="card-value-small">{metrics.items}</div>
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
    </div>
  );
}