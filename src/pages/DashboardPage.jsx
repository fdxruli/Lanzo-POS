// src/pages/DashboardPage.jsx
import React, { useState, useMemo } from 'react'; 
// ¡YA NO SE IMPORTA useDashboardStore COMPLETO!
import { useDashboardStore } from '../store/useDashboardStore';
import StatsGrid from '../components/dashboard/StatsGrid';
import SalesHistory from '../components/dashboard/SalesHistory';
import RecycleBin from '../components/dashboard/RecycleBin';
import BusinessTips from '../components/dashboard/BusinessTips';
import './DashboardPage.css';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('stats');
  
  // ======================================================
  // ¡AQUÍ ESTÁ LA CORRECCIÓN!
  // Reemplazamos el selector de objeto por selectores individuales.
  // ======================================================
  const isLoading = useDashboardStore((state) => state.isLoading);
  const sales = useDashboardStore((state) => state.sales);
  const menu = useDashboardStore((state) => state.menu);
  const deletedItems = useDashboardStore((state) => state.deletedItems);
  const deleteSale = useDashboardStore((state) => state.deleteSale);
  const restoreItem = useDashboardStore((state) => state.restoreItem);
  // ======================================================
  // FIN DE LA CORRECCIÓN
  // ======================================================

  
  // 4. Lógica de `useMemo` (Esta parte ya estaba perfecta)
  // (Copiada de tu antiguo `useDashboard.js`)
  
  // 4.1. Crea un mapa de productos solo cuando 'menu' cambia
  const productMap = useMemo(
    () => new Map(menu.map(p => [p.id, p])),
    [menu]
  );

  // 4.2. Calcula estadísticas de ventas solo cuando 'sales' o 'productMap' cambian
  const salesStats = useMemo(() => {
    let totalRevenue = 0;
    let totalItemsSold = 0;
    let totalNetProfit = 0;
    
    sales.forEach(sale => {
      totalRevenue += sale.total;
      sale.items.forEach(item => {
        totalItemsSold += item.quantity;
        const product = productMap.get(item.id) || { cost: item.price * 0.6 };
        const itemProfit = (item.price - (product.cost || 0)) * item.quantity;
        totalNetProfit += itemProfit;
      });
    });
    
    return { 
      totalRevenue, 
      totalItemsSold, 
      totalNetProfit, 
      totalOrders: sales.length 
    };
  }, [sales, productMap]);

  // 4.3. Calcula el valor de inventario solo cuando 'menu' cambia
  const inventoryValue = useMemo(() => {
    return menu.reduce((total, p) => {
      if (p.trackStock && p.stock > 0) {
        return total + ((p.cost || 0) * p.stock);
      }
      return total;
    }, 0);
  }, [menu]);

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