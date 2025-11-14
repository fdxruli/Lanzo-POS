import React from 'react';
import './StatsGrid.css'

export default function StatsGrid({ stats }) {
  return (
    <div className="stats-grid">
      <div className="stat-card">
        <h3 className="stat-title">Ingresos Totales</h3>
        <p className="stat-value revenue">${stats.totalRevenue.toFixed(2)}</p>
      </div>
      <div className="stat-card">
        <h3 className="stat-title">Pedidos Totales</h3>
        <p className="stat-value orders">{stats.totalOrders}</p>
      </div>
      <div className="stat-card">
        <h3 className="stat-title">Productos Vendidos</h3>
        <p className="stat-value items">{stats.totalItemsSold}</p>
      </div>
      <div className="stat-card">
        <h3 className="stat-title">Utilidad Neta Estimada</h3>
        <p className="stat-value profit">${stats.totalNetProfit.toFixed(2)}</p>
      </div>
      <div className="stat-card">
        <h3 className="stat-title">Valor del Inventario</h3>
        <p className="stat-value inventory">${stats.inventoryValue.toFixed(2)}</p>
      </div>
    </div>
  );
}