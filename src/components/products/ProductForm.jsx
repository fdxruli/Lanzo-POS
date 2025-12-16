import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useAppStore } from '../../store/useAppStore';
import { compressImage, lookupBarcodeInAPI, showMessageModal, generateID } from '../../services/utils';
import { saveDataSafe, saveBatchAndSyncProductSafe } from '../../services/database';
import ScannerModal from '../common/ScannerModal';
import './ProductForm.css';

import FruteriaFields from './fieldsets/FruteriaFields';
import RestauranteFields from './fieldsets/RestauranteFields';
import AbarrotesFields from './fieldsets/AbarrotesFields';
import FarmaciaFields from './fieldsets/FarmaciaFIelds';
import QuickVariantEntry from './QuickVariantEntry';

import RecipeBuilderModal from './RecipeBuilderModal';
import WholesaleManagerModal from './WholesaleManagerModal';

const defaultPlaceholder = 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir';

export default function ProductForm({
    onSave, onCancel, productToEdit, categories, onOpenCategoryManager,
    products, onEdit, onManageBatches
}) {

    const [previewUrl, setPreviewUrl] = useState(null);
    const [isImageProcessing, setIsImageProcessing] = useState(false);
    const features = useFeatureConfig();
    const navigate = useNavigate();

    const companyProfile = useAppStore(state => state.companyProfile);

    const isApparel = (() => {
        const types = companyProfile?.businessType;
        if (Array.isArray(types)) return types.includes('apparel');
        return types === 'apparel';
    })();

    // --- ESTADOS COMUNES ---
    const [name, setName] = useState('');
    const [barcode, setBarcode] = useState('');
    const [description, setDescription] = useState('');
    const [imagePreview, setImagePreview] = useState(defaultPlaceholder);
    const [imageData, setImageData] = useState(null);
    const [categoryId, setCategoryId] = useState('');

    const [doesTrackStock, setDoesTrackStock] = useState(true);

    // --- ESTADOS ESPECÍFICOS ---
    const [productType, setProductType] = useState('sellable');
    const [recipe, setRecipe] = useState([]);
    const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
    const [printStation, setPrintStation] = useState('kitchen');
    const [prepTime, setPrepTime] = useState('');
    const [modifiers, setModifiers] = useState([]);
    const [quickVariants, setQuickVariants] = useState([]);

    const [saleType, setSaleType] = useState('unit');
    const [wholesaleTiers, setWholesaleTiers] = useState([]);
    const [isWholesaleModalOpen, setIsWholesaleModalOpen] = useState(false);
    const [minStock, setMinStock] = useState('');
    const [maxStock, setMaxStock] = useState('');

    // --- ESTADOS DE PRECIO Y COSTO INTEGRADOS ---
    const [cost, setCost] = useState('');
    const [price, setPrice] = useState('');
    const [margin, setMargin] = useState('');

    const [supplier, setSupplier] = useState('');

    const [sustancia, setSustancia] = useState('');
    const [laboratorio, setLaboratorio] = useState('');
    const [requiresPrescription, setRequiresPrescription] = useState(false);
    const [presentation, setPresentation] = useState('');

    const [shelfLife, setShelfLife] = useState('');
    const [unit, setUnit] = useState('kg');

    const [storageLocation, setStorageLocation] = useState('');
    const [conversionFactor, setConversionFactor] = useState({ enabled: false, purchaseUnit: '', factor: 1 });

    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [internalEditingProduct, setInternalEditingProduct] = useState(null);
    const [showSpecificData, setShowSpecificData] = useState(false);

    const [isSaving, setIsSaving] = useState(false);

    // --- EFECTO DE CARGA INICIAL ---
    useEffect(() => {
        setInternalEditingProduct(productToEdit);
        if (productToEdit) {
            setName(productToEdit.name);
            setBarcode(productToEdit.barcode || '');
            setDescription(productToEdit.description || '');
            setImagePreview(productToEdit.image || defaultPlaceholder);
            setImageData(productToEdit.image || null);
            setCategoryId(productToEdit.categoryId || '');

            setDoesTrackStock(productToEdit.trackStock !== false);

            setProductType(productToEdit.productType || 'sellable');
            setRecipe(productToEdit.recipe || []);
            setPrintStation(productToEdit.printStation || 'kitchen');
            setPrepTime(productToEdit.prepTime || '');
            setModifiers(productToEdit.modifiers || []);

            setSaleType(productToEdit.saleType || 'unit');
            setWholesaleTiers(productToEdit.wholesaleTiers || []);
            setMinStock(productToEdit.minStock || '');
            setMaxStock(productToEdit.maxStock || '');

            const pCost = productToEdit.cost || 0;
            const pPrice = productToEdit.price || 0;
            setCost(pCost === 0 ? '' : pCost);
            setPrice(pPrice === 0 ? '' : pPrice);

            if (pCost > 0 && pPrice > 0) {
                const initialMargin = ((pPrice - pCost) / pCost) * 100;
                setMargin(initialMargin.toFixed(1));
            } else {
                setMargin('');
            }

            setSupplier(productToEdit.supplier || '');

            setSustancia(productToEdit.sustancia || '');
            setLaboratorio(productToEdit.laboratorio || '');
            setRequiresPrescription(productToEdit.requiresPrescription || false);
            setPresentation(productToEdit.presentation || '');

            setShelfLife(productToEdit.shelfLife || '');
            const savedUnit = productToEdit.bulkData?.purchase?.unit
                || productToEdit.unit
                || (productToEdit.saleType === 'unit' ? 'pza' : 'kg');

            setUnit(savedUnit);

            setStorageLocation(productToEdit.location || '');
            setConversionFactor(productToEdit.conversionFactor || { enabled: false, purchaseUnit: '', factor: 1 });

            if (productToEdit.description || productToEdit.image) {
                setShowSpecificData(true);
            }
        } else {
            resetForm();
        }
    }, [productToEdit]);

    useEffect(() => {
        if (previewUrl && previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl);
        }
    }, [previewUrl]);

    // --- LÓGICA DE CÁLCULO AUTOMÁTICO ---
    const handleCostChange = (val) => {
        setCost(val);
        const numCost = parseFloat(val);
        const numPrice = parseFloat(price);
        if (!isNaN(numCost) && numCost > 0 && !isNaN(numPrice)) {
            const newMargin = ((numPrice - numCost) / numCost) * 100;
            setMargin(newMargin.toFixed(1));
        } else {
            setMargin('');
        }
    };

    const handlePriceChange = (val) => {
        setPrice(val);
        const numPrice = parseFloat(val);
        const numCost = parseFloat(cost);
        if (!isNaN(numCost) && numCost > 0 && !isNaN(numPrice)) {
            const newMargin = ((numPrice - numCost) / numCost) * 100;
            setMargin(newMargin.toFixed(1));
        }
    };

    const handleMarginChange = (val) => {
        setMargin(val);
        const numMargin = parseFloat(val);
        const numCost = parseFloat(cost);

        if (!isNaN(numMargin) && !isNaN(numCost) && numCost > 0) {
            const newPrice = numCost * (1 + (numMargin / 100));
            setPrice(newPrice.toFixed(2));
        }
    };

    const resetForm = () => {
        setName(''); setBarcode(''); setDescription('');
        setImagePreview(defaultPlaceholder); setImageData(null);
        setCategoryId('');
        setDoesTrackStock(true);
        setProductType('sellable'); setRecipe([]); setPrintStation('kitchen'); setPrepTime(''); setModifiers([]);
        setSaleType('unit'); setWholesaleTiers([]); setMinStock(''); setMaxStock('');
        setCost(''); setPrice(''); setMargin('');
        setSupplier('');
        setSustancia(''); setLaboratorio(''); setRequiresPrescription(false); setPresentation('');
        setShelfLife(''); setUnit('kg');
        setInternalEditingProduct(null); setShowSpecificData(false);
        setStorageLocation('');
        setConversionFactor({ enabled: false, purchaseUnit: '', factor: 1 });
    };

    const handleImageChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            setIsImageProcessing(true);
            setTimeout(async () => {
                try {
                    const compressedFile = await compressImage(file);
                    if (previewUrl && previewUrl.startsWith('blob:')) {
                        URL.revokeObjectURL(previewUrl);
                    }
                    const newUrl = URL.createObjectURL(compressedFile);
                    setPreviewUrl(newUrl);
                    setImagePreview(newUrl);
                    setImageData(compressedFile);
                } catch (error) {
                    showMessageModal("Error al procesar imagen", null, { type: 'error' });
                } finally {
                    setIsImageProcessing(false);
                }
            }, 100);
        }
    };

    const handleBarcodeLookup = async (codeToLookup) => {
        if (!codeToLookup) return;
        setIsLookingUp(true);
        const apiResult = await lookupBarcodeInAPI(codeToLookup);
        setIsLookingUp(false);

        if (apiResult.success) {
            setName(apiResult.product.name || name);
            if (apiResult.product.image) {
                setImagePreview(apiResult.product.image);
                setImageData(apiResult.product.image);
            }
            showMessageModal('¡Producto encontrado!');
        } else {
            showMessageModal(`Producto no encontrado.`, null, { type: 'error' });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (isSaving) return;

        // 1. VALIDACIÓN PREVIA (Recetas / Restaurantes)
        if (features.hasRecipes && productType === 'sellable' && recipe.length === 0) {
            showMessageModal(
                '⚠️ Receta Incompleta: Has marcado este producto como "Platillo" pero no has agregado ingredientes. Agrega insumos o cambia el tipo a "Insumo/Venta Simple".',
                null,
                { type: 'error' }
            );
            return;
        }

        setIsSaving(true);

        try {
            // 2. PREPARACIÓN DE DATOS NUMÉRICOS
            const finalPrice = parseFloat(price) || 0;
            const finalCost = parseFloat(cost) || 0;
            const finalMinStock = minStock !== '' ? parseFloat(minStock) : null;
            const finalMaxStock = maxStock !== '' ? parseFloat(maxStock) : null;

            // 3. LÓGICA DE TIPO DE VENTA
            let finalSaleType = saleType;
            // CORRECCIÓN CRÍTICA: Guardar la unidad SIEMPRE (Manojo, Caja, etc.)
            let finalBulkData = { purchase: { unit: unit } };

            if (features.hasLabFields && requiresPrescription) {
                finalSaleType = 'unit';
                finalBulkData = { purchase: { unit: unit || 'pza' } };
            }

            // 4. LÓGICA DE VARIANTES RÁPIDAS (ROPA/CALZADO) 👕👟
            // Verificamos si el usuario llenó la tabla de variantes (QuickVariantEntry)
            // Nota: Asegúrate de tener el estado `quickVariants` definido en tu componente
            const hasQuickVariants = features.hasVariants && typeof quickVariants !== 'undefined' && quickVariants.length > 0;

            // Si hay variantes, activamos forzosamente el control de stock y gestión de lotes
            const finalTrackStock = hasQuickVariants ? true : doesTrackStock;
            const finalBatchManagement = hasQuickVariants
                ? { enabled: true, selectionStrategy: 'fifo' }
                : (doesTrackStock ? { enabled: true, selectionStrategy: 'fifo' } : { enabled: false });

            // 5. GENERACIÓN DE ID (TRUCO DE VINCULACIÓN) 🪄
            // Si es nuevo, generamos el ID aquí mismo. Esto es vital para poder usar este ID
            // al guardar las variantes (hijos) inmediatamente después.
            const productIdToUse = internalEditingProduct?.id || generateID('prod');

            // Creamos un objeto "falso" de edición para forzar a 'ProductsPage' a usar nuestro ID
            // en lugar de generar uno nuevo desconectado.
            const effectiveEditingProduct = internalEditingProduct || { id: productIdToUse, isNew: true };

            let productData = {
                id: productIdToUse, // Usamos el ID controlado
                name: name.trim(),
                barcode: barcode.trim(),
                description: description.trim(),
                categoryId,
                image: imageData,
                location: storageLocation.trim(),
                conversionFactor: conversionFactor,
                trackStock: finalTrackStock,       // Actualizado por lógica de variantes
                batchManagement: finalBatchManagement, // Actualizado por lógica de variantes
                productType: features.hasRecipes ? productType : 'sellable',
                recipe: (features.hasRecipes && productType === 'sellable') ? recipe : [],
                printStation, prepTime, modifiers,
                saleType: finalSaleType,
                bulkData: finalBulkData,
                wholesaleTiers,
                minStock: finalMinStock,
                maxStock: finalMaxStock,
                price: finalPrice,
                cost: finalCost,
                supplier,
                sustancia, laboratorio, requiresPrescription, presentation,
                shelfLife,
                // Si es producto nuevo, agregamos fecha de creación manual para que no falte
                ...(internalEditingProduct ? {} : { createdAt: new Date().toISOString(), stock: 0 })
            };

            // 6. GUARDAR PRODUCTO PADRE
            // Enviamos el producto y nuestro objeto 'effectiveEditingProduct' para mantener el ID
            const success = await onSave(productData, effectiveEditingProduct);

            // Si falló el guardado del padre, nos detenemos aquí
            if (!success) {
                setIsSaving(false);
                return;
            }

            // 7. PROCESAR Y GUARDAR VARIANTES (HIJOS) 📦
            if (hasQuickVariants) {
                // Filtramos filas vacías o inválidas
                const validVariants = quickVariants.filter(v => (v.talla || v.color) && (parseFloat(v.stock) > 0 || v.sku));

                for (const variant of validVariants) {
                    const batchData = {
                        id: generateID('batch'),
                        productId: productIdToUse, // ¡Aquí usamos el ID generado en el paso 5!
                        stock: parseFloat(variant.stock) || 0,
                        cost: parseFloat(variant.cost) || finalCost, // Hereda costo si falta
                        price: parseFloat(variant.price) || finalPrice, // Hereda precio si falta
                        sku: variant.sku || null,
                        attributes: {
                            talla: variant.talla || '',
                            color: variant.color || ''
                        },
                        isActive: true,
                        createdAt: new Date().toISOString(),
                        notes: 'Ingreso rápido inicial',
                        trackStock: true
                    };

                    // Guardamos cada variante individualmente y sincronizamos stock
                    await saveBatchAndSyncProductSafe(batchData);
                }
            }

            // 8. LIMPIEZA FINAL
            if (success) {
                resetForm();
                // Limpiamos la tabla de variantes rápidas si existe el setter
                if (typeof setQuickVariants === 'function') setQuickVariants([]);
            }

        } catch (error) {
            console.error("Error al guardar el producto:", error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <>
            <div className="product-form-container">
                <h3 className="subtitle">
                    {internalEditingProduct ? `Editar: ${internalEditingProduct.name}` : 'Añadir Nuevo Producto'}
                </h3>

                <form id="product-form" onSubmit={handleSubmit} noValidate>

                    <div className="form-group">
                        <label className="form-label">Nombre del Producto *</label>
                        <input className="form-input" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Código de Barras</label>
                        <div className="input-with-button">
                            <input className="form-input" type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
                            <button type="button" className="btn-scan-inline" onClick={() => setIsScannerOpen(true)}>📷</button>
                            <button type="button" className="btn-lookup" onClick={() => handleBarcodeLookup(barcode)} disabled={isLookingUp}>🔍</button>
                        </div>
                    </div>

                    {/* --- SECCIÓN INTEGRADA DE PRECIOS Y COSTOS --- */}
                    <div style={{
                        backgroundColor: '#f8fafc',
                        padding: '15px',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                        marginBottom: '20px'
                    }}>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                                <label className="form-label" style={{ fontSize: '0.85rem' }}>Costo ($)</label>
                                <input
                                    type="number" className="form-input"
                                    value={cost} onChange={e => handleCostChange(e.target.value)}
                                    placeholder="0.00" min="0" step="0.01"
                                />
                            </div>

                            <div className="form-group" style={{ width: '80px', marginBottom: 0 }}>
                                <label className="form-label" style={{ fontSize: '0.85rem', color: 'var(--primary-color)' }}>Ganancia</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type="number" className="form-input"
                                        value={margin} onChange={e => handleMarginChange(e.target.value)}
                                        placeholder="%"
                                        style={{ borderColor: 'var(--primary-color)', textAlign: 'center', paddingRight: '20px' }}
                                    />
                                    <span style={{ position: 'absolute', right: '5px', top: '10px', fontSize: '0.8rem', color: '#999' }}>%</span>
                                </div>
                            </div>

                            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                                <label className="form-label" style={{ fontSize: '0.85rem' }}>Precio Venta *</label>
                                <input
                                    type="number" className="form-input"
                                    value={price} onChange={e => handlePriceChange(e.target.value)}
                                    required placeholder="0.00" min="0" step="0.01"
                                    style={{ fontWeight: 'bold', fontSize: '1.1rem' }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* --- INTERRUPTOR DE STOCK --- */}
                    <div className="form-group-checkbox" style={{
                        backgroundColor: doesTrackStock ? '#f0fdf4' : '#f3f4f6',
                        padding: '12px',
                        borderRadius: '8px',
                        border: `1px solid ${doesTrackStock ? '#bbf7d0' : '#d1d5db'}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '15px',
                        cursor: 'pointer',
                        marginTop: '10px'
                    }} onClick={() => setDoesTrackStock(!doesTrackStock)}>

                        <div style={{
                            width: '44px', height: '24px',
                            backgroundColor: doesTrackStock ? 'var(--success-color)' : '#9ca3af',
                            borderRadius: '20px', position: 'relative', transition: 'all 0.3s'
                        }}>
                            <div style={{
                                width: '18px', height: '18px', backgroundColor: 'white', borderRadius: '50%',
                                position: 'absolute', top: '3px',
                                left: doesTrackStock ? '23px' : '3px',
                                transition: 'all 0.3s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                            }}></div>
                        </div>

                        <div>
                            <span style={{ fontWeight: 'bold', display: 'block', color: 'var(--text-dark)' }}>
                                {doesTrackStock ? 'Controlar Inventario' : 'Venta Libre (Sin Stock)'}
                            </span>
                        </div>
                    </div>

                    {/* --- MÓDULOS ESPECÍFICOS --- */}

                    {features.hasRecipes && (
                        <div className="module-section">
                            <RestauranteFields
                                productType={productType} setProductType={setProductType}
                                onManageRecipe={() => setIsRecipeModalOpen(true)}
                                printStation={printStation} setPrintStation={setPrintStation}
                                prepTime={prepTime} setPrepTime={setPrepTime}
                                modifiers={modifiers} setModifiers={setModifiers}
                            />
                        </div>
                    )}

                    {features.hasLabFields && (
                        <div className="module-section" style={{ borderTop: '2px dashed #e5e7eb', marginTop: '15px', paddingTop: '15px' }}>
                            <FarmaciaFields
                                sustancia={sustancia} setSustancia={setSustancia}
                                laboratorio={laboratorio} setLaboratorio={setLaboratorio}
                                requiresPrescription={requiresPrescription} setRequiresPrescription={setRequiresPrescription}
                                presentation={presentation} setPresentation={setPresentation}
                            />
                        </div>
                    )}

                    {features.hasDailyPricing && (
                        <div className="module-section" style={{ borderTop: '2px dashed #e5e7eb', marginTop: '15px', paddingTop: '15px' }}>
                            <FruteriaFields
                                saleType={saleType} setSaleType={setSaleType}
                                shelfLife={shelfLife} setShelfLife={setShelfLife}
                                unit={unit} setUnit={setUnit}
                            />
                        </div>
                    )}

                    {/* Módulo Abarrotes / Ferretería */}
                    {(features.hasBulk || features.hasMinMax) && !features.hasDailyPricing && doesTrackStock && (
                        <div className="module-section" style={{ borderTop: '2px dashed #e5e7eb', marginTop: '15px', paddingTop: '15px' }}>
                            <AbarrotesFields
                                saleType={saleType} setSaleType={setSaleType}
                                unit={unit} setUnit={setUnit}
                                onManageWholesale={() => setIsWholesaleModalOpen(true)}
                                minStock={minStock} setMinStock={setMinStock}
                                maxStock={maxStock} setMaxStock={setMaxStock}
                                showSuppliers={features.hasSuppliers}
                                showBulk={features.hasBulk}
                                showWholesale={features.hasWholesale}
                                showStockAlerts={features.hasMinMax}
                                supplier={supplier} setSupplier={setSupplier}
                                location={storageLocation} setLocation={setStorageLocation}
                                conversionFactor={conversionFactor} setConversionFactor={setConversionFactor}
                            />
                        </div>
                    )}

                    {internalEditingProduct && doesTrackStock && (features.hasLots || features.hasVariants) && (
                        <div className="form-group" style={{ marginTop: '20px' }}>
                            <button type="button" className="btn btn-secondary" onClick={() => onManageBatches(internalEditingProduct.id)}>
                                Gestionar {features.hasVariants ? 'Variantes (Tallas/Colores)' : 'Lotes (Stock/Costos)'}
                            </button>
                        </div>
                    )}

                    {features.hasVariants && isApparel && (
                        <div className="module-section" style={{ borderTop: '2px dashed #e5e7eb', marginTop: '15px', paddingTop: '15px' }}>
                            <h4 className="subtitle" style={{ fontSize: '1rem' }}>Detalles de Ropa / Variantes</h4>

                            <QuickVariantEntry
                                basePrice={parseFloat(price) || 0}
                                baseCost={parseFloat(cost) || 0}
                                onVariantsChange={setQuickVariants}
                            />
                        </div>
                    )}

                    <button type="button" className="btn-toggle-specific" onClick={() => setShowSpecificData(!showSpecificData)}>
                        {showSpecificData ? 'Ocultar detalles (Foto, Cat, Desc)' : 'Agregar Foto, Categoría o Descripción'}
                        {showSpecificData ? ' 🔼' : ' 🔽'}
                    </button>

                    {showSpecificData && (
                        <div className="specific-data-container">
                            <div className="form-group">
                                <label className="form-label">Categoría</label>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <select className="form-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                                        <option value="">Sin categoría</option>
                                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                                    </select>
                                    <button type="button" className="btn btn-help" onClick={onOpenCategoryManager}>+</button>
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Descripción</label>
                                <textarea className="form-textarea" rows="2" value={description} onChange={(e) => setDescription(e.target.value)}></textarea>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Imagen</label>
                                <div className="image-upload-container">
                                    <img className="image-preview" src={imagePreview} alt="Preview" style={{ opacity: isImageProcessing ? 0.5 : 1 }} />
                                    <input className="file-input" type="file" accept="image/*" onChange={handleImageChange} disabled={isImageProcessing} />
                                </div>
                            </div>
                        </div>
                    )}

                    <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
                        <button
                            type="submit"
                            className="btn btn-save"
                            style={{ flex: 2, opacity: isSaving ? 0.7 : 1, cursor: isSaving ? 'wait' : 'pointer' }}
                            disabled={isSaving}
                        >
                            {isSaving ? '⏳ Guardando...' : 'Guardar Producto'}
                        </button>
                        <button type="button" className="btn btn-cancel" style={{ flex: 1 }} onClick={onCancel}>Cancelar</button>
                    </div>
                </form>
            </div>

            <ScannerModal show={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScanSuccess={(code) => { setBarcode(code); setIsScannerOpen(false); }} />
            <RecipeBuilderModal show={isRecipeModalOpen} onClose={() => setIsRecipeModalOpen(false)} existingRecipe={recipe} onSave={setRecipe} productName={name} />
            <WholesaleManagerModal show={isWholesaleModalOpen} onClose={() => setIsWholesaleModalOpen(false)} tiers={wholesaleTiers} onSave={setWholesaleTiers} basePrice={parseFloat(price)} />
        </>
    );
}
