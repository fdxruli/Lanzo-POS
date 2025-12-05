import React, { useState } from 'react';
import { useStatsStore } from '../../store/useStatsStore';
import { loadData, saveBulkSafe, STORES, archiveOldData } from '../../services/database';

export default function MaintenanceSettings() {
  const loadStats = useStatsStore((state) => state.loadStats);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleRecalculateProfits = async () => {
    if (!window.confirm("⚠️ ¿Deseas recalcular todas las ventas usando los COSTOS ACTUALES?\n\nEsto corregirá ganancias negativas, pero sobrescribirá el historial de costos.")) return;

    setIsProcessing(true);
    try {
      const [sales, products] = await Promise.all([
        loadData(STORES.SALES),
        loadData(STORES.MENU)
      ]);
      const productCostMap = new Map();
      products.forEach(p => productCostMap.set(p.id, parseFloat(p.cost) || 0));

      let updatedCount = 0;
      const updatedSales = sales.map(sale => {
        if (sale.fulfillmentStatus === 'cancelled') return sale;
        let saleModified = false;
        const newItems = sale.items.map(item => {
          const realId = item.parentId || item.id;
          const currentCost = productCostMap.get(realId);
          // Si el costo guardado difiere del actual, actualizamos
          if (currentCost !== undefined && Math.abs((item.cost || 0) - currentCost) > 0.01) {
            saleModified = true;
            return { ...item, cost: currentCost };
          }
          return item;
        });
        if (saleModified) {
          updatedCount++;
          return { ...sale, items: newItems };
        }
        return sale;
      });

      if (updatedCount > 0) {
        // CAMBIO: saveBulkSafe
        const result = await saveBulkSafe(STORES.SALES, updatedSales);

        if (result.success) {
          await loadStats(true);
          alert(`✅ Reparación completada. Se actualizaron ${updatedCount} ventas.`);
        } else {
          alert(`Error al guardar correcciones: ${result.error?.message}`);
        }
      } else {
        alert("✅ No se encontraron discrepancias de costos.");
      }
    } catch (e) {
      console.error(e);
      alert("Error al recalcular: " + e.message);
    }
    finally { setIsProcessing(false); }
  };

  const handleSyncStock = async () => {
    if (!window.confirm("⚠️ ¿Sincronizar stock visible con la suma de lotes?")) return;

    setIsProcessing(true);
    try {
      const [allBatches, allProducts] = await Promise.all([
        loadData(STORES.PRODUCT_BATCHES),
        loadData(STORES.MENU)
      ]);

      // Sumar stock real de lotes activos
      const realStockMap = {};
      allBatches.forEach(b => {
        if (b.isActive && b.stock > 0) {
          realStockMap[b.productId] = (realStockMap[b.productId] || 0) + b.stock;
        }
      });

      const updates = [];
      allProducts.forEach(p => {
        // Si el producto usa lotes, verificamos si cuadra
        const calculatedStock = realStockMap[p.id] || 0;
        const currentStock = p.stock || 0;

        if (Math.abs(currentStock - calculatedStock) > 0.01) {
          // Actualizamos el producto padre
          updates.push({
            ...p,
            stock: calculatedStock,
            trackStock: calculatedStock > 0 || p.trackStock,
            updatedAt: new Date().toISOString()
          });
        }
      });

      if (updates.length > 0) {
        // CAMBIO: saveBulkSafe
        const result = await saveBulkSafe(STORES.MENU, updates);

        if (result.success) {
          await loadStats(true);
          alert(`✅ Sincronización completada. Se corrigió el stock de ${updates.length} productos.`);
        } else {
          alert(`Error al sincronizar: ${result.error?.message}`);
        }
      } else {
        alert("✅ El inventario ya está perfectamente sincronizado.");
      }
    } catch (e) {
      console.error(e);
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
        alert(`✅ Se archivaron y limpiaron ${oldSales.length} ventas antiguas.`);
      } else {
        alert("No hay ventas antiguas para archivar.");
      }
    } catch (e) {
      console.error(e);
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
        </div>
      </div>
    </div>
  );
}