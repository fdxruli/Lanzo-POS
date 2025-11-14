// src/hooks/useDashboard.js
import { useState, useEffect, useMemo, useCallback } from 'react';
import { loadData, saveData, deleteData, STORES } from '../services/database';

// Esta función es de tu app.js original, la traemos aquí
function normalizeProducts(products) {
  if (!Array.isArray(products)) return [];
  return products.map(item => ({
    ...item,
    trackStock: item.trackStock !== undefined ? item.trackStock : (typeof item.stock === 'number' && item.stock > 0),
  }));
}

export function useDashboard() {
  const [isLoading, setIsLoading] = useState(true);
  const [sales, setSales] = useState([]);
  const [menu, setMenu] = useState([]);
  const [deletedItems, setDeletedItems] = useState([]);

  // 1. FUNCIÓN DE CARGA DE DATOS
  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Cargamos todo en paralelo
      const [salesData, menuData, deletedMenu, deletedCustomers, deletedSales] = await Promise.all([
        loadData(STORES.SALES),
        loadData(STORES.MENU).then(normalizeProducts),
        loadData(STORES.DELETED_MENU),
        loadData(STORES.DELETED_CUSTOMERS),
        loadData(STORES.DELETED_SALES)
      ]);

      setSales(salesData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
      setMenu(menuData);
      
      // Combinamos la papelera (lógica de 'renderMovementHistory')
      const allMovements = [
        ...deletedMenu.map(p => ({ ...p, type: 'Producto', uniqueId: p.id, name: p.name })),
        ...deletedCustomers.map(c => ({ ...c, type: 'Cliente', uniqueId: c.id, name: c.name })),
        ...deletedSales.map(s => ({ ...s, type: 'Pedido', uniqueId: s.timestamp, name: `Pedido por $${s.total.toFixed(2)}` }))
      ];
      allMovements.sort((a, b) => new Date(b.deletedTimestamp) - new Date(a.deletedTimestamp));
      setDeletedItems(allMovements);
      
    } catch (error) {
      console.error("Error cargando datos del dashboard:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 2. EFECTO INICIAL
  useEffect(() => {
    loadAllData();
  }, [loadAllData]); // Se carga 1 vez

  // 3. CÁLCULO DE ESTADÍSTICAS (MEMOIZADO)
  // Reemplaza la 1ra parte de 'renderDashboard'
  // 'useMemo' recalcula esto solo si 'sales' o 'menu' cambian.
  const stats = useMemo(() => {
    const productMap = new Map(menu.map(p => [p.id, p]));
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

    const inventoryValue = menu.reduce((total, p) => {
      if (p.trackStock && p.stock > 0) {
        return total + ((p.cost || 0) * p.stock);
      }
      return total;
    }, 0);

    return {
      totalRevenue,
      totalOrders: sales.length,
      totalItemsSold,
      totalNetProfit,
      inventoryValue
    };
  }, [sales, menu]);

  // 4. ACCIONES (Eliminar / Restaurar)
  
  /**
   * Elimina una venta (la mueve a la papelera)
   * Lógica de 'deleteOrder'
   */
  const deleteSale = async (timestamp) => {
    if (!window.confirm('¿Seguro? Se restaurará el stock y el pedido irá a la papelera.')) return;
    
    try {
      const saleToDelete = sales.find(s => s.timestamp === timestamp);
      if (!saleToDelete) throw new Error('Venta no encontrada');

      // Restaurar stock
      for (const item of saleToDelete.items) {
        if (item.trackStock) {
          const product = await loadData(STORES.MENU, item.id);
          if (product) {
            product.stock += item.stockDeducted !== undefined ? item.stockDeducted : item.quantity;
            await saveData(STORES.MENU, product);
          }
        }
      }
      
      // Mover a papelera
      saleToDelete.deletedTimestamp = new Date().toISOString();
      await saveData(STORES.DELETED_SALES, saleToDelete);
      await deleteData(STORES.SALES, timestamp);
      
      // Recargar datos
      loadAllData(); 
    } catch (error) {
      console.error("Error al eliminar venta:", error);
    }
  };

  /**
   * Restaura un item desde la papelera
   * Lógica de 'restoreSale', 'restoreProduct', 'restoreCustomer'
   */
  const restoreItem = async (item) => {
    try {
      if (item.type === 'Producto') {
        delete item.deletedTimestamp;
        await saveData(STORES.MENU, item);
        await deleteData(STORES.DELETED_MENU, item.id);
      }
      if (item.type === 'Cliente') {
        delete item.deletedTimestamp;
        await saveData(STORES.CUSTOMERS, item);
        await deleteData(STORES.DELETED_CUSTOMERS, item.id);
      }
      if (item.type === 'Pedido') {
        // Lógica de 'restoreSale'
        // (Omitimos la parte de descontar stock por simplicidad por ahora)
        delete item.deletedTimestamp;
        await saveData(STORES.SALES, item);
        await deleteData(STORES.DELETED_SALES, item.timestamp);
      }
      
      loadAllData(); // Recargar todo
    } catch (error) {
      console.error("Error al restaurar item:", error);
    }
  };

  // 5. EXPORTAR DATOS Y ACCIONES
  return {
    isLoading,
    stats,
    salesHistory: sales,
    recycleBinItems: deletedItems,
    menu, // Lo necesitamos para los Consejos
    deleteSale,
    restoreItem,
  };
}