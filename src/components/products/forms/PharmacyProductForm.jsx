import React, { useState } from 'react';
import { useProductCommon } from '../../../hooks/useProductCommon';
import CommonProductFields from './CommonProductFields';
import FarmaciaFields from '../fieldsets/FarmaciaFIelds';
import { generateID } from '../../../services/utils';
import Logger from '../../../services/Logger';

export default function PharmacyProductForm({ onSave, onCancel, productToEdit, categories, onOpenCategoryManager, activeRubroContext, features }) {
    const common = useProductCommon(productToEdit);

    // Estados Específicos Farmacia
    const [prescriptionType, setPrescriptionType] = useState(productToEdit?.prescriptionType || 'otc'); // otc, antibiotic, controlled
    const [activeSubstance, setActiveSubstance] = useState(productToEdit?.activeSubstance || '');
    const [laboratory, setLaboratory] = useState(productToEdit?.laboratory || '');
    const [shelfLife, setShelfLife] = useState(productToEdit?.shelfLife || '');

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
                shelfLife,
                
                // Configuración de Lotes (Farmacia SIEMPRE usa Lotes por caducidad)
                batchManagement: { enabled: true, selectionStrategy: 'feFo' }, // FEFO: First Expired, First Out
                
                productType: 'sellable',
                ...(productToEdit ? {} : { createdAt: new Date().toISOString(), stock: 0 })
            };

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
            />

            <div className="module-section" style={{ borderTop: '2px solid #bfdbfe', marginTop: '15px', paddingTop: '15px' }}>
                <FarmaciaFields 
                    prescriptionType={prescriptionType}
                    setPrescriptionType={setPrescriptionType}
                    activeSubstance={activeSubstance}
                    setActiveSubstance={setActiveSubstance}
                    laboratory={laboratory}
                    setLaboratory={setLaboratory}
                    shelfLife={shelfLife}
                    setShelfLife={setShelfLife}
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