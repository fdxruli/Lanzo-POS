// src/store/useDashboardStore.js
import { create } from 'zustand';
import { loadData, saveData, deleteData, STORES } from '../services/database';

// --- FUNCIÓN DE MIGRACIÓN (Sin cambios) ---
async function migrateExistingProductsToBatches() {
  console.log('Ejecutando migración de lotes...');
  try {
    const products = await loadData(STORES.MENU);
    let migratedCount = 0;

    for (const product of products) {
      if (product.batchManagement || product.price === undefined) {
        continue;
      }
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
      await saveData(STORES.PRODUCT_BATCHES, autoBatch);
      delete product.cost;
      delete product.price;
      delete product.stock;
      delete product.expiryDate;
      delete product.trackStock;
      product.batchManagement = { enabled: false, selectionStrategy: 'fifo' };
      product.updatedAt = new Date().toISOString();
      await saveData(STORES.MENU, product);
      migratedCount++;
    }
    return true;
  } catch (error) {
    console.error("Error crítico durante la migración de lotes:", error);
    return false;
  }
}

/**
 * Lógica de Agregación (CORREGIDA)
 * Combina productos con sus lotes para mostrar totales y precios/costos actuales.
 */
async function aggregateProductsWithBatches(products, batches) {
    const aggregatedProducts = [];
        
    // Agrupar lotes por producto
    const batchesByProduct = new Map();
    batches.forEach(batch => {
        if (!batchesByProduct.has(batch.productId)) {
            batchesByProduct.set(batch.productId, []);
        }
        batchesByProduct.get(batch.productId).push(batch);
    });
        
    const activeProducts = products.filter(p => p.isActive !== false);
        
    for (const product of activeProducts) {
        // Obtenemos todos los lotes de este producto (ordenados por fecha en el store)
        const productBatches = batchesByProduct.get(product.id) || [];
        
        // Filtramos solo lotes ACTIVOS y con STOCK para el cálculo de disponibilidad
        const activeBatches = productBatches.filter(b => b.isActive && b.stock > 0);
        
        const totalStock = activeBatches.reduce((sum, b) => sum + (b.stock || 0), 0);
        
        // PRECIO: Si hay lotes activos, tomamos el precio del primero (FIFO/LIFO según orden)
        // Si no, tomamos el precio base del producto (o 0)
        const displayPrice = activeBatches.length > 0 ? activeBatches[0].price : (product.price || 0);
        
        // COSTO (¡CORREGIDO!): 
        // Si hay lotes activos, mostramos el costo del lote que se está vendiendo actualmente.
        // Si no hay stock, intentamos mostrar el costo del último lote histórico para referencia.
        let displayCost = 0;
        if (activeBatches.length > 0) {
             displayCost = activeBatches[0].cost;
        } else {
             // productBatches[0] debería ser el más reciente si vienen ordenados del store
             // Si no hay lotes históricos, usamos el costo base del producto legado
             const lastBatch = productBatches[0]; 
             displayCost = lastBatch ? lastBatch.cost : (product.cost || 0);
        }
                
        aggregatedProducts.push({
            // Copiamos datos base del producto
            id: product.id,
            name: product.name,
            image: product.image,
            description: product.description,
            categoryId: product.categoryId,
            barcode: product.barcode,
            saleType: product.saleType,
            isActive: product.isActive,
            batchManagement: product.batchManagement,
            wholesaleTiers: product.wholesaleTiers,
            
            // Campos específicos (Farmacia/Restaurante) que deben persistir
            sustancia: product.sustancia,
            laboratorio: product.laboratorio,
            requiresPrescription: product.requiresPrescription, 
            presentation: product.presentation,
            productType: product.productType,
            recipe: product.recipe,
            
            // Propiedades calculadas (Dinámicas)
            stock: totalStock,
            price: displayPrice,
            cost: displayCost, // <--- ¡CAMPO AGREGADO!
            
            trackStock: true, // Con sistema de lotes, siempre trackeamos
            batchCount: productBatches.length,
            hasBatches: productBatches.length > 0
        });
    }
        
    return aggregatedProducts;
}


export const useDashboardStore = create((set, get) => ({
  // 1. ESTADO
  isLoading: true,
  sales: [],
  menu: [], 
  deletedItems: [],
  rawProducts: [], 
  rawBatches: [], 
  categories: [],

  // 2. ACCIONES
  loadAllData: async () => {
    set({ isLoading: true });
    try {
      const needsMigration = localStorage.getItem('run_batch_migration');
      if (needsMigration === 'true') {
        await migrateExistingProductsToBatches();
        localStorage.removeItem('run_batch_migration');
      }

      const [salesData, productData, batchData, categoryData, deletedMenu, deletedCustomers, deletedSales] = await Promise.all([
        loadData(STORES.SALES),
        loadData(STORES.MENU),
        loadData(STORES.PRODUCT_BATCHES),
        loadData(STORES.CATEGORIES),
        loadData(STORES.DELETED_MENU),
        loadData(STORES.DELETED_CUSTOMERS),
        loadData(STORES.DELETED_SALES)
      ]);

      const allMovements = [
        ...deletedMenu.map(p => ({ ...p, type: 'Producto', uniqueId: p.id, name: p.name })),
        ...deletedCustomers.map(c => ({ ...c, type: 'Cliente', uniqueId: c.id, name: c.name })),
        ...deletedSales.map(s => ({ ...s, type: 'Pedido', uniqueId: s.timestamp, name: `Pedido por $${s.total.toFixed(2)}` }))
      ];
      allMovements.sort((a, b) => new Date(b.deletedTimestamp) - new Date(a.deletedTimestamp));

      // Ordenar lotes: Más recientes primero (importante para la lógica de costos)
      const sortedBatches = batchData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Usamos la función corregida
      const aggregatedMenu = await aggregateProductsWithBatches(productData, sortedBatches);

      set({
        sales: salesData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
        menu: aggregatedMenu, // Aquí ahora vendrán TODOS los productos con su costo
        rawProducts: productData,
        rawBatches: sortedBatches,
        categories: categoryData || [],
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

      for (const item of saleToDelete.items) {
        if (item.batchesUsed && item.batchesUsed.length > 0) {
          for (const batchInfo of item.batchesUsed) {
            try {
              const batch = await loadData(STORES.PRODUCT_BATCHES, batchInfo.batchId);
              if (batch) {
                batch.stock += batchInfo.quantity; 
                batch.isActive = true; // Reactivamos el lote si estaba agotado
                await saveData(STORES.PRODUCT_BATCHES, batch);
              }
            } catch (batchError) {
              console.error(`Error restaurando stock lote ${batchInfo.batchId}:`, batchError);
            }
          }
        }
      }

      saleToDelete.deletedTimestamp = new Date().toISOString();
      await saveData(STORES.DELETED_SALES, saleToDelete);
      await deleteData(STORES.SALES, timestamp);

      get().loadAllData();
    } catch (error) {
      console.error("Error al eliminar venta:", error);
    }
  },

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
      else if (item.type === 'Pedido') {
        // Al restaurar un pedido eliminado, hay que volver a descontar el stock
        for (const saleItem of item.items) {
          if (saleItem.batchesUsed && saleItem.batchesUsed.length > 0) {
            for (const batchInfo of saleItem.batchesUsed) {
              try {
                const batch = await loadData(STORES.PRODUCT_BATCHES, batchInfo.batchId);
                if (batch) {
                  batch.stock = Math.max(0, batch.stock - batchInfo.quantity);
                  if (batch.stock === 0) batch.isActive = false;
                  await saveData(STORES.PRODUCT_BATCHES, batch);
                }
              } catch (batchError) { console.error(batchError); }
            }
          }
        }
        delete item.deletedTimestamp;
        await saveData(STORES.SALES, item);
        await deleteData(STORES.DELETED_SALES, item.timestamp);
      }

      get().loadAllData(); 
    } catch (error) {
      console.error("Error al restaurar item:", error);
    }
  },
}));