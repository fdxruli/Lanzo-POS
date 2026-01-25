import React, { useState, useEffect } from 'react';
import { useProductCommon } from '../../../hooks/useProductCommon';
import CommonProductFields from './CommonProductFields';
import AbarrotesFields from '../fieldsets/AbarrotesFields';
import FruteriaFields from '../fieldsets/FruteriaFields';
import QuickVariantEntry from '../QuickVariantEntry';
import WholesaleManagerModal from '../WholesaleManagerModal';
import { generateID, showMessageModal } from '../../../services/utils'; // Importamos showMessageModal
import { saveBatchAndSyncProductSafe, queryBatchesByProductIdAndActive } from '../../../services/database';
import Logger from '../../../services/Logger';

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
    const [existingVariants, setExistingVariants] = useState([]);


    useEffect(() => {
        const loadVariants = async () => {
            // Solo cargamos si estamos editando, es ropa y tiene ID
            if (productToEdit?.id && activeRubroContext === 'apparel') {
                try {
                    const batches = await queryBatchesByProductIdAndActive(productToEdit.id);

                    if (batches.length > 0) {
                        // Transformamos el formato de la BD al formato visual de la tabla
                        const formattedRows = batches.map(b => ({
                            id: b.id, // IMPORTANTE: Guardamos el ID real de la BD
                            talla: b.attributes?.talla || '',
                            color: b.attributes?.color || '',
                            sku: b.sku || '',
                            stock: b.stock || 0,
                            cost: b.cost || common.cost,
                            price: b.price || common.price
                        }));

                        setExistingVariants(formattedRows);
                        setQuickVariants(formattedRows); // Sincronizamos el estado del formulario también
                    }
                } catch (error) {
                    console.error("Error cargando variantes:", error);
                }
            }
        };

        loadVariants();
    }, [productToEdit?.id, activeRubroContext]);

    // Estado para Ropa (Variantes rápidas)
    const [quickVariants, setQuickVariants] = useState([]);
    const isApparel = activeRubroContext === 'apparel';

    const hasActiveVariants = quickVariants.some(v =>
        (v.talla && v.talla.trim() !== '') ||
        (v.color && v.color.trim() !== '')
    )

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

            // ESCENARIO A: El usuario SÍ quiere variantes (escribió algo en la tabla)
            if (hasActiveVariants) {
                // Aquí sí somos estrictos: si empezó a escribir, debe terminar
                const incompleteVariants = quickVariants.filter(v =>
                    (v.talla || v.color) && (!v.talla || !v.color)
                );

                if (incompleteVariants.length > 0) {
                    showMessageModal('Variantes Incompletas', `Tienes filas con datos a medias. Por favor define Talla Y Color, o elimina la fila.`);
                    return false;
                }

                // Validación de precios en variantes
                const badVariant = quickVariants.find(v =>
                    (v.talla && v.color) && // Solo revisar filas completas
                    ((parseFloat(v.price) || price) < (parseFloat(v.cost) || cost))
                );

                if (badVariant) {
                    if (!window.confirm(`⚠️ La variante (${badVariant.color} ${badVariant.talla}) tiene precio menor al costo. ¿Continuar?`)) return false;
                }
            }

            // ESCENARIO B: NO hay variantes (producto único/unitalla)
            else {
                // Validamos el stock GLOBAL como un producto normal
                const hasGlobalStock = common.doesTrackStock ? parseFloat(common.getCommonData().stock || 0) > 0 : true;

                if (!hasGlobalStock && common.doesTrackStock) {
                    showMessageModal('Sin Inventario', 'No has agregado existencias. \n\nComo no definiste Variantes (Talla/Color), debes ingresar el Stock en el campo general "Cantidad Inicial".');
                    return false;
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

            // Cálculo de stock final considerando variantes rápidas
            let totalVariantStock = 0;
            if (isApparel && quickVariants.length > 0) {
                totalVariantStock = quickVariants.reduce((sum, variant) => {
                    return sum + (parseFloat(variant.stock) || 0);
                }, 0);

                // Si las variantes suman algo, forzamos que el sistema rastree inventario
                if (totalVariantStock > 0) {
                    commonData.trackStock = true;
                }
            }

            const initialDbStock = (isApparel && hasActiveVariants)
                ? 0
                : commonData.stock;

            // Configuración de variantes
            const hasQuickVariants = isApparel && quickVariants.length > 0;
            const finalBatchManagement = (isApparel && hasActiveVariants)
                ? { enabled: true, selectionStrategy: 'fifo' } 
                : (commonData.trackStock ? { enabled: true, selectionStrategy: 'fifo' } : { enabled: false });

            const payload = {
                id: productId,
                ...commonData,
                stock: initialDbStock,
                rubroContext: activeRubroContext,
                saleType,
                unit,
                minStock: minStock !== '' ? parseFloat(minStock) : null,
                maxStock: maxStock !== '' ? parseFloat(maxStock) : null,
                supplier,
                wholesaleTiers: wholesaleTiers.map(t => ({ ...t, min: parseFloat(t.min), price: parseFloat(t.price) })), // Asegurar tipos
                conversionFactor,
                shelfLife,
                batchManagement: finalBatchManagement,
                bulkData: { purchase: { unit: unit } },
                productType: 'sellable',
                ...(productToEdit ? {} : { createdAt: new Date().toISOString() })
            };

            const success = await onSave(payload, productToEdit || { id: productId, isNew: true });

            if (success && isApparel && hasActiveVariants) {
                // Bloque TRY/CATCH exclusivo para la creación de variantes
                try {
                    const validVariants = quickVariants.filter(v => (v.talla && v.color));

                    // 1. PREPARAMOS TODAS LAS PROMESAS (En paralelo, no secuencial)
                    // Esto crea un array de operaciones pendientes sin ejecutarlas una por una bloqueando el hilo.
                    const batchPromises = validVariants.map(variant => {

                        // DETECTAR SI ES EDICIÓN O CREACIÓN
                        // Los IDs temporales de la interfaz son números (Date.now()), los de la BD son Strings (UUIDs)
                        const isNewVariant = typeof variant.id === 'number';
                        const finalId = isNewVariant ? generateID('batch') : variant.id;

                        // LÓGICA DE SKU (Tu corrección anterior)
                        let finalSku = variant.sku;
                        if (!finalSku) {
                            const c = variant.color ? variant.color.substring(0, 3).toUpperCase() : 'GEN';
                            const t = variant.talla ? variant.talla.toUpperCase() : 'U';
                            const rnd = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
                            finalSku = `${c}-${t}-${rnd}`.toUpperCase().replace(/\s+/g, '');
                        }

                        const batchData = {
                            id: finalId, // <--- USAMOS EL ID CORRECTO (EXISTENTE O NUEVO)
                            productId: productId,
                            stock: parseFloat(variant.stock) || 0,
                            cost: parseFloat(variant.cost) || commonData.cost,
                            price: parseFloat(variant.price) || commonData.price,
                            sku: finalSku,
                            attributes: {
                                talla: variant.talla.toUpperCase(),
                                color: variant.color
                            },
                            isActive: true,
                            createdAt: isNewVariant ? new Date().toISOString() : undefined, // Mantener fecha original si existe (la BD lo maneja si es undefined en update, o puedes cargarla)
                            // Nota: Si database.js usa put(), reemplazará todo el objeto. 
                            // Idealmente deberías hacer un merge si es update, pero para este caso, aseguramos re-escribir los datos frescos.
                            trackStock: true
                        };

                        // Si es update, es mejor conservar el createdAt original si lo tienes, 
                        // pero database.js put() suele sobreescribir. 
                        // Si necesitas preservar la fecha de creación exacta, deberías traerla en el map del Paso 2.

                        return saveBatchAndSyncProductSafe(batchData);
                    });

                    // 2. EJECUCIÓN ATÓMICA (Simulada)
                    // Esperamos a que TODAS se guarden. Si una falla, el catch lo atrapa.
                    await Promise.all(batchPromises);

                    // Opcional: Log de éxito
                    Logger.info(`Creadas ${batchPromises.length} variantes para producto ${productId}`);

                } catch (variantError) {
                    // 3. GESTIÓN DE ERRORES ESPECÍFICA
                    // El producto padre YA SE GUARDÓ, así que no podemos decir simplemente "Error".
                    // Debemos advertir que la "extensión" de tallas falló.
                    Logger.error("Error crítico guardando variantes:", variantError);

                    showMessageModal(
                        '⚠️ Atención: Guardado Parcial',
                        'El producto principal se creó correctamente, pero hubo un error generando algunas tallas o colores.\n\nPor favor ve a la pestaña "Inventario" de este producto para verificar qué variantes faltan.',
                        { type: 'warning' }
                    );
                }
            }
        } catch (error) {
            Logger.error("Error saving product:", error);
            showMessageModal('Error Técnico', error.message, { type: 'error' });
        } finally {
            common.setIsSaving(false);
        }
    };

    return (
        <>
            <form onSubmit={handleSubmit}>
                {isApparel && (
                    <div className="info-box-purple" style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '1.5rem' }}>🛍️</span>
                        <div>
                            <strong>Modo Boutique Activo:</strong><br />
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
                            shelfLife={shelfLife}
                            setShelfLife={setShelfLife}
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
                            initialData={existingVariants}
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