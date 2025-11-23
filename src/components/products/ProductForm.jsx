import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { compressImage, lookupBarcodeInAPI, showMessageModal } from '../../services/utils';
import ScannerModal from '../common/ScannerModal';
import FruteriaFields from './fieldsets/FruteriaFields';
import './ProductForm.css';

// -- IMPORTACIÓN DE LOS MINI-FORMULARIOS (FIELDSETS) ---
import RestauranteFields from './fieldsets/RestauranteFields';
import AbarrotesFields from './fieldsets/AbarrotesFields';
import FarmaciaFields from './fieldsets/FarmaciaFIelds'; // Nota: Mantenemos el nombre del import como está en tu archivo original

// --- IMPORTACIÓN DE LOS MODALES DE GESTIÓN ---
import RecipeBuilderModal from './RecipeBuilderModal';
import WholesaleManagerModal from './WholesaleManagerModal';

const defaultPlaceholder = 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir';

export default function ProductForm({
    onSave, onCancel, productToEdit, categories, onOpenCategoryManager,
    products, onEdit, onManageBatches
}) {

    // 1. Hook de Configuración (El cerebro)
    const features = useFeatureConfig();
    const navigate = useNavigate();

    // --- ESTADOS COMUNES (Todo producto los tiene) ---
    const [name, setName] = useState('');
    const [barcode, setBarcode] = useState('');
    const [description, setDescription] = useState('');
    const [imagePreview, setImagePreview] = useState(defaultPlaceholder);
    const [imageData, setImageData] = useState(null);
    const [categoryId, setCategoryId] = useState('');

    // --- ESTADOS ESPECÍFICOS (Dependen del Rubro) ---

    // Restaurante / Cocina
    const [productType, setProductType] = useState('sellable'); // 'sellable' o 'ingredient'
    const [recipe, setRecipe] = useState([]);
    const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
    // NUEVO: Estación de impresión (Cocina/Barra)
    const [printStation, setPrintStation] = useState('kitchen');
    const [prepTime, setPrepTime] = useState('');
    const [modifiers, setModifiers] = useState([]);

    // Abarrotes / Granel / Ferretería
    const [saleType, setSaleType] = useState('unit');
    const [wholesaleTiers, setWholesaleTiers] = useState([]);
    const [isWholesaleModalOpen, setIsWholesaleModalOpen] = useState(false);
    // NUEVO: Puntos de reorden (Stock Mínimo/Máximo)
    const [minStock, setMinStock] = useState('');
    const [maxStock, setMaxStock] = useState('');
    const [cost, setCost] = useState('');
    const [price, setPrice] = useState('');
    const [supplier, setSupplier] = useState('');

    // Farmacia
    const [sustancia, setSustancia] = useState('');
    const [laboratorio, setLaboratorio] = useState('');
    // NUEVO: Control de antibióticos y presentación
    const [requiresPrescription, setRequiresPrescription] = useState(false);
    const [presentation, setPresentation] = useState('');

    //Fruteria/verduleria
    const [shelfLife, setShelfLife] = useState('');
    const [unit, setUnit] = useState('kg');

    // --- ESTADOS DE UI ---
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [internalEditingProduct, setInternalEditingProduct] = useState(null);
    const [showSpecificData, setShowSpecificData] = useState(false);


    // 2. EFECTO DE EDICIÓN: Carga datos en todos los estados
    useEffect(() => {
        setInternalEditingProduct(productToEdit);
        if (productToEdit) {
            // Datos Comunes
            setName(productToEdit.name);
            setBarcode(productToEdit.barcode || '');
            setDescription(productToEdit.description || '');
            setImagePreview(productToEdit.image || defaultPlaceholder);
            setImageData(productToEdit.image || null);
            setCategoryId(productToEdit.categoryId || '');

            // Datos Específicos - Restaurante
            setProductType(productToEdit.productType || 'sellable');
            setRecipe(productToEdit.recipe || []);
            setPrintStation(productToEdit.printStation || 'kitchen');
            setPrepTime(productToEdit.prepTime || '');
            setModifiers(productToEdit.modifiers || []);

            // Datos Específicos - Abarrotes/Ferretería
            setSaleType(productToEdit.saleType || 'unit');
            setWholesaleTiers(productToEdit.wholesaleTiers || []);
            setMinStock(productToEdit.minStock || '');
            setMaxStock(productToEdit.maxStock || '');
            setCost(productToEdit.cost || '');
            setSupplier(productToEdit.supplier || '');

            // Datos Específicos - Farmacia
            setSustancia(productToEdit.sustancia || '');
            setLaboratorio(productToEdit.laboratorio || '');
            setRequiresPrescription(productToEdit.requiresPrescription || false);
            setPresentation(productToEdit.presentation || '');

            //Datos Especificos - Fruteria
            setShelfLife(productToEdit.shelfLife || '');
            setUnit(productToEdit.bulkData?.purchase?.unit || 'kg');

            // Mostrar sección extra si hay datos relevantes
            if (
                productToEdit.description ||
                productToEdit.categoryId ||
                productToEdit.image ||
                productToEdit.sustancia ||
                productToEdit.minStock
            ) {
                setShowSpecificData(true);
            } else {
                setShowSpecificData(false);
            }
        } else {
            resetForm();
        }
    }, [productToEdit]);

    const resetForm = () => {
        // Reset Común
        setName(''); setBarcode(''); setDescription('');
        setImagePreview(defaultPlaceholder); setImageData(null);
        setCategoryId('');

        // Reset Restaurante
        setProductType('sellable');
        setRecipe([]);
        setPrintStation('kitchen');
        setPrepTime('');
        setModifiers([]);

        // Reset Abarrotes
        setSaleType('unit');
        setWholesaleTiers([]);
        setMinStock(''); setMaxStock('');
        setCost('');
        setPrice('');
        setSupplier('');

        // Reset Farmacia
        setSustancia(''); setLaboratorio('');
        setRequiresPrescription(false); setPresentation('');

        // reset Fruteria
        setShelfLife('');
        setUnit('kg');

        // Reset UI
        setInternalEditingProduct(null);
        setShowSpecificData(false);
    };

    // --- HANDLERS (Imagen, Scanner, API) ---
    const handleImageChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedFile = await compressImage(file);
                setImagePreview(URL.createObjectURL(compressedFile));
                setImageData(compressedFile);
            } catch (error) {
                console.error("Error al comprimir imagen:", error);
                setImagePreview(defaultPlaceholder);
                setImageData(null);
            }
        }
    };

    const handleBarcodeLookup = async (codeToLookup) => {
        if (!codeToLookup) {
            showMessageModal('Por favor, ingresa un código de barras para buscar.');
            return;
        }
        setIsLookingUp(true);
        const apiResult = await lookupBarcodeInAPI(codeToLookup);
        setIsLookingUp(false);

        if (apiResult.success) {
            setName(apiResult.product.name || name);
            setDescription(prev => apiResult.product.brand ? `Marca: ${apiResult.product.brand}` : (prev || ''));
            if (apiResult.product.image) {
                setImagePreview(apiResult.product.image);
                setImageData(apiResult.product.image);
            }
            setShowSpecificData(true);
            showMessageModal('¡Producto encontrado en API!');
        } else {
            showMessageModal(`No se encontró información para el código ${codeToLookup}.`);
        }
    };

    const handleBarcodeScanned = (code) => {
        setBarcode(code);
        setIsScannerOpen(false);
        handleBarcodeLookup(code);
    };

    // 3. HANDLESUBMIT: Recolecta todo y guarda
    const handleSubmit = (e) => {
        e.preventDefault();

        let productData = {
            // Comunes
            name, barcode, description, categoryId,
            image: imageData,

            // Restaurante
            productType: features.hasRecipes ? productType : 'sellable',
            recipe: (features.hasRecipes && productType === 'sellable') ? recipe : [],
            printStation: features.hasRecipes ? printStation : null,
            prepTime: features.hasRecipes ? prepTime : null,
            modifiers: features.hasRecipes ? modifiers : [],

            // Abarrotes / Ferretería
            saleType: features.hasBulk ? saleType : 'unit',
            wholesaleTiers: features.hasWholesale ? wholesaleTiers : [],
            minStock: features.hasMinMax ? parseFloat(minStock) : null,
            maxStock: features.hasMinMax ? parseFloat(maxStock) : null,
            price: parseFloat(price) || 0,
            cost: parseFloat(cost) || 0,
            supplier: features.hasSuppliers ? supplier : null,

            // Farmacia
            sustancia: features.hasLabFields ? sustancia : null,
            laboratorio: features.hasLabFields ? laboratorio : null,
            requiresPrescription: features.hasLabFields ? requiresPrescription : false,
            presentation: features.hasLabFields ? presentation : null,

            //Fruteria
            shelfLife: features.hasDailyPricing ? shelfLife : null,
            bulkData: (features.hasBulk) ? { purchase: { unit: unit } } : null,
            saleType: (features.hasBulk && unit !== 'pza') ? 'bulk' : 'unit,'
        };

        onSave(productData, internalEditingProduct);
        resetForm();
    };


    // 4. VISTA (JSX)
    return (
        <>
            <div className="product-form-container">
                <h3 className="subtitle" id="product-form-title">
                    {internalEditingProduct ? `Editar: ${internalEditingProduct.name}` : 'Añadir Nuevo Producto'}
                </h3>

                <form id="product-form" onSubmit={handleSubmit}>

                    {/* --- A. CAMPOS ESENCIALES --- */}
                    <div className="form-group">
                        <label className="form-label">Nombre del Producto *</label>
                        <input
                            className="form-input"
                            type="text"
                            required
                            placeholder="Ej: Pizza Hawaiana / Paracetamol"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Código de Barras</label>
                        <div className="input-with-button">
                            <input
                                className="form-input"
                                type="text"
                                placeholder="Escanea o ingresa"
                                value={barcode}
                                onChange={(e) => setBarcode(e.target.value)}
                            />
                            <button type="button" className="btn-scan-inline" onClick={() => setIsScannerOpen(true)}>📷</button>
                            <button type="button" className="btn-lookup" onClick={() => handleBarcodeLookup(barcode)} disabled={isLookingUp}>
                                {isLookingUp ? '...' : '🔍'}
                            </button>
                        </div>
                    </div>

                    {!features.hasMinMax && (
                        <div style={{ display: 'flex', gap: '15px' }}>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label className="form-label">Precio Venta *</label>
                                <input
                                    type="number" className="form-input"
                                    value={price} onChange={e => setPrice(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label className="form-label">Costo (Opcional)</label>
                                <input
                                    type="number" className="form-input"
                                    value={cost} onChange={e => setCost(e.target.value)}
                                />
                            </div>
                        </div>
                    )}

                    {/* --- B. BOTÓN GESTIÓN DE INVENTARIO (Si editamos) --- */}
                    {internalEditingProduct && (features.hasLots || features.hasVariants) && (
                        <div className="form-group">
                            <label className="form-label">Inventario, Costos y Precios</label>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => onManageBatches(internalEditingProduct.id)}
                            >
                                Gestionar {features.hasVariants ? 'Variantes (Tallas/Colores)' : 'Lotes (Stock/Costos)'}
                            </button>
                        </div>
                    )}

                    {/* --- C. FIELDSETS DINÁMICOS (Módulos) --- */}

                    {/* Módulo Restaurante */}
                    {features.hasRecipes && (
                        <RestauranteFields
                            productType={productType}
                            setProductType={setProductType}
                            onManageRecipe={() => setIsRecipeModalOpen(true)}
                            printStation={printStation}
                            setPrintStation={setPrintStation}
                            prepTime={prepTime}
                            setPrepTime={setPrepTime}
                            modifiers={modifiers}
                            setModifiers={setModifiers}
                        />
                    )}

                    {features.hasDailyPricing ? (
                        /* SI ES FRUTERÍA (usamos daily_pricing como indicador) */
                        <FruteriaFields
                            saleType={saleType} setSaleType={setSaleType}
                            price={price} setPrice={setPrice}
                            cost={cost} setCost={setCost}
                            shelfLife={shelfLife} setShelfLife={setShelfLife}
                            unit={unit} setUnit={setUnit}
                        />
                    ) : (features.hasBulk || features.hasMinMax) && (
                        <AbarrotesFields
                            saleType={saleType}
                            setSaleType={setSaleType}
                            onManageWholesale={() => setIsWholesaleModalOpen(true)}
                            minStock={minStock}
                            setMinStock={setMinStock}
                            maxStock={maxStock}
                            setMaxStock={setMaxStock}
                            features={features}
                            supplier={supplier}
                            setSupplier={setSupplier}
                            cost={cost}
                            setCost={setCost}
                            price={price}
                            setPrice={setPrice}
                        />
                    )}

                    {/* --- D. SECCIÓN DESPLEGABLE (Datos Extra) --- */}
                    <button
                        type="button"
                        className="btn-toggle-specific"
                        onClick={() => setShowSpecificData(!showSpecificData)}
                    >
                        {showSpecificData ? 'Ocultar datos adicionales' : 'Agregar datos adicionales (opcional)'}
                        {showSpecificData ? ' 🔼' : ' 🔽'}
                    </button>

                    {showSpecificData && (
                        <div className="specific-data-container">

                            {/* Módulo Farmacia (Dentro del desplegable) */}
                            {features.hasLabFields && (
                                <FarmaciaFields
                                    sustancia={sustancia}
                                    setSustancia={setSustancia}
                                    laboratorio={laboratorio}
                                    setLaboratorio={setLaboratorio}
                                    requiresPrescription={requiresPrescription}
                                    setRequiresPrescription={setRequiresPrescription}
                                    presentation={presentation}
                                    setPresentation={setPresentation}
                                />
                            )}

                            {/* Funciones Bloqueadas (Upsell) */}
                            {features.isVariantsLocked && (
                                <div className="form-group-locked">
                                    <label className="form-label">🔒 Variantes (Plan PRO)</label>
                                    <button type="button" className="btn-upgrade" onClick={() => navigate('/configuracion')}>Mejorar Plan</button>
                                </div>
                            )}

                            {/* Campos Comunes Adicionales */}
                            <div className="form-group">
                                <label className="form-label">Descripción</label>
                                <textarea className="form-textarea" rows="2" value={description} onChange={(e) => setDescription(e.target.value)}></textarea>
                            </div>

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
                                <label className="form-label">Imagen</label>
                                <div className="image-upload-container">
                                    <img className="image-preview" src={imagePreview} alt="Preview" />
                                    <input className="file-input" type="file" accept="image/*" onChange={handleImageChange} />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- E. BOTONES DE ACCIÓN --- */}
                    <button type="submit" className="btn btn-save">Guardar Producto</button>
                    <button type="button" className="btn btn-cancel" onClick={onCancel}>Cancelar</button>
                </form>
            </div>

            {/* --- MODALES AUXILIARES --- */}
            <ScannerModal
                show={isScannerOpen}
                onClose={() => setIsScannerOpen(false)}
                onScanSuccess={handleBarcodeScanned}
            />

            {/* Modal de Recetas (Restaurante) */}
            <RecipeBuilderModal
                show={isRecipeModalOpen}
                onClose={() => setIsRecipeModalOpen(false)}
                existingRecipe={recipe}
                onSave={(newRecipe) => setRecipe(newRecipe)}
                productName={name}
            />

            {/* Modal de Mayoreo (Abarrotes) */}
            <WholesaleManagerModal
                show={isWholesaleModalOpen}
                onClose={() => setIsWholesaleModalOpen(false)}
                tiers={wholesaleTiers}
                onSave={setWholesaleTiers}
                basePrice={internalEditingProduct ? internalEditingProduct.price : 0}
            />
        </>
    );
}