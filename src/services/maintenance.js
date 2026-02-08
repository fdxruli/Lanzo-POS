import { db, STORES } from './db/dexie';
import { roundCurrency } from './utils'; // Asegúrate de importar tu función de redondeo

/**
 * HERRAMIENTA 1: SINCRONIZADOR MAESTRO DE STOCK
 * Corrige discrepancias entre: Stock del Producto Padre vs. Suma de sus Lotes.
 * La "Verdad Absoluta" serán siempre los Lotes (Batches).
 */
export const fixStockInconsistencies = async () => {
  let corrections = 0;
  const log = [];

  try {
    await db.transaction('rw', [db.table(STORES.MENU), db.table(STORES.PRODUCT_BATCHES)], async () => {
      const allProducts = await db.table(STORES.MENU).toArray();
      
      for (const product of allProducts) {
        // Solo nos importan los productos que rastrean stock
        if (product.trackStock) {
          
          // 1. Buscamos sus lotes ACTIVOS
          const batches = await db.table(STORES.PRODUCT_BATCHES)
            .where('productId').equals(product.id)
            .toArray();

          // Si el producto usa lotes, la suma de lotes MANDA.
          if (product.batchManagement?.enabled || batches.length > 0) {
            
            // Sumar stock de lotes activos
            const realStock = batches
              .filter(b => b.isActive && b.stock > 0)
              .reduce((sum, b) => sum + Number(b.stock), 0);

            // Comparar con lo que dice el padre
            const difference = Math.abs(product.stock - realStock);

            if (difference > 0.001) { // Tolerancia decimal
              log.push(`🔧 Corregido ${product.name}: Decía ${product.stock}, Realidad ${realStock}`);
              
              // ACTUALIZACIÓN SILENCIOSA
              await db.table(STORES.MENU).update(product.id, {
                stock: realStock,
                hasBatches: true,
                updatedAt: new Date().toISOString()
              });
              corrections++;
            }
          }
        }
      }
    });

    return { 
      success: true, 
      message: `Se corrigieron ${corrections} productos con stock desfasado.`,
      details: log 
    };

  } catch (error) {
    console.error("Error en fixStockInconsistencies:", error);
    return { success: false, message: error.message };
  }
};

/**
 * HERRAMIENTA 2: RECONSTRUCTOR DE GANANCIAS (HISTÓRICO)
 * Borra las estadísticas diarias corruptas y las reconstruye venta por venta.
 * Vital si hubo ventas donde no se guardó el costo correctamente.
 */
export const rebuildDailyStats = async () => {
  try {
    // 1. Obtener TODAS las ventas históricas
    const allSales = await db.table(STORES.SALES).toArray();
    
    // Mapa temporal: { "2023-10-25": { revenue: 0, profit: 0, ... } }
    const statsMap = new Map();

    // 2. Procesar venta por venta (Recálculo masivo)
    for (const sale of allSales) {
      // Extraer fecha limpia YYYY-MM-DD
      const dateKey = new Date(sale.timestamp).toISOString().split('T')[0];
      
      if (!statsMap.has(dateKey)) {
        statsMap.set(dateKey, { 
          id: dateKey, date: dateKey, revenue: 0, profit: 0, orders: 0, itemsSold: 0 
        });
      }

      const dayStats = statsMap.get(dateKey);
      
      // Sumar totales
      dayStats.orders += 1;
      dayStats.revenue += (sale.total || 0);

      // Calcular Utilidad Real de esta venta
      let saleProfit = 0;
      let saleItemsCount = 0;

      if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(item => {
          const qty = item.quantity || 0;
          const price = item.price || 0;
          
          // CRÍTICO: Si la venta antigua no tenía costo guardado, intentamos recuperarlo del producto actual
          // (Es mejor una estimación que $0 costo)
          const cost = item.cost || 0; 
          
          const itemProfit = (price - cost) * qty;
          saleProfit += itemProfit;
          saleItemsCount += qty;
        });
      }

      dayStats.profit += saleProfit;
      dayStats.itemsSold += saleItemsCount;
    }

    // 3. Transacción de Escritura (Borrar viejo -> Escribir nuevo)
    await db.transaction('rw', [db.table(STORES.DAILY_STATS)], async () => {
      // Limpiar tabla de stats corrupta
      await db.table(STORES.DAILY_STATS).clear();
      
      // Insertar datos reconstruidos y limpios
      const newStatsArray = Array.from(statsMap.values());
      await db.table(STORES.DAILY_STATS).bulkAdd(newStatsArray);
    });

    return { 
      success: true, 
      message: `Historial reconstruido exitosamente (${allSales.length} ventas procesadas).` 
    };

  } catch (error) {
    console.error("Error en rebuildDailyStats:", error);
    return { success: false, message: error.message };
  }
};