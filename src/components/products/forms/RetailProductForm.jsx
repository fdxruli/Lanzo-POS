import React, { useState } from 'react';
import { useProductCommon } from '../../../hooks/useProductCommon';
import CommonProductFields from './CommonProductFields';
import AbarrotesFields from '../fieldsets/AbarrotesFields';
import FruteriaFields from '../fieldsets/FruteriaFields';
import QuickVariantEntry from '../QuickVariantEntry';
import WholesaleManagerModal from '../WholesaleManagerModal';
import { generateID, showMessageModal } from '../../../services/utils'; // Importamos showMessageModal
import { saveBatchAndSyncProductSafe } from '../../../services/database';

export default function RetailProductForm({ onSave, onCancel, productToEdit, categories, onOpenCategoryManager, activeRubroContext, features, onManageBatches }) {
    const common = useProductCommon(productToEdit);

    // Estados específicos Retail
    const [saleType, setSaleType] = useState(productToEdit?.saleType || 'unit');
    const [unit, setUnit] = useState(productToEdit?.unit || (saleType === 'unit' ? 'pza' : 'kg'));
    const [minStock, setMinStock] = useState(productToEdit?.minStock || '');
    const [maxStock, setMaxStock] = useState(productToEdit?.maxStock || '');
    const [supplier, setSupplier] = useState(productToEdit?.supplier || '');
    const [shelfLife, setShelfLife] = useState(productToEdit?.shelfLife || '');
    const [wholesaleTiers, setWholesaleTiers] = useState(productToEdit?.wholesaleTiers || []);
    const [isWholesaleModalOpen, setIsWholesaleModalOpen] = useState(false);
    const [conversionFactor, setConversionFactor] = useState(productToEdit?.conversionFactor || { enabled: false, purchaseUnit: '', factor: 1 });

    // Estado para Ropa (Variantes rápidas)
    const [quickVariants, setQuickVariants] = useState([]);
    const isApparel = activeRubroContext === 'apparel';

    // --- LÓGICA DE VALIDACIÓN ROBUSTA (A PRUEBA DE ERRORES) ---
    const validateRetailRules = () => {
        const price = parseFloat(common.price) || 0;
        const cost = parseFloat(common.cost) || 0;

        // 1. Reglas Generales de Precios
        if (price <= 0) {
            showMessageModal('⚠️ Error de Precio', 'El precio de venta debe ser mayor a 0.', { type: 'error' });
            return false;
        }

        // 2. PREVENCIÓN DE PÉRDIDAS (LOSS PREVENTION)
        if (cost > 0) {
            // Caso A: Venta bajo costo
            if (price < cost) {
                const confirmLoss = window.confirm(
                    `⚠️ ¡ALERTA CRÍTICA DE PRECIO!\n\n` +
                    `Estás configurando el Precio ($${price}) MENOR al Costo ($${cost}).\n\n` +
                    `Esto generará PÉRDIDAS en cada venta.\n` +
                    `¿Estás 100% seguro de continuar?`
                );
                if (!confirmLoss) return false;
            }
            
            // Caso B: Margen peligrosamente bajo (< 10%)
            const margin = ((price - cost) / cost) * 100;
            if (margin < 10 && price >= cost) {
                const confirmLowMargin = window.confirm(
                    `⚠️ Margen de Ganancia Bajo (${margin.toFixed(1)}%)\n\n` +
                    `El estándar sugerido es al menos 15-20%.\n` +
                    `¿Deseas guardar de todos modos?`
                );
                if (!confirmLowMargin) return false;
            }
        }

        // 3. Validación de Mayoreo vs Costo
        if (features.hasWholesale && wholesaleTiers.length > 0 && cost > 0) {
            const badTier = wholesaleTiers.find(t => parseFloat(t.price) < cost);
            if (badTier) {
                const confirmWholesaleLoss = window.confirm(
                    `⚠️ Error en Mayoreo\n\n` +
                    `El precio de mayoreo ($${badTier.price}) para ${badTier.min} pzas es MENOR al costo ($${cost}).\n` +
                    `¿Realmente quieres perder dinero en ventas mayoristas?`
                );
                if (!confirmWholesaleLoss) return false;
            }
        }

        // 4. Reglas de Abarrotes / Granel
        if (saleType === 'bulk' && price <= 0) {
             showMessageModal('Datos Incompletos', 'Los productos a granel deben tener un precio por Kilo/Litro válido.');
            return false;
        }
        if (conversionFactor.enabled && (!conversionFactor.purchaseUnit || conversionFactor.factor <= 1)) {
            showMessageModal('Conversión Inválida', 'Define la unidad de compra (ej: Caja) y un factor mayor a 1 (ej: 12 piezas).');
            return false;
        }

        // 5. Reglas estrictas de BOUTIQUE / ROPA
        if (isApparel && features.hasVariants) {
            const hasVariants = quickVariants.length > 0;
            const hasStock = common.doesTrackStock ? parseFloat(common.getCommonData().stock || 0) > 0 : true;

            if (!hasVariants && !hasStock && common.doesTrackStock) {
                showMessageModal('Sin Inventario', 'No has agregado existencias. Por favor agrega variantes (Tallas/Colores) en la tabla inferior o define un stock inicial.');
                return false;
            }

            if (hasVariants) {
                const incompleteVariants = quickVariants.filter(v => !v.talla || !v.color);
                if (incompleteVariants.length > 0) {
                    showMessageModal('Variantes Incompletas', `Tienes ${incompleteVariants.length} variante(s) sin Talla o Color.`);
                    return false;
                }
                
                // Validación de precios en variantes
                const badVariant = quickVariants.find(v => (parseFloat(v.price) || price) < (parseFloat(v.cost) || cost));
                if (badVariant) {
                    if(!window.confirm(`⚠️ Una variante (${badVariant.color} ${badVariant.talla}) tiene precio menor al costo. ¿Continuar?`)) return false;
                }
            }
        }
        return true;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validateRetailRules()) return; // Detener si falla la validación
        
        if (common.isSaving) return;
        common.setIsSaving(true);

        try {
            const commonData = common.getCommonData();
            const productId = productToEdit?.id || generateID('prod');

            // Configuración de variantes
            const hasQuickVariants = isApparel && quickVariants.length > 0;
            const finalBatchManagement = hasQuickVariants
                ? { enabled: true, selectionStrategy: 'fifo' } // Ropa siempre usa lotes si hay variantes
                : (commonData.trackStock ? { enabled: true, selectionStrategy: 'fifo' } : { enabled: false });

            const payload = {
                id: productId,
                ...commonData,
                rubroContext: activeRubroContext,
                saleType,
                unit,
                minStock: minStock !== '' ? parseFloat(minStock) : null,
                maxStock: maxStock !== '' ? parseFloat(maxStock) : null,
                supplier,
                wholesaleTiers: wholesaleTiers.map(t => ({...t, min: parseFloat(t.min), price: parseFloat(t.price)})), // Asegurar tipos
                conversionFactor,
                shelfLife,
                batchManagement: finalBatchManagement,
                bulkData: { purchase: { unit: unit } },
                productType: 'sellable',
                ...(productToEdit ? {} : { createdAt: new Date().toISOString(), stock: 0 })
            };

            const success = await onSave(payload, productToEdit || { id: productId, isNew: true });

            if (success && hasQuickVariants) {
                const validVariants = quickVariants.filter(v => (v.talla && v.color));
                for (const variant of validVariants) {
                    const batchData = {
                        id: generateID('batch'),
                        productId: productId,
                        stock: parseFloat(variant.stock) || 0,
                        cost: parseFloat(variant.cost) || commonData.cost,
                        price: parseFloat(variant.price) || commonData.price,
                        sku: variant.sku || null,
                        attributes: { 
                            talla: variant.talla.toUpperCase(), 
                            color: variant.color 
                        },
                        isActive: true,
                        createdAt: new Date().toISOString(),
                        notes: 'Ingreso rápido Boutique',
                        trackStock: true
                    };
                    await saveBatchAndSyncProductSafe(batchData);
                }
            }
        } catch (error) {
            console.error("Error saving product:", error);
            showMessageModal('Error Técnico', error.message, { type: 'error' });
        } finally {
            common.setIsSaving(false);
        }
    };

    return (
        <>
            <form onSubmit={handleSubmit}>
                {isApparel && (
                    <div className="info-box-purple" style={{ marginBottom: '15px', display:'flex', alignItems:'center', gap:'10px' }}>
                        <span style={{fontSize:'1.5rem'}}>🛍️</span>
                        <div>
                            <strong>Modo Boutique Activo:</strong><br/>
                            Define el <u>Estilo General</u> arriba y usa la tabla inferior para desglosar <strong>Tallas y Colores</strong>.
                        </div>
                    </div>
                )}
                
                <CommonProductFields common={common} categories={categories} onOpenCategoryManager={onOpenCategoryManager} />

                {/* Módulo Frescos */}
                {features.hasDailyPricing && (
                    <div className="module-section" style={{ borderTop: '2px solid #86efac', marginTop: '20px', paddingTop: '15px' }}>
                        <FruteriaFields saleType={saleType} setSaleType={setSaleType} shelfLife={shelfLife} setShelfLife={setShelfLife} unit={unit} setUnit={setUnit} />
                    </div>
                )}

                {/* Módulo Abarrotes / Ferretería */}
                {(features.hasBulk || features.hasMinMax) && !features.hasDailyPricing && common.doesTrackStock && (
                    <div className="module-section" style={{ borderTop: '2px dashed #94a3b8', marginTop: '20px', paddingTop: '15px', position: 'relative' }}>
                        <span className="section-label-floating">📦 Logística & Inventario</span>
                        <AbarrotesFields
                            saleType={saleType} setSaleType={setSaleType}
                            unit={unit} setUnit={setUnit}
                            onManageWholesale={() => setIsWholesaleModalOpen(true)}
                            minStock={minStock} setMinStock={setMinStock}
                            maxStock={maxStock} setMaxStock={setMaxStock}
                            supplier={supplier} setSupplier={setSupplier}
                            location={common.storageLocation} setLocation={common.setStorageLocation}
                            conversionFactor={conversionFactor} setConversionFactor={setConversionFactor}
                            showSuppliers={features.hasSuppliers}
                            showBulk={features.hasBulk}
                            showWholesale={features.hasWholesale}
                            showStockAlerts={features.hasMinMax}
                        />
                    </div>
                )}

                {/* Módulo Ropa - Tabla Mejorada */}
                {isApparel && features.hasVariants && (
                    <div className="module-section" style={{ marginTop: '20px' }}>
                         <QuickVariantEntry 
                            basePrice={parseFloat(common.price) || 0} 
                            baseCost={parseFloat(common.cost) || 0} 
                            onVariantsChange={setQuickVariants} 
                        />
                    </div>
                )}

                <div className="form-actions-bar" style={{ marginTop: '25px' }}>
                    <button type="submit" className="btn btn-save" disabled={common.isSaving}>
                        {common.isSaving ? '⏳ Guardando...' : 'Guardar Producto'}
                    </button>
                    <button type="button" className="btn btn-cancel" onClick={onCancel}>Cancelar</button>
                </div>
            </form>
            <WholesaleManagerModal show={isWholesaleModalOpen} onClose={() => setIsWholesaleModalOpen(false)} tiers={wholesaleTiers} onSave={setWholesaleTiers} basePrice={parseFloat(common.price)} />
        </>
    );
}