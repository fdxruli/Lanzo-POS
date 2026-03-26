import { db, STORES } from './db/dexie';
import {
  buildProductCostMap,
  rebuildDailyStatsCacheFromSales
} from './sales/financialStats';

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
        if (!product.trackStock) continue;

        const batches = await db.table(STORES.PRODUCT_BATCHES)
          .where('productId').equals(product.id)
          .toArray();

        if (!product.batchManagement?.enabled && batches.length === 0) {
          continue;
        }

        const realStock = batches
          .filter(batch => batch.isActive && batch.stock > 0)
          .reduce((sum, batch) => sum + Number(batch.stock), 0);

        const difference = Math.abs(product.stock - realStock);
        if (difference <= 0.001) continue;

        log.push(`Corregido ${product.name}: Decia ${product.stock}, Realidad ${realStock}`);

        await db.table(STORES.MENU).update(product.id, {
          stock: realStock,
          hasBatches: true,
          updatedAt: new Date().toISOString()
        });
        corrections++;
      }
    });

    return {
      success: true,
      message: `Se corrigieron ${corrections} productos con stock desfasado.`,
      details: log
    };
  } catch (error) {
    console.error('Error en fixStockInconsistencies:', error);
    return { success: false, message: error.message };
  }
};

/**
 * HERRAMIENTA 2: RECONSTRUCTOR DE GANANCIAS (HISTORICO)
 * Borra las estadisticas diarias y las reconstruye desde ventas cerradas.
 */
export const rebuildDailyStats = async () => {
  try {
    const productCostMap = await buildProductCostMap(db, STORES);
    const dailyStats = await rebuildDailyStatsCacheFromSales(db, STORES, productCostMap, console);
    const processedOrders = dailyStats.reduce((sum, day) => sum + (day.orders || 0), 0);

    return {
      success: true,
      message: `Historial reconstruido exitosamente (${processedOrders} ventas cerradas procesadas).`
    };
  } catch (error) {
    console.error('Error en rebuildDailyStats:', error);
    return { success: false, message: error.message };
  }
};
