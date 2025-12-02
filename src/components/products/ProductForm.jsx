import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { compressImage, lookupBarcodeInAPI, showMessageModal } from '../../services/utils';
import ScannerModal from '../common/ScannerModal';
import './ProductForm.css';

import FruteriaFields from './fieldsets/FruteriaFields';
import RestauranteFields from './fieldsets/RestauranteFields';
import AbarrotesFields from './fieldsets/AbarrotesFields';
import FarmaciaFields from './fieldsets/FarmaciaFIelds';

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

    // --- ESTADOS COMUNES ---
    const [name, setName] = useState('');
    const [barcode, setBarcode] = useState('');
    const [description, setDescription] = useState('');
    const [imagePreview, setImagePreview] = useState(defaultPlaceholder);
    const [imageData, setImageData] = useState(null);
    const [categoryId, setCategoryId] = useState('');

    // --- ESTADOS ESPECÍFICOS ---
    const [productType, setProductType] = useState('sellable');
    const [recipe, setRecipe] = useState([]);
    const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
    const [printStation, setPrintStation] = useState('kitchen');
    const [prepTime, setPrepTime] = useState('');
    const [modifiers, setModifiers] = useState([]);

    const [saleType, setSaleType] = useState('unit');
    const [wholesaleTiers, setWholesaleTiers] = useState([]);
    const [isWholesaleModalOpen, setIsWholesaleModalOpen] = useState(false);
    const [minStock, setMinStock] = useState('');
    const [maxStock, setMaxStock] = useState('');
    const [cost, setCost] = useState('');
    const [price, setPrice] = useState('');
    const [supplier, setSupplier] = useState('');

    const [sustancia, setSustancia] = useState('');
    const [laboratorio, setLaboratorio] = useState('');
    const [requiresPrescription, setRequiresPrescription] = useState(false);
    const [presentation, setPresentation] = useState('');

    const [shelfLife, setShelfLife] = useState('');
    const [unit, setUnit] = useState('kg');

    // --- ESTADOS DE UI ---
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [internalEditingProduct, setInternalEditingProduct] = useState(null);
    const [showSpecificData, setShowSpecificData] = useState(false);

    useEffect(() => {
        setInternalEditingProduct(productToEdit);
        if (productToEdit) {
            setName(productToEdit.name);
            setBarcode(productToEdit.barcode || '');
            setDescription(productToEdit.description || '');
            setImagePreview(productToEdit.image || defaultPlaceholder);
            setImageData(productToEdit.image || null);
            setCategoryId(productToEdit.categoryId || '');

            setProductType(productToEdit.productType || 'sellable');
            setRecipe(productToEdit.recipe || []);
            setPrintStation(productToEdit.printStation || 'kitchen');
            setPrepTime(productToEdit.prepTime || '');
            setModifiers(productToEdit.modifiers || []);

            setSaleType(productToEdit.saleType || 'unit');
            setWholesaleTiers(productToEdit.wholesaleTiers || []);
            setMinStock(productToEdit.minStock || '');
            setMaxStock(productToEdit.maxStock || '');
            setCost(productToEdit.cost || '');
            setPrice(productToEdit.price || '');
            setSupplier(productToEdit.supplier || '');

            setSustancia(productToEdit.sustancia || '');
            setLaboratorio(productToEdit.laboratorio || '');
            setRequiresPrescription(productToEdit.requiresPrescription || false);
            setPresentation(productToEdit.presentation || '');

            setShelfLife(productToEdit.shelfLife || '');
            setUnit(productToEdit.bulkData?.purchase?.unit || 'kg');

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

    const resetForm = () => {
        setName(''); setBarcode(''); setDescription('');
        setImagePreview(defaultPlaceholder); setImageData(null);
        setCategoryId('');
        setProductType('sellable'); setRecipe([]); setPrintStation('kitchen'); setPrepTime(''); setModifiers([]);
        setSaleType('unit'); setWholesaleTiers([]); setMinStock(''); setMaxStock(''); setCost(''); setPrice(''); setSupplier('');
        setSustancia(''); setLaboratorio(''); setRequiresPrescription(false); setPresentation('');
        setShelfLife(''); setUnit('kg');
        setInternalEditingProduct(null); setShowSpecificData(false);
    };

    const handleImageChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            setIsImageProcessing(true);
            setTimeout(async () => {
                try {
                    const compressedFile = await compressImage(file);

                    // Liberar la anterior si existe para no acumular basura
                    if (previewUrl && previewUrl.startsWith('blob:')) {
                        URL.revokeObjectURL(previewUrl);
                    }

                    const newUrl = URL.createObjectURL(compressedFile);
                    setPreviewUrl(newUrl); // Guardamos referencia para limpiar luego
                    setImagePreview(newUrl); // Actualizamos la vista
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
            showMessageModal(`Producto no encontrado.`);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        // --- 1. LIMPIEZA Y CONVERSIÓN DE DATOS ---
        const finalPrice = parseFloat(price) || 0;
        const finalCost = parseFloat(cost) || 0;
        const finalMinStock = minStock !== '' ? parseFloat(minStock) : null;
        const finalMaxStock = maxStock !== '' ? parseFloat(maxStock) : null;

        // --- 2. VALIDACIONES DE NEGOCIO (REGLAS DE ORO) ---

        // A) Nombre obligatorio
        if (!name || name.trim().length < 2) {
            showMessageModal('⚠️ El nombre es obligatorio (mínimo 2 letras).', null, { type: 'error' });
            return;
        }

        // B) Precios Negativos
        if (finalPrice < 0) {
            showMessageModal('⚠️ El precio de venta no puede ser negativo.', null, { type: 'error' });
            return;
        }
        if (finalCost < 0) {
            showMessageModal('⚠️ El costo no puede ser negativo.', null, { type: 'error' });
            return;
        }

        // C) Alerta de Pérdida (Costo > Precio)
        // Solo alertamos si ambos son mayores a 0 para no molestar en creación rápida
        if (finalCost > finalPrice && finalPrice > 0) {
            if (!window.confirm(`⚠️ ADVERTENCIA DE PÉRDIDA:\n\nEl costo ($${finalCost}) es mayor que el precio de venta ($${finalPrice}).\n\n¿Estás seguro de que deseas guardar este producto así?`)) {
                return;
            }
        }

        // D) Lógica de Stock (Mínimo > Máximo)
        if (finalMinStock !== null && finalMaxStock !== null && finalMinStock > finalMaxStock) {
            showMessageModal('⚠️ Lógica inválida: El Stock Mínimo no puede ser mayor al Stock Máximo.', null, { type: 'error' });
            return;
        }

        // --- 3. PREPARACIÓN DEL OBJETO ---

        let finalSaleType = saleType;
        let finalBulkData = (saleType === 'bulk') ? { purchase: { unit: unit } } : null;

        if (features.hasLabFields && requiresPrescription) {
            finalSaleType = 'unit';
            finalBulkData = null;
        }

        let productData = {
            id: internalEditingProduct?.id,
            name: name.trim(),
            barcode: barcode.trim(),
            description: description.trim(),
            categoryId,
            image: imageData,

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
        };

        onSave(productData, internalEditingProduct);
        resetForm();
    };

    return (
        <>
            <div className="product-form-container">
                <h3 className="subtitle">
                    {internalEditingProduct ? `Editar: ${internalEditingProduct.name}` : 'Añadir Nuevo Producto'}
                </h3>

                <form id="product-form" onSubmit={handleSubmit}>

                    {/* --- A. CAMPOS PRINCIPALES (Siempre visibles) --- */}
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

                    {/* --- B. PRECIOS (SIEMPRE VISIBLES AHORA) --- */}
                    <div style={{ display: 'flex', gap: '15px' }}>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label className="form-label">Precio Venta *</label>
                            <input
                                type="number"
                                className="form-input"
                                value={price}
                                onChange={e => setPrice(e.target.value)}
                                required
                                placeholder="0.00"
                                min="0" // HTML5 validation visual
                                step="0.01"
                            />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label className="form-label">Costo</label>
                            <input
                                type="number"
                                className="form-input"
                                value={cost}
                                onChange={e => setCost(e.target.value)}
                                placeholder="0.00"
                                min="0"
                                step="0.01"
                            />
                        </div>
                    </div>

                    {/* --- C. MÓDULOS ESPECÍFICOS (Se apilan) --- */}

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
                                price={price} setPrice={setPrice}
                                cost={cost} setCost={setCost}
                                shelfLife={shelfLife} setShelfLife={setShelfLife}
                                unit={unit} setUnit={setUnit}
                            />
                        </div>
                    )}

                    {/* Módulo Abarrotes / Ferretería (Ahora solo Stock y Mayoreo) */}
                    {(features.hasBulk || features.hasMinMax) && !features.hasDailyPricing && (
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
                            />
                        </div>
                    )}

                    {/* --- D. GESTIÓN DE LOTES (Si aplica y ya existe el producto) --- */}
                    {internalEditingProduct && (features.hasLots || features.hasVariants) && (
                        <div className="form-group" style={{ marginTop: '20px' }}>
                            <button type="button" className="btn btn-secondary" onClick={() => onManageBatches(internalEditingProduct.id)}>
                                Gestionar {features.hasVariants ? 'Variantes (Tallas/Colores)' : 'Lotes (Stock/Costos)'}
                            </button>
                        </div>
                    )}

                    {/* --- E. DATOS SECUNDARIOS (Ocultos) --- */}
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
                        <button type="submit" className="btn btn-save" style={{ flex: 2 }}>Guardar Producto</button>
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