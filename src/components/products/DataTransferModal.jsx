// src/components/products/DataTransferModal.jsx
import React, { useState } from 'react';
import { useProductStore } from '../../store/useProductStore';
import { downloadInventorySmart, processImport, downloadFile, generatePharmacyReport } from '../../services/dataTransfer';
import { showMessageModal } from '../../services/utils';
import { loadData, STORES } from '../../services/database';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';

export default function DataTransferModal({ show, onClose, onRefresh }) {
  const [activeTab, setActiveTab] = useState('export');
  const [isLoading, setIsLoading] = useState(false);
  const [importLog, setImportLog] = useState(null);

  // Hook de configuración para saber si mostrar opciones de Farmacia
  const features = useFeatureConfig();

  const categories = useProductStore(state => state.categories);

  const handleExport = async () => {
    setIsLoading(true);
    try {
      // Ya no cargamos datos aquí, la función 'smart' se encarga internamente
      await downloadInventorySmart();

      showMessageModal('✅ Archivo de inventario generado correctamente.');
    } catch (error) {
      console.error(error);
      showMessageModal('Error al generar la exportación.');
    } finally {
      setIsLoading(false);
    }
  };

  // Manejador del reporte de Farmacia (Libro de Control)
  const handleExportPharmacy = async () => {
    setIsLoading(true);
    try {
      const allSales = await loadData(STORES.SALES);
      const csvContent = generatePharmacyReport(allSales);

      if (csvContent.split('\n').length <= 1) {
        showMessageModal('No se encontraron ventas de medicamentos controlados para exportar.');
      } else {
        const date = new Date().toISOString().split('T')[0];
        downloadFile(csvContent, `libro_control_farmacia_${date}.csv`);
        showMessageModal('✅ Libro de Control generado correctamente.');
      }
    } catch (error) {
      console.error(error);
      showMessageModal('Error al generar reporte: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!window.confirm('IMPORTANTE: Esta acción agregará nuevos productos o actualizará los existentes si coinciden los IDs. ¿Deseas continuar?')) {
      e.target.value = '';
      return;
    }

    setIsLoading(true);
    setImportLog(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const content = evt.target.result;
        const result = await processImport(content);

        setImportLog(result);

        if (result.success && result.importedCount > 0) {
          await onRefresh();
          showMessageModal(`¡Éxito! Se importaron ${result.importedCount} productos.`);
        } else if (result.importedCount === 0) {
          showMessageModal('No se encontraron productos válidos en el archivo.');
        }
      } catch (error) {
        console.error(error);
        showMessageModal(`Error crítico al importar: ${error.message}`);
      } finally {
        setIsLoading(false);
        e.target.value = '';
      }
    };

    reader.readAsText(file);
  };

  if (!show) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 2500 }}>
      <div className="modal-content" style={{ maxWidth: '600px' }}>
        <h2 className="modal-title">Gestión Masiva de Datos</h2>

        <div className="tabs-container">
          <button
            className={`tab-btn ${activeTab === 'export' ? 'active' : ''}`}
            onClick={() => setActiveTab('export')}
          >
            📤 Exportar / Respaldo
          </button>
          <button
            className={`tab-btn ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            📥 Importar CSV
          </button>
        </div>

        <div style={{ padding: '1rem 0' }}>
          {activeTab === 'export' ? (
            <div style={{ textAlign: 'center' }}>
              <p>Descarga todo tu inventario en un archivo CSV (compatible con Excel).</p>
              <p style={{ fontSize: '0.9rem', color: '#666' }}>
                Incluye: Productos, Códigos, Precios, Costos, Stock actual y Configuraciones avanzadas.
              </p>

              <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button className="btn btn-save" onClick={handleExport} disabled={isLoading}>
                  {isLoading ? 'Generando...' : '⬇️ Descargar Inventario Completo'}
                </button>

                {/* BOTÓN CONDICIONAL: SOLO VISIBLE SI ES FARMACIA */}
                {features.hasLabFields && (
                  <button
                    className="btn btn-secondary"
                    onClick={handleExportPharmacy}
                    disabled={isLoading}
                    style={{ backgroundColor: '#0ea5e9' }}
                  >
                    💊 Descargar Libro de Control (COFEPRIS)
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p>Sube un archivo CSV para agregar o actualizar productos masivamente.</p>

              <div style={{
                border: '2px dashed #ccc', padding: '2rem',
                textAlign: 'center', borderRadius: '8px', marginTop: '1rem',
                backgroundColor: 'var(--background-color)'
              }}>
                <label htmlFor="csv-upload" className="btn btn-secondary" style={{ cursor: 'pointer', display: 'inline-block' }}>
                  {isLoading ? 'Procesando...' : '📂 Seleccionar Archivo CSV'}
                </label>
                <input
                  id="csv-upload"
                  type="file"
                  accept=".csv"
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                  disabled={isLoading}
                />
              </div>

              <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#666' }}>
                <p><strong>Nota:</strong> Puedes usar el archivo de exportación como plantilla. Las columnas obligatorias son <code>name</code> y <code>price</code>.</p>
              </div>

              {/* Log de errores */}
              {importLog && importLog.errors.length > 0 && (
                <div style={{
                  marginTop: '1rem', maxHeight: '150px', overflowY: 'auto',
                  backgroundColor: '#fee2e2', padding: '10px', borderRadius: '5px',
                  border: '1px solid #ef4444'
                }}>
                  <h4 style={{ color: '#b91c1c', margin: '0 0 5px 0' }}>⚠️ Advertencias de importación:</h4>
                  <ul style={{ margin: 0, paddingLeft: '20px', color: '#b91c1c' }}>
                    {importLog.errors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
          <button className="btn btn-cancel" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}