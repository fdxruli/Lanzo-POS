// src/store/useDashboardStore.js
import { create } from 'zustand';
import { loadData, saveData, deleteData, STORES } from '../services/database';

/**
 * Lógica de Migración (Propuesta 4.4)
 * Mueve los datos de stock/costo de productos existentes a sus
 * primeros lotes.
 */
async function migrateExistingProductsToBatches() {
  console.log('Ejecutando migración de lotes...');
  try {
    const products = await loadData(STORES.MENU);
    let migratedCount = 0;

    for (const product of products) {
      // Si el producto ya tiene gestión de lotes, o no tiene 'price', 
      // probablemente ya fue migrado o es una estructura nueva.
      if (product.batchManagement || product.price === undefined) {
        continue;
      }

      // 1. Crear el lote automático
      const autoBatch = {
        id: `batch-${product.id}-migration`,
        productId: product.id,
        cost: product.cost || 0,
        price: product.price,
        stock: product.stock || 0,
        expiryDate: product.expiryDate || null,
        createdAt: new Date().toISOString(),
        trackStock: product.trackStock !== false,
        isActive: (product.stock || 0) > 0,
        bulkData: product.bulkData || null,
        notes: "Migrado automáticamente del sistema anterior"
      };
      
      // 2. Guardar el nuevo lote
      await saveData(STORES.PRODUCT_BATCHES, autoBatch);

      // 3. Actualizar el producto (eliminar campos movidos)
      delete product.cost;
      delete product.price;
      delete product.stock;
      delete product.expiryDate;
      delete product.trackStock;
      
      product.batchManagement = {
        enabled: false, // Por defecto desactivado
        selectionStrategy: 'fifo'
      };
      product.updatedAt = new Date().toISOString();
      
      await saveData(STORES.MENU, product);
      migratedCount++;
    }
    console.log(`✅ Migración completada. ${migratedCount} productos actualizados.`);
    return true;
  } catch (error) {
    console.error("Error crítico durante la migración de lotes:", error);
    return false;
  }
}

/**
 * Lógica de Agregación (Propuesta C. VISTA DEL POS)
 * Combina productos y sus lotes para mostrar en las vistas.
 */
async function aggregateProductsWithBatches(products, batches) {
    const aggregatedProducts = [];
        
    // 🔧 OPTIMIZACIÓN: Indexar lotes por productId (en memoria, rápido)
    const batchesByProduct = new Map();
    batches.forEach(batch => {
        if (!batchesByProduct.has(batch.productId)) {
            batchesByProduct.set(batch.productId, []);
        }
        batchesByProduct.get(batch.productId).push(batch);
    });
        
    // 🔧 OPTIMIZACIÓN: Procesar solo productos activos
    const activeProducts = products.filter(p => p.isActive !== false);
        
    for (const product of activeProducts) {
        const productBatches = batchesByProduct.get(product.id) || [];
        const activeBatches = productBatches.filter(b => b.isActive && b.stock > 0);
                
        if (activeBatches.length === 0) {
            // Sin stock, omitir del menú POS (pero mantener en gestión)
            continue;
        }
                
        // Calcular totales (sin ordenar, es más rápido)
        const totalStock = activeBatches.reduce((sum, b) => sum + (b.stock || 0), 0);
        
        // ¡Importante! Toma el precio del primer lote activo encontrado.
        // Esto es mucho más rápido que ordenar por estrategia (FIFO, etc.)
        // lo cual solo es necesario al VENDER, no al MOSTRAR.
        const displayPrice = activeBatches[0].price; 
                
        aggregatedProducts.push({
            id: product.id,
            name: product.name,
            image: product.image,
            description: product.description,
            categoryId: product.categoryId,
            barcode: product.barcode,
            saleType: product.saleType,
            isActive: product.isActive,
            batchManagement: product.batchManagement,
            // 🔧 Propiedades agregadas
            stock: totalStock,
            price: displayPrice,
            trackStock: true,
            batchCount: productBatches.length,
        });
    }
        
    return aggregatedProducts;
}


export const useDashboardStore = create((set, get) => ({
  // 1. ESTADO
  isLoading: true,
  sales: [],
  menu: [], // Este será el menú AGREGADO
  deletedItems: [],
  rawProducts: [], // Productos sin procesar
  rawBatches: [], // Lotes sin procesar

  // 2. ACCIONES
  loadAllData: async () => {
    set({ isLoading: true });
    try {
      // Revisar si la migración debe correr
      const needsMigration = localStorage.getItem('run_batch_migration');
      if (needsMigration === 'true') {
        const success = await migrateExistingProductsToBatches();
        if (success) {
          localStorage.removeItem('run_batch_migration');
        }
      }

      // Cargamos todo en paralelo
      const [salesData, productData, batchData, deletedMenu, deletedCustomers, deletedSales] = await Promise.all([
        loadData(STORES.SALES),
        loadData(STORES.MENU),
        loadData(STORES.PRODUCT_BATCHES),
        loadData(STORES.DELETED_MENU),
        loadData(STORES.DELETED_CUSTOMERS),
        loadData(STORES.DELETED_SALES)
      ]);

      // Combinamos la papelera
      const allMovements = [
        ...deletedMenu.map(p => ({ ...p, type: 'Producto', uniqueId: p.id, name: p.name })),
        ...deletedCustomers.map(c => ({ ...c, type: 'Cliente', uniqueId: c.id, name: c.name })),
        ...deletedSales.map(s => ({ ...s, type: 'Pedido', uniqueId: s.timestamp, name: `Pedido por $${s.total.toFixed(2)}` }))
      ];
      allMovements.sort((a, b) => new Date(b.deletedTimestamp) - new Date(a.deletedTimestamp));

      // AGREGAR productos y lotes
      const aggregatedMenu = await aggregateProductsWithBatches(productData, batchData);

      // Actualizamos el estado centralizado
      set({
        sales: salesData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
        menu: aggregatedMenu,
        rawProducts: productData,
        rawBatches: batchData,
        deletedItems: allMovements,
        isLoading: false
      });

    } catch (error) {
      console.error("Error cargando datos del dashboard:", error);
      set({ isLoading: false });
    }
  },

  deleteSale: async (timestamp) => {
    if (!window.confirm('¿Seguro? Se restaurará el stock a los lotes correctos y el pedido irá a la papelera.')) return;

    try {
      const saleToDelete = get().sales.find(s => s.timestamp === timestamp);
      if (!saleToDelete) throw new Error('Venta no encontrada');

      // --- INICIO DE CORRECCIÓN ---
      // Restaurar stock A LOS LOTES
      for (const item of saleToDelete.items) {
        // Solo procesamos items que usaron el sistema de lotes
        if (item.batchesUsed && item.batchesUsed.length > 0) {
          for (const batchInfo of item.batchesUsed) {
            try {
              const batch = await loadData(STORES.PRODUCT_BATCHES, batchInfo.batchId);
              if (batch) {
                batch.stock += batchInfo.quantity; // Restaurar la cantidad
                batch.isActive = true; // Asegurar que el lote esté activo de nuevo
                await saveData(STORES.PRODUCT_BATCHES, batch);
              } else {
                console.warn(`Lote ${batchInfo.batchId} no encontrado, no se pudo restaurar stock.`);
              }
            } catch (batchError) {
              console.error(`Error restaurando stock para el lote ${batchInfo.batchId}:`, batchError);
            }
          }
        } else {
            console.warn(`La venta ${saleToDelete.timestamp} no tiene datos de lote (batchesUsed) para el item ${item.name}. No se restaurará stock.`);
        }
      }
      // --- FIN DE CORRECCIÓN ---

      // Mover a papelera
      saleToDelete.deletedTimestamp = new Date().toISOString();
      await saveData(STORES.DELETED_SALES, saleToDelete);
      await deleteData(STORES.SALES, timestamp);

      // Recargar datos en el store
      get().loadAllData();
    } catch (error) {
      console.error("Error al eliminar venta:", error);
    }
  },

  /**
   * ¡CORREGIDO!
   * Ahora descuenta el stock de los lotes correctos al restaurar.
   */
  restoreItem: async (item) => {
    try {
      if (item.type === 'Producto') {
        delete item.deletedTimestamp;
        await saveData(STORES.MENU, item);
        await deleteData(STORES.DELETED_MENU, item.id);
      }
      else if (item.type === 'Cliente') {
        delete item.deletedTimestamp;
        await saveData(STORES.CUSTOMERS, item);
        await deleteData(STORES.DELETED_CUSTOMERS, item.id);
      }
      // --- INICIO DE CORRECCIÓN ---
      else if (item.type === 'Pedido') {
        // Descontar stock de los lotes (lógica inversa de deleteSale)
        for (const saleItem of item.items) {
          if (saleItem.batchesUsed && saleItem.batchesUsed.length > 0) {
            for (const batchInfo of saleItem.batchesUsed) {
              try {
                const batch = await loadData(STORES.PRODUCT_BATCHES, batchInfo.batchId);
                if (batch) {
                  batch.stock = Math.max(0, batch.stock - batchInfo.quantity);
                  if (batch.stock === 0) batch.isActive = false;
                  await saveData(STORES.PRODUCT_BATCHES, batch);
                } else {
                    console.warn(`Lote ${batchInfo.batchId} no encontrado, no se pudo descontar stock.`);
                }
              } catch (batchError) {
                console.error(`Error descontando stock para el lote ${batchInfo.batchId}:`, batchError);
              }
            }
          } else {
            console.warn(`La venta ${item.timestamp} no tiene datos de lote (batchesUsed) para el item ${saleItem.name}. No se descontará stock.`);
          }
        }
        
        delete item.deletedTimestamp;
        await saveData(STORES.SALES, item);
        await deleteData(STORES.DELETED_SALES, item.timestamp);
      }
      // --- FIN DE CORRECCIÓN ---

      get().loadAllData(); // Recargar todo
    } catch (error) {
      console.error("Error al restaurar item:", error);
    }
  },
}));