import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { compressImage, lookupBarcodeInAPI, showMessageModal } from '../../services/utils'; 
import ScannerModal from '../common/ScannerModal';
import './ProductForm.css';

// --- IMPORTACIÓN DE LOS MINI-FORMULARIOS (FIELDSETS) ---
import RestauranteFields from './fieldsets/RestauranteFields';
import AbarrotesFields from './fieldsets/AbarrotesFields';
import FarmaciaFields from './fieldsets/FarmaciaFIelds';

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

    // Abarrotes / Granel
    const [saleType, setSaleType] = useState('unit');
    const [wholesaleTiers, setWholesaleTiers] = useState([]);
    const [isWholesaleModalOpen, setIsWholesaleModalOpen] = useState(false);
    
    // Farmacia
    const [sustancia, setSustancia] = useState('');
    const [laboratorio, setLaboratorio] = useState('');
    
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
            
            // Datos Específicos
            setProductType(productToEdit.productType || 'sellable');
            setRecipe(productToEdit.recipe || []);
            setSaleType(productToEdit.saleType || 'unit');
            setWholesaleTiers(productToEdit.wholesaleTiers || []);
            setSustancia(productToEdit.sustancia || '');
            setLaboratorio(productToEdit.laboratorio || '');
            
            // Mostrar sección extra si hay datos relevantes
            if (productToEdit.description || productToEdit.categoryId || productToEdit.image || productToEdit.sustancia) {
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
        
        // Reset Específico
        setProductType('sellable');
        setRecipe([]);
        setSaleType('unit');
        setWholesaleTiers([]);
        setSustancia(''); setLaboratorio('');
        
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
        // (Lógica de búsqueda existente...)
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

            // Específicos (Solo guardamos si la feature está activa para ahorrar espacio)
            productType: features.hasRecipes ? productType : 'sellable',
            recipe: (features.hasRecipes && productType === 'sellable') ? recipe : [],
            
            saleType: features.hasBulk ? saleType : 'unit',
            wholesaleTiers: features.hasWholesale ? wholesaleTiers : [],
            
            sustancia: features.hasLabFields ? sustancia : null,
            laboratorio: features.hasLabFields ? laboratorio : null,
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
                        />
                    )}
                    
                    {/* Módulo Abarrotes */}
                    {features.hasBulk && (
                        <AbarrotesFields
                            saleType={saleType}
                            setSaleType={setSaleType}
                            onManageWholesale={() => setIsWholesaleModalOpen(true)}
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
                                <div style={{display: 'flex', gap: '10px'}}>
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