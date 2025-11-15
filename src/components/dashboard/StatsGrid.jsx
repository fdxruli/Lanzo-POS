import React, { memo } from 'react';
import './StatsGrid.css';

const StatCard = ({ title, value, className }) => (
  <div className="stat-card">
    <h3 className="stat-title">{title}</h3>
    <p className={`stat-value ${className}`}>{value}</p>
  </div>
);

const StatsGrid = memo(({ stats }) => {
  const currencyFormatter = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

  return (
    <div className="stats-grid">
      <StatCard
        title="Ingresos Totales"
        value={currencyFormatter.format(stats.totalRevenue)}
        className="revenue"
      />
      <StatCard
        title="Pedidos Totales"
        value={stats.totalOrders}
        className="orders"
      />
      <StatCard
        title="Productos Vendidos"
        value={stats.totalItemsSold}
        className="items"
      />
      <StatCard
        title="Utilidad Neta Estimada"
        value={currencyFormatter.format(stats.totalNetProfit)}
        className="profit"
      />
      <StatCard
        title="Valor del Inventario"
        value={currencyFormatter.format(stats.inventoryValue)}
        className="inventory"
      />
    </div>
  );
});

export default StatsGrid;