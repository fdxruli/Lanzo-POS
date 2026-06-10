import React, { useState } from 'react';
import { useProductCommon } from '../../../hooks/useProductCommon';
import CommonProductFields from './CommonProductFields';
import FarmaciaFields from '../fieldsets/FarmaciaFIelds';
import { generateID } from '../../../services/utils';
import Logger from '../../../services/Logger';
import { updateProduct } from '../../../services/db/productUpdates';

export default function PharmacyProductForm({ onSave, onCancel, productToEdit, categories, onOpenCategoryManager, activeRubroContext, features }) {
    const common = useProductCommon(productToEdit, { defaultExpirationMode: 'STRICT' });

    // Estados Específicos Farmacia
    const [prescriptionType, setPrescriptionType] = useState(productToEdit?.prescriptionType || 'otc'); // otc, antibiotic, controlled
    const [activeSubstance, setActiveSubstance] = useState(productToEdit?.activeSubstance || '');
    const [laboratory, setLaboratory] = useState(productToEdit?.laboratory || '');
    // shelfLife eliminado — SSOT: La caducidad se registra por Lote (batch.expiryDate)

    const validatePharmacyRules = () => {
        // Regla 1: Datos obligatorios para controlados
        if (prescriptionType !== 'otc' && !activeSubstance.trim()) {
            alert('⚠️ Integridad de Datos:\n\nSi el medicamento es Antibiótico o Controlado, DEBES especificar la Sustancia Activa para los reportes de COFEPRIS/Salud.');
            return false;
        }
        
        // Regla 2: Precio mayor a 0 (vital en farmacia)
        if (parseFloat(common.price) <= 0) {
            alert('❌ El precio de venta debe ser mayor a 0.');
            return false;
        }

        // Regla 3: Validar Vida Útil
        if (common.expirationMode === 'SHELF_LIFE' && (!common.shelfLifeValue || common.shelfLifeValue <= 0)) {
            alert('❌ Debes especificar un valor válido para la Vida Útil.');
            return false;
        }
        
        return true;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validatePharmacyRules()) return;
        if (common.isSaving) return;

        common.setIsSaving(true);
        try {
            const commonData = common.getCommonData();
            const productId = productToEdit?.id || generateID('prod');

            const payload = {
                id: productId,
                ...commonData,
                rubroContext: activeRubroContext, // 'pharmacy'
                
                // Datos Específicos Blindados
                prescriptionType,
                activeSubstance: activeSubstance.toUpperCase().trim(), // Normalizado para búsquedas
                laboratory: laboratory.trim(),
                
                // Configuración de Lotes (Farmacia SIEMPRE usa Lotes por caducidad)
                batchManagement: { enabled: true, selectionStrategy: 'feFo' }, // FEFO: First Expired, First Out
                
                productType: 'sellable',
                ...(productToEdit ? {} : { createdAt: new Date().toISOString(), stock: 0 })
            };

                        // FASE 3: Transición atómica de modo de caducidad con _intent
            // Si hay purga pendiente, usar updateProduct atómico en lugar de purga diferida
            if (common.pendingBatchPurge && productId && productToEdit) {
                try {
                    const purgePayload = {
                        expirationMode: 'NONE',
                        shelfLifeValue: null,
                        shelfLifeUnit: null,
                        _intent: 'PURGE_BATCHES'
                    };
                    
                    // Actualización atómica: producto + lotes en una transacción
                    const result = await updateProduct(productId, purgePayload);
                    
                    if (!result.success) {
                        throw new Error('Falló la purga atómica de fechas de caducidad');
                    }
                    
                    Logger.info('[Farmacia] Purga atómica completada:', result.batchOperation);
                } catch (purgeError) {
                    Logger.error('Error durante la purga atómica de caducidades (Farmacia):', purgeError);
                    alert('Error al cambiar modo de caducidad: No se pudieron purgar las fechas de los lotes. El producto no ha sido modificado.');
                    common.setIsSaving(false);
                    return; // Abortar guardado completo
                }
            }

            await onSave(payload, productToEdit || { id: productId, isNew: true });
        } catch (error) {
            Logger.error(error);
            alert("Error al guardar producto farmacéutico");
        } finally {
            common.setIsSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div style={{ 
                marginBottom: '15px', padding: '10px', 
                backgroundColor: '#eff6ff', borderLeft: '4px solid #3b82f6', 
                borderRadius: '4px', color: '#1e40af', fontSize: '0.9rem' 
            }}>
                <strong>⚕️ Modo Farmacia:</strong> Control de caducidades (FEFO) y alertas de receta activadas.
            </div>

            <CommonProductFields 
                common={common} 
                categories={categories} 
                onOpenCategoryManager={onOpenCategoryManager} 
                productId={productToEdit?.id}
            />

            {/* CONFIGURACIÓN DE CADUCIDAD (DESACOPLADA) */}
            {common.doesTrackStock && (
                <div className="form-group" style={{ marginTop: '15px', padding: '10px', backgroundColor: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                    <label className="form-label" style={{ fontWeight: 'bold', color: '#334155' }}>Modo de Caducidad</label>
                    <select
                        className="form-input"
                        value={common.expirationMode}
                        onChange={(e) => {
                            const newValue = e.target.value;
                            if ((common.expirationMode === 'STRICT' || common.expirationMode === 'SHELF_LIFE') && newValue === 'NONE') {
                                const confirmPurge = window.confirm(
                                    "⚠️ Existen lotes activos con fechas de caducidad. ¿Deseas purgar estas fechas o cancelar el cambio?"
                                );
                                if (!confirmPurge) return;
                                common.setPendingBatchPurge(true);
                            }
                            common.setExpirationMode(newValue);
                        }}
                    >
                        <option value="NONE">No Controlar Caducidad</option>
                        <option value="STRICT">Estricto (Requerir fecha al recibir)</option>
                        <option value="SHELF_LIFE">Vida Útil (Días/Meses desde recepción)</option>
                    </select>

                    {common.expirationMode === 'SHELF_LIFE' && (
                        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                            <div style={{ flex: 1 }}>
                                <label className="form-label" style={{ fontSize: '0.85rem' }}>Vida Útil</label>
                                <input
                                    type="number"
                                    className="form-input"
                                    min="1"
                                    value={common.shelfLifeValue}
                                    onChange={(e) => common.setShelfLifeValue(e.target.value)}
                                    placeholder="Ej. 5"
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label className="form-label" style={{ fontSize: '0.85rem' }}>Unidad de Tiempo</label>
                                <select
                                    className="form-input"
                                    value={common.shelfLifeUnit}
                                    onChange={(e) => common.setShelfLifeUnit(e.target.value)}
                                >
                                    <option value="days">Días</option>
                                    <option value="months">Meses</option>
                                </select>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="module-section" style={{ borderTop: '2px solid #bfdbfe', marginTop: '15px', paddingTop: '15px' }}>
                <FarmaciaFields 
                    prescriptionType={prescriptionType}
                    setPrescriptionType={setPrescriptionType}
                    activeSubstance={activeSubstance}
                    setActiveSubstance={setActiveSubstance}
                    laboratory={laboratory}
                    setLaboratory={setLaboratory}
                />
            </div>

            <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
                <button type="submit" className="btn btn-save" style={{ flex: 2 }} disabled={common.isSaving}>
                    {common.isSaving ? '⏳ Guardando...' : 'Guardar Medicamento'}
                </button>
                <button type="button" className="btn btn-cancel" style={{ flex: 1 }} onClick={onCancel}>Cancelar</button>
            </div>
        </form>
    );
}