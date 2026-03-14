import React, { useState } from 'react';
import { useStatsStore } from '../../store/useStatsStore';
import { loadData, saveBulkSafe, STORES, archiveOldData } from '../../services/database';
import Logger from '../../services/Logger';
import DataTransferModal from '../products/DataTransferModal';
import { useProductStore } from '../../store/useProductStore';
import { maintenanceTools } from '../../services/db';
import { BarChart2, Package, Archive, Database, Download } from 'lucide-react';

export default function MaintenanceSettings() {
  const loadStats = useStatsStore((state) => state.loadStats);
  const loadInitialProducts = useProductStore((state) => state.loadInitialProducts);
  const [showDataTransfer, setShowDataTransfer] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

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

  const handleFixStock = async () => {
    setIsProcessing(true);
    try {
      const result = await maintenanceTools.fixStock();
      if (result.success) {
        alert(result.message);
        if (result.details.length > 0) {
          console.log("Detalles de corrección:", result.details);
        }
      }
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRebuildStats = async () => {
    if (!confirm("Esto recalculará todas las ganancias históricas basándose en las ventas guardadas. ¿Continuar?")) return;

    setIsProcessing(true);
    try {
      const result = await maintenanceTools.rebuildStats();
      alert(result.message);
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="company-form-container">
      <h3 className="subtitle">Mantenimiento del Sistema</h3>

      <div className="backup-container" style={{ marginTop: '0', borderTop: 'none' }}>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '20px' }}>
          Herramientas para corregir inconsistencias y optimizar la base de datos.
        </p>

        <div className="maintenance-grid">
          {/* HERRAMIENTA 1 */}
          <div className="maintenance-tool-card">
            <div className="tool-info">
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BarChart2 size={20} /> Reparar Ganancias
              </h4>
              <p>- Recalcula reportes históricos con costos actuales si ves negativos.</p>
            </div>
            <button className="btn btn-secondary" onClick={handleRebuildStats} disabled={isProcessing}>
              {isProcessing ? '...' : ' Ejecutar'}
            </button>
          </div>

          {/* HERRAMIENTA 2 */}
          <div className="maintenance-tool-card">
            <div className="tool-info">
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Package size={20} /> Sincronizar Stock
              </h4>
              <p>- Corrige discrepancias si ves "Agotado" pero tienes lotes.</p>
              <p>- Este problema puede llegar a presentarse despues de una actualizacion del sistema</p>
            </div>
            <button className="btn btn-primary" onClick={handleFixStock} disabled={isProcessing}>
              {isProcessing ? '...' : 'Sincronizar'}
            </button>
          </div>

          {/* HERRAMIENTA 3 */}
          <div className="maintenance-tool-card" style={{ borderColor: '#7c3aed' }}>
            <div className="tool-info">
              <h4 style={{ color: '#7c3aed', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Archive size={20} /> Archivar Historial
              </h4>
              <p>- Limpia ventas antiguas para acelerar. </p>
              <p>- Se descargará un archivo JSON con las ventas eliminadas.</p>
              <p>- Recomendado cada 6 meses o más.</p>
            </div>
            <button 
              className="btn btn-secondary" 
              onClick={handleArchive} 
              style={{ backgroundColor: '#7c3aed', color: 'white', border: 'none', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}
            >
              <Archive size={16} /> Archivar
            </button>
          </div>

          {/* HERRAMIENTA 4 */}
          <div className="maintenance-tool-card" style={{ borderColor: '#3b82f6' }}>
            <div className="tool-info">
              <h4 style={{ color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Database size={20} /> Respaldo y Datos
              </h4>
              <p>- Exporta tu base de datos o importa un respaldo.</p>
              <p>- Carga masiva de productos vía CSV/JSON.</p>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => setShowDataTransfer(true)}
              style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', border: 'none', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}
            >
              <Download size={16} /> Gestionar Datos
            </button>
          </div>
        </div>
      </div>
      <DataTransferModal
        show={showDataTransfer}
        onClose={() => setShowDataTransfer(false)}
        onRefresh={async () => {
          await loadInitialProducts();
          await loadStats(true);
        }}
      />
    </div>
  );
}