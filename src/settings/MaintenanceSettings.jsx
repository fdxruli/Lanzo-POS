import React, { useState } from 'react';
import { useStatsStore } from '../../store/useStatsStore';
import { loadData, saveBulkSafe, STORES, archiveOldData } from '../../services/database';
import Logger from '../../services/Logger';
import DataTransferModal from '../products/DataTransferModal';
import { useProductStore } from '../../store/useProductStore';

export default function MaintenanceSettings() {
  const loadStats = useStatsStore((state) => state.loadStats);
  const loadInitialProducts = useProductStore((state) => state.loadInitialProducts);
  const [showDataTransfer, setShowDataTransfer] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleRecalculateProfits = async () => {
    if (!window.confirm("⚠️ ¿Deseas recalcular...?")) return;

    setIsProcessing(true);
    try {
      const [sales, products] = await Promise.all([
        loadData(STORES.SALES),
        loadData(STORES.MENU)
      ]);
      
      const productCostMap = new Map();
      products.forEach(p => productCostMap.set(p.id, parseFloat(p.cost) || 0));

      // Array solo para lo que cambió
      const salesToUpdate = []; 

      sales.forEach(sale => { // Usamos forEach en lugar de map
        if (sale.fulfillmentStatus === 'cancelled') return;
        
        let saleModified = false;
        const newItems = sale.items.map(item => {
          const realId = item.parentId || item.id;
          const currentCost = productCostMap.get(realId);
          
          if (currentCost !== undefined && Math.abs((item.cost || 0) - currentCost) > 0.01) {
            saleModified = true;
            return { ...item, cost: currentCost };
          }
          return item;
        });

        if (saleModified) {
          // Solo agregamos a la lista de guardar si hubo cambios
          salesToUpdate.push({ ...sale, items: newItems });
        }
      });

      if (salesToUpdate.length > 0) {
        // Solo guardamos los modificados
        const result = await saveBulkSafe(STORES.SALES, salesToUpdate);

        if (result.success) {
          await loadStats(true);
          alert(`✅ Reparación completada. Se actualizaron ${salesToUpdate.length} ventas.`);
        } else {
          alert(`Error al guardar correcciones: ${result.error?.message}`);
        }
      } else {
        alert("✅ No se encontraron discrepancias de costos.");
      }
    } catch (e) {
      Logger.error(e);
      alert("Error al recalcular: " + e.message);
    }
    finally { setIsProcessing(false); }
};

  const handleSyncStock = async () => {
    if (!window.confirm("⚠️ ¿Sincronizar stock visible con la suma de lotes?\n\nNOTA: Los productos con 'Stock Simple' no se verán afectados, solo aquellos configurados por lotes.")) return;

    setIsProcessing(true);
    try {
      const [allBatches, allProducts] = await Promise.all([
        loadData(STORES.PRODUCT_BATCHES),
        loadData(STORES.MENU)
      ]);

      // 1. Mapa de Suma Real de Lotes
      const realStockFromBatches = {};
      allBatches.forEach(b => {
        if (b.isActive && b.stock > 0) {
          realStockFromBatches[b.productId] = (realStockFromBatches[b.productId] || 0) + b.stock;
        }
      });

      const updates = [];
      let skippedSimpleProducts = 0;

      allProducts.forEach(p => {
        const calculatedStock = realStockFromBatches[p.id] || 0;
        const currentStock = p.stock || 0;
        
        // Verificamos si el producto está configurado para usar lotes
        // (Según tu schema: batchManagement: { enabled: boolean })
        const usesBatches = p.batchManagement?.enabled === true;

        if (usesBatches) {
          // CASO 1: El producto ESTÁ configurado para usar Lotes.
          // La verdad absoluta son los lotes. Si la suma es 0, el stock debe ser 0.
          if (Math.abs(currentStock - calculatedStock) > 0.01) {
            updates.push({
              ...p,
              stock: calculatedStock,
              trackStock: true, // Aseguramos que rastree stock
              updatedAt: new Date().toISOString()
            });
          }
        } else {
          // CASO 2: El producto NO tiene activado el sistema de lotes (Es Stock Simple o Híbrido mal configurado)
          
          if (calculatedStock > 0) {
            // SUB-CASO A: Aunque dice no usar lotes, ENCONTRAMOS lotes activos.
            // Prioridad: Si hay lotes físicos, el stock visible debe reflejarlos.
            if (Math.abs(currentStock - calculatedStock) > 0.01) {
               updates.push({
                ...p,
                stock: calculatedStock,
                // Opcional: Podríamos forzar activar batchManagement aquí, 
                // pero mejor solo corregimos el número por seguridad.
                updatedAt: new Date().toISOString()
              });
            }
          } else {
            // SUB-CASO B (El más importante): No usa lotes y no tiene lotes encontrados.
            // Es un producto de STOCK SIMPLE MANUAL.
            // NO HACEMOS NADA. Respetamos su p.stock actual (ej: 50 unidades).
            skippedSimpleProducts++;
          }
        }
      });

      if (updates.length > 0) {
        const result = await saveBulkSafe(STORES.MENU, updates);

        if (result.success) {
          await loadStats(true); // Refrescar stats globales
          await loadInitialProducts(); // Refrescar lista de productos en memoria
          alert(`✅ Sincronización inteligente completada.\n\n- Productos corregidos: ${updates.length}\n- Productos manuales respetados: ${skippedSimpleProducts}`);
        } else {
          alert(`Error al sincronizar: ${result.error?.message}`);
        }
      } else {
        alert(`✅ El inventario ya está sincronizado.\n(Se omitieron ${skippedSimpleProducts} productos de stock manual).`);
      }
    } catch (e) {
      Logger.error(e);
      alert("Error al sincronizar: " + e.message);
    }
    finally { setIsProcessing(false); }
  };

  const handleArchive = async () => {
    if (!confirm("Esto descargará y BORRARÁ las ventas de hace más de 6 meses para acelerar el sistema. ¿Continuar?")) return;
    try {
      const oldSales = await archiveOldData(6);
      if (oldSales.length > 0) {
        const blob = new Blob([JSON.stringify(oldSales)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ARCHIVO_HISTORICO_${new Date().toISOString()}.json`;
        a.click();
        await loadStats(true);
        alert(`✅ Se archivaron y limpiaron ${oldSales.length} ventas antiguas.`);
      } else {
        alert("No hay ventas antiguas para archivar.");
      }
    } catch (e) {
      Logger.error(e);
      alert("Error al archivar.");
    }
  };

  return (
    <div className="company-form-container">
      <h3 className="subtitle">Mantenimiento del Sistema</h3>

      <div className="backup-container" style={{ marginTop: '0', borderTop: 'none' }}>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-primary', marginBottom: '20px' }}>
          Herramientas para corregir inconsistencias y optimizar la base de datos.
        </p>

        <div className="maintenance-grid">
          {/* HERRAMIENTA 1 */}
          <div className="maintenance-tool-card">
            <div className="tool-info">
              <h4>📊 Reparar Ganancias</h4>
              <p>- Recalcula reportes históricos con costos actuales si ves negativos.</p>
            </div>
            <button className="btn btn-secondary" onClick={handleRecalculateProfits} disabled={isProcessing}>
              {isProcessing ? '...' : '🔄 Ejecutar'}
            </button>
          </div>

          {/* HERRAMIENTA 2 */}
          <div className="maintenance-tool-card">
            <div className="tool-info">
              <h4>📦 Sincronizar Stock</h4>
              <p>- Corrige discrepancias si ves "Agotado" pero tienes lotes.</p>
              <p>- Este problema puede llegar a presentarse despues de una actualizacion del sistema</p>
            </div>
            <button className="btn btn-primary" onClick={handleSyncStock} disabled={isProcessing}>
              {isProcessing ? '...' : '🧩 Sincronizar'}
            </button>
          </div>

          {/* HERRAMIENTA 3 */}
          <div className="maintenance-tool-card" style={{ borderColor: '#7c3aed' }}>
            <div className="tool-info">
              <h4 style={{ color: '#7c3aed' }}>🗄️ Archivar Historial</h4>
              <p>- Limpia ventas antiguas para acelerar. </p>
              <p>- Se descargará un archivo JSON con las ventas eliminadas.</p>
              <p>- Recomendado cada 6 meses o más.</p>
            </div>
            <button className="btn btn-secondary" onClick={handleArchive} style={{ backgroundColor: '#7c3aed', color: 'white', border: 'none' }}>
              📦 Archivar
            </button>
          </div>

          {/* HERRAMIENTA 4 */}
          <div className="maintenance-tool-card" style={{ borderColor: '#3b82f6' }}>
    <div className="tool-info">
      <h4 style={{ color: '#3b82f6' }}>💾 Respaldo y Datos</h4>
      <p>- Exporta tu base de datos o importa un respaldo.</p>
      <p>- Carga masiva de productos vía CSV/JSON.</p>
    </div>
    <button 
      className="btn btn-secondary" 
      onClick={() => setShowDataTransfer(true)}
      style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', border: 'none' }}
    >
      📥 Gestionar Datos
    </button>
  </div>
        </div>
      </div>
      <DataTransferModal
        show={showDataTransfer}
        onClose={() => setShowDataTransfer(false)}
        onRefresh={async () => {
             // Si el usuario importa datos, recargamos todo
             await loadInitialProducts();
             await loadStats(true);
        }}
      />
    </div>
  );
}