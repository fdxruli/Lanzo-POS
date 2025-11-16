// src/pages/DashboardPage.jsx
import React, { useState, useMemo } from 'react';
import { useDashboardStore } from '../store/useDashboardStore';
import StatsGrid from '../components/dashboard/StatsGrid';
import SalesHistory from '../components/dashboard/SalesHistory';
import RecycleBin from '../components/dashboard/RecycleBin';
import BusinessTips from '../components/dashboard/BusinessTips';
import './DashboardPage.css';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('stats');

  // --- INICIO DE CORRECCIONES ---
  const isLoading = useDashboardStore((state) => state.isLoading);
  const sales = useDashboardStore((state) => state.sales);
  const menu = useDashboardStore((state) => state.menu);
  // 1. Necesitamos los lotes puros para el valor de inventario
  const rawBatches = useDashboardStore((state) => state.rawBatches);
  const deletedItems = useDashboardStore((state) => state.deletedItems);
  const deleteSale = useDashboardStore((state) => state.deleteSale);
  const restoreItem = useDashboardStore((state) => state.restoreItem);
  // --- FIN DE CORRECCIONES ---


  // 4. Lógica de `useMemo` (¡Corregida!)

  // 4.1. Este mapa ya no es necesario para la utilidad,
  // pero podemos mantenerlo por si BusinessTips lo usa.
  const productMap = useMemo(
    () => new Map(menu.map(p => [p.id, p])),
    [menu]
  );

  // 4.2. Calcula estadísticas de ventas (¡CORREGIDO!)
  const salesStats = useMemo(() => {
    let totalRevenue = 0;
    let totalItemsSold = 0;
    let totalNetProfit = 0;

    sales.forEach(sale => {
      totalRevenue += sale.total;
      sale.items.forEach(item => {
        totalItemsSold += item.quantity;

        // --- INICIO DE CORRECCIÓN (Utilidad) ---
        // El 'item' de la venta (sale.items) ya tiene el costo promedio
        // ponderado con el que se vendió ('item.cost'), gracias
        // a la nueva lógica de PosPage.jsx.
        const itemCost = item.cost || 0;
        const itemProfit = (item.price - itemCost) * item.quantity;
        totalNetProfit += itemProfit;
        // --- FIN DE CORRECCIÓN (Utilidad) ---
      });
    });

    return {
      totalRevenue,
      totalItemsSold,
      totalNetProfit,
      totalOrders: sales.length
    };
  }, [sales]); // Ya no depende de productMap

  // 4.3. Calcula el valor de inventario (¡CORREGIDO!)
  const inventoryValue = useMemo(() => {
    // --- INICIO DE CORRECCIÓN (Inventario) ---
    // No podemos usar 'menu' (agregado).
    // Debemos usar 'rawBatches' que tiene el costo y stock real.
    return rawBatches.reduce((total, batch) => {
      if (batch.isActive && batch.trackStock && batch.stock > 0) {
        // Sumamos el valor real de cada lote
        return total + ((batch.cost || 0) * batch.stock);
      }
      return total;
    }, 0);
  }, [rawBatches]); // La dependencia ahora es rawBatches
  // --- FIN DE CORRECCIÓN (Inventario) ---

  // 4.4. Combina los resultados
  const stats = useMemo(() => ({
    ...salesStats,
    inventoryValue
  }), [salesStats, inventoryValue]);
  // ======================================================
  // FIN DE LA LÓGICA DE useMemo
  // ======================================================

  if (isLoading) {
    return <div>Cargando estadísticas...</div>;
  }

  // 5. El renderizado (sin cambios)
  return (
    <>
      <h2 className="section-title">Panel de Ventas y Estadísticas</h2>

      <div className="tabs-container" id="sales-tabs">
        <button
          className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          Estadísticas Clave
        </button>
        <button
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          Historial y Papelera
        </button>
        <button
          className={`tab-btn ${activeTab === 'tips' ? 'active' : ''}`}
          onClick={() => setActiveTab('tips')}
        >
          Consejos para tu Negocio
        </button>
      </div>

      {activeTab === 'stats' && (
        <StatsGrid stats={stats} />
      )}

      {activeTab === 'history' && (
        <div className="dashboard-grid-condensed">
          <SalesHistory sales={sales} onDeleteSale={deleteSale} />
          <RecycleBin items={deletedItems} onRestoreItem={restoreItem} />
        </div>
      )}

      {activeTab === 'tips' && (
        <BusinessTips sales={sales} menu={menu} />
      )}
    </>
  );
}