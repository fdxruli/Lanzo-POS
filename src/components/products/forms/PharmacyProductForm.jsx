import React, { useState } from 'react';
import { useProductCommon } from '../../../hooks/useProductCommon';
import CommonProductFields from './CommonProductFields';
import FarmaciaFields from '../fieldsets/FarmaciaFIelds';
import { generateID, showConfirmModal, showMessageModal } from '../../../services/utils';
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
            showMessageModal('Integridad de datos:\n\nSi el medicamento es Antibiótico o Controlado, DEBES especificar la Sustancia Activa para los reportes de COFEPRIS/Salud.', null, { type: 'warning' });
            return false;
        }
        
        // Regla 2: Precio mayor a 0 (vital en farmacia)
        if (parseFloat(common.price) <= 0) {
            showMessageModal('El precio de venta debe ser mayor a 0.', null, { type: 'error' });
            return false;
        }

        // Regla 3: Validar Vida Útil
        if (common.expirationMode === 'SHELF_LIFE' && (!common.shelfLifeValue || common.shelfLifeValue <= 0)) {
            showMessageModal('Debes especificar un valor válido para la Vida Útil.', null, { type: 'error' });
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
                    showMessageModal('Error al cambiar modo de caducidad: No se pudieron purgar las fechas de los lotes. El producto no ha sido modificado.', null, { type: 'error' });
                    common.setIsSaving(false);
                    return; // Abortar guardado completo
                }
            }

            await onSave(payload, productToEdit || { id: productId, isNew: true });
        } catch (error) {
            Logger.error(error);
            showMessageModal("Error al guardar producto farmacéutico", null, { type: 'error' });
        } finally {
            common.setIsSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="product-expert-form">
            <div className="product-form-alert product-form-alert--info">
                <div className="product-form-alert__content">
                    <strong className="product-form-alert__title">Modo farmacia</strong>
                    <p>Control de caducidades FEFO y alertas de receta activadas.</p>
                </div>
            </div>

            <CommonProductFields 
                common={common} 
                categories={categories} 
                onOpenCategoryManager={onOpenCategoryManager} 
                productId={productToEdit?.id}
            />

            {/* CONFIGURACIÓN DE CADUCIDAD (DESACOPLADA) */}
            {common.doesTrackStock && (
                <section className="product-form-section product-form-section--compact">
                    <div className="product-form-section__header">
                        <div className="product-form-section__heading">
                            <h4 className="product-form-section__title">Modo de caducidad</h4>
                            <p className="product-form-section__subtitle">
                                Define cómo se gestionarán las fechas al recibir lotes.
                            </p>
                        </div>
                    </div>

                    <select
                        className="form-input"
                        value={common.expirationMode}
                        onChange={async (e) => {
                            const newValue = e.target.value;
                            if ((common.expirationMode === 'STRICT' || common.expirationMode === 'SHELF_LIFE') && newValue === 'NONE') {
                                const confirmPurge = await showConfirmModal(
                                    "Existen lotes activos con fechas de caducidad. ¿Deseas purgar estas fechas o cancelar el cambio?",
                                    {
                                        title: 'Purgar caducidades',
                                        confirmButtonText: 'Sí, purgar',
                                        cancelButtonText: 'Cancelar'
                                    }
                                );
                                if (!confirmPurge) return;
                                common.setPendingBatchPurge(true);
                            }
                            common.setExpirationMode(newValue);
                        }}
                    >
                        <option value="NONE">No controlar caducidad</option>
                        <option value="STRICT">Estricto (requerir fecha al recibir)</option>
                        <option value="SHELF_LIFE">Vida útil (días/meses desde recepción)</option>
                    </select>

                    {common.expirationMode === 'SHELF_LIFE' && (
                        <div className="product-form-grid product-form-grid--2" style={{ marginTop: '10px' }}>
                            <div className="form-group product-form-no-margin">
                                <label className="form-label">Vida útil</label>
                                <input
                                    type="number"
                                    className="form-input"
                                    min="1"
                                    value={common.shelfLifeValue}
                                    onChange={(e) => common.setShelfLifeValue(e.target.value)}
                                    placeholder="Ej. 5"
                                />
                            </div>
                            <div className="form-group product-form-no-margin">
                                <label className="form-label">Unidad de tiempo</label>
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
                </section>
            )}

            <FarmaciaFields 
                prescriptionType={prescriptionType}
                setPrescriptionType={setPrescriptionType}
                activeSubstance={activeSubstance}
                setActiveSubstance={setActiveSubstance}
                laboratory={laboratory}
                setLaboratory={setLaboratory}
            />

            <div className="form-actions-bar">
                <button type="submit" className="btn btn-save" disabled={common.isSaving}>
                    {common.isSaving ? 'Guardando...' : 'Guardar medicamento'}
                </button>
                <button type="button" className="btn btn-cancel" onClick={onCancel}>Cancelar</button>
            </div>
        </form>
    );
}
