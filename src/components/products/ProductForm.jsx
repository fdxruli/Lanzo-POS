// src/components/products/ProductForm.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { compressImage, lookupBarcodeInAPI } from '../../services/utils';
import { showMessageModal } from '../../services/utils';
import CostCalculatorModal from './CostCalculatorModal';
import ScannerModal from '../common/ScannerModal';
import './ProductForm.css'
// ¡Importante! Necesitamos 'saveData' aquí
import { saveData, STORES } from '../../services/database';

const defaultPlaceholder = 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir';

export default function ProductForm({
    onSave, onCancel, productToEdit, categories, onOpenCategoryManager,
    products, onEdit,
    onManageBatches // ¡ESTA ES LA NUEVA PROP PARA CONECTAR AL GESTOR!
}) {

    // 1. ESTADO DEL FORMULARIO
    const [name, setName] = useState('');
    const [barcode, setBarcode] = useState('');
    const [description, setDescription] = useState('');
    const [imagePreview, setImagePreview] = useState(defaultPlaceholder);
    const [imageData, setImageData] = useState(null);
    const [categoryId, setCategoryId] = useState('');
    const [saleType, setSaleType] = useState('unit');
    const [internalEditingProduct, setInternalEditingProduct] = useState(null);
    const [showSpecificData, setShowSpecificData] = useState(false);
    
    // --- NUEVO: Estado solo para el PRIMER LOTE ---
    const [cost, setCost] = useState('');
    const [price, setPrice] = useState('');
    const [stock, setStock] = useState('0');
    const [expiryDate, setExpiryDate] = useState('');
    const [bulkQty, setBulkQty] = useState('');
    const [bulkUnit, setBulkUnit] = useState('kg');
    const [bulkCost, setBulkCost] = useState('');
    
    // ... (otros estados: showCostCalculator, isScannerOpen, etc. no cambian) ...
    const [showCostCalculator, setShowCostCalculator] = useState(false);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isLookingUp, setIsLookingUp] = useState(false);


    // 2. EFECTO PARA RELLENAR EL FORMULARIO (EDICIÓN)
    useEffect(() => {
        setInternalEditingProduct(productToEdit);
        if (productToEdit) {
            // Rellenar datos del PRODUCTO
            setName(productToEdit.name);
            setBarcode(productToEdit.barcode || '');
            setDescription(productToEdit.description || '');
            setImagePreview(productToEdit.image || defaultPlaceholder);
            setImageData(productToEdit.image || null);
            setCategoryId(productToEdit.categoryId || '');
            setSaleType(productToEdit.saleType || 'unit');
            setShowSpecificData(true); // Mostrar siempre al editar

            // Al editar, deshabilitamos la creación del lote
            // (esto se hará en BatchManager)
            setCost('');
            setPrice('');
            setStock('0');
            setExpiryDate('');
            setBulkQty('');
            setBulkCost('');

        } else {
            resetForm();
        }
    }, [productToEdit]);

    // 3. RESET FORM
    const resetForm = () => {
        setName(''); setBarcode(''); setDescription('');
        setImagePreview(defaultPlaceholder); setImageData(null);
        setCategoryId(''); setSaleType('unit');
        setCost(''); setPrice(''); setStock('0'); setExpiryDate('');
        setBulkQty(''); setBulkUnit('kg'); setBulkCost('');
        setInternalEditingProduct(null);
        setShowSpecificData(false);
    };

    // ... (handleImageChange, márgenes de ganancia, etc. NO CAMBIAN) ...
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
    
    const unitProfitMargin = useMemo(() => {
        const c = parseFloat(cost);
        const p = parseFloat(price);
        if (c > 0 && p > c) {
            const margin = ((p - c) / p) * 100;
            return `Margen de ganancia: ${margin.toFixed(1)}%`;
        }
        return '';
    }, [cost, price]);

    const bulkCostPerUnit = useMemo(() => {
        const qty = parseFloat(bulkQty);
        const cost = parseFloat(bulkCost);
        if (qty > 0 && cost > 0) return cost / qty;
        return 0;
    }, [bulkQty, bulkCost]);
    
    const bulkProfitMargin = useMemo(() => {
        const p = parseFloat(price); // Usamos 'price' para el precio de venta por unidad
        if (bulkCostPerUnit > 0 && p > bulkCostPerUnit) {
            const margin = ((p - bulkCostPerUnit) / p) * 100;
            return `Margen de ganancia: ${margin.toFixed(1)}%`;
        }
        return '';
    }, [bulkCostPerUnit, price]);
    
    /**
     * ¡LÓGICA DE BÚSQUEDA DE CÓDIGO CORREGIDA!
     * Esta es la versión que te sugerí.
     */
    const handleBarcodeLookup = async (codeToLookup) => {
        if (!codeToLookup) {
            showMessageModal('Por favor, ingresa un código de barras para buscar.');
            return;
        }
        
        const localProduct = products.find(p => p.barcode === codeToLookup);

        if (localProduct) {
            // --- ¡AQUÍ ESTÁ LA CONEXIÓN! ---
            showMessageModal(
                `El código "${codeToLookup}" ya está en uso por "${localProduct.name}". ¿Qué deseas hacer?`,
                () => { // onConfirm -> "Registrar Nuevo Lote"
                    // ¡Llamamos a la nueva función de ProductsPage!
                    onManageBatches(localProduct.id);
                },
                {
                    confirmButtonText: 'Registrar Nuevo Lote',
                    extraButton: {
                        text: 'Editar Original',
                        action: () => onEdit(localProduct)
                    }
                }
            );
            return;
            // --- FIN DE LA CONEXIÓN ---
        }

        setIsLookingUp(true);
        const apiResult = await lookupBarcodeInAPI(codeToLookup);
        setIsLookingUp(false);

        if (apiResult.success) {
            setName(apiResult.product.name || name);
            if (apiResult.product.image) {
                setImagePreview(apiResult.product.image);
                setImageData(apiResult.product.image);
            }
            setShowSpecificData(true);
            showMessageModal('¡Producto encontrado en API! Revisa y completa la información.');
        } else {
            showMessageModal(`No se encontró información para el código ${codeToLookup}.`);
        }
    };

    const handleBarcodeScanned = (code) => {
        setBarcode(code);
        setIsScannerOpen(false);
        handleBarcodeLookup(code);
    };

    const handleAssignCost = (totalCost) => {
        setCost(totalCost.toFixed(2));
    };


    /**
     * ¡LÓGICA DE GUARDADO MODIFICADA!
     * Implementa tu "Escenario 1": Crea un Producto y un Lote.
     */
    const handleSubmit = async (e) => {
        e.preventDefault();

        // Si estamos editando, solo guardamos el producto base
        if (internalEditingProduct) {
            const productData = {
                ...internalEditingProduct,
                name, barcode, description, categoryId, saleType,
                image: imageData,
                updatedAt: new Date().toISOString(),
                batchManagement: internalEditingProduct.batchManagement || { enabled: false, selectionStrategy: 'fifo' }
            };
            // Llama al onSave original de ProductsPage.jsx
            onSave(productData, internalEditingProduct);
            resetForm();
            return;
        }

        // --- Lógica de CREACIÓN (Producto + Lote) ---
        const now = new Date().toISOString();
        const productId = `product-${Date.now()}`;
        
        // 1. Datos del PRODUCTO (info permanente)
        const productData = {
            id: productId,
            name, barcode, description, categoryId, saleType,
            image: imageData,
            isActive: true,
            createdAt: now,
            updatedAt: now,
            batchManagement: {
                enabled: false, // Por defecto, se activa si se añaden más lotes
                selectionStrategy: 'fifo'
            },
            // Estructura base para granel
            bulkData: saleType === 'bulk' ? { sale: { unit: bulkUnit } } : null
        };
        
        // 2. Datos del LOTE (info variable)
        const nStock = parseInt(stock, 10);
        const nCost = parseFloat(cost);
        const nPrice = parseFloat(price);
        const nBulkQty = parseFloat(bulkQty);
        
        let batchData = {
            id: `batch-${productId}-${now}`,
            productId: productId,
            createdAt: now,
            isActive: true,
            notes: "Lote inicial creado con el producto",
            expiryDate: expiryDate || null,
        };

        if (saleType === 'unit') {
            batchData = {
                ...batchData,
                cost: isNaN(nCost) ? 0 : nCost,
                price: isNaN(nPrice) ? 0 : nPrice,
                stock: isNaN(nStock) ? 0 : nStock,
                trackStock: nStock > 0,
            };
        } else { // 'bulk'
            batchData = {
                ...batchData,
                cost: bulkCostPerUnit, // Costo por unidad de venta (ej. por kg)
                price: isNaN(nPrice) ? 0 : nPrice, // Precio por unidad de venta (ej. por kg)
                stock: isNaN(nBulkQty) ? 0 : nBulkQty, // Stock total en (ej. kg)
                trackStock: nBulkQty > 0,
                bulkData: {
                    purchase: { 
                        quantity: nBulkQty, 
                        unit: bulkUnit, 
                        cost: parseFloat(bulkCost) || 0
                    }
                }
            };
        }

        try {
            // 3. Guardar ambos
            await saveData(STORES.MENU, productData);
            
            // Solo guardamos el lote si se ingresó stock
            if (batchData.stock > 0) {
                await saveData(STORES.PRODUCT_BATCHES, batchData);
            }
            
            // Llamamos al onSave "falso" de ProductsPage para que refresque
            onSave(productData, null); 
            resetForm();

        } catch (error) {
             console.error("Error al guardar producto y lote:", error);
             showMessageModal(`Error al guardar: ${error.message}`);
        }
    };


    // 4. VISTA (JSX) - Modificada para reflejar Lote Inicial
    const isEditing = !!internalEditingProduct;
    
    return (
        <>
            <div className="product-form-container">
                <h3 className="subtitle" id="product-form-title">
                    {isEditing ? `Editar: ${internalEditingProduct.name}` : 'Añadir Nuevo Producto'}
                </h3>
                <form id="product-form" onSubmit={handleSubmit}>

                    {/* --- CAMPOS DEL PRODUCTO --- */}
                    <div className="form-group">
                        <label className="form-label" htmlFor="product-name">Nombre del Producto *</label>
                        <input
                            className="form-input"
                            id="product-name"
                            type="text"
                            required
                            placeholder="Ej: Coca-Cola 600ml"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    
                    <div className="form-group">
                        <label className="form-label" htmlFor="product-barcode">Código de Barras</label>
                        <div className="input-with-button">
                            <input
                                className="form-input"
                                id="product-barcode"
                                type="text"
                                placeholder="Escanea o ingresa el código"
                                value={barcode}
                                onChange={(e) => setBarcode(e.target.value)}
                            />
                            <button
                                type="button"
                                className="btn-scan-inline"
                                onClick={() => setIsScannerOpen(true)}
                                title="Escanear código de barras"
                            >
                                📷
                            </button>
                            <button
                                type="button"
                                className="btn-lookup"
                                onClick={() => handleBarcodeLookup(barcode)}
                                title="Buscar información del producto"
                                disabled={isLookingUp}
                            >
                                {isLookingUp ? '...' : '🔍'}
                            </button>
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label" htmlFor="sale-type">Tipo de Venta *</label>
                        <select
                            className="form-input"
                            id="sale-type"
                            value={saleType}
                            onChange={(e) => setSaleType(e.target.value)}
                        >
                            <option value="unit">Por Unidad/Pieza</option>
                            <option value="bulk">A Granel (Peso/Volumen)</option>
                        </select>
                    </div>

                    {/* --- BOTÓN TOGGLE --- */}
                    <button
                        type="button"
                        className="btn-toggle-specific"
                        onClick={() => setShowSpecificData(!showSpecificData)}
                        aria-expanded={showSpecificData}
                    >
                        {showSpecificData ? 'Ocultar datos adicionales' : 'Agregar datos adicionales (opcional)'}
                        {showSpecificData ? ' 🔼' : ' 🔽'}
                    </button>

                    {showSpecificData && (
                        <div className="specific-data-container">
                            <div className="form-group">
                                <label className="form-label">Categoría</label>
                                <select
                                    className="form-input"
                                    id="product-category"
                                    value={categoryId}
                                    onChange={(e) => setCategoryId(e.target.value)}
                                >
                                    <option value="">Sin categoría</option>
                                    {categories.map(cat => (
                                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    id="category-modal-button"
                                    className="btn btn-help"
                                    onClick={onOpenCategoryManager}
                                >
                                    Administrar Categorías
                                </button>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Descripción</label>
                                <textarea
                                    className="form-textarea"
                                    id="product-description"
                                    rows="2"
                                    placeholder="Una breve descripción del producto"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                ></textarea>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Imagen</label>
                                <div className="image-upload-container">
                                    <img id="image-preview" className="image-preview" src={imagePreview} alt="Preview" />
                                    <input className="file-input" id="product-image-file" type="file" accept="image/*"
                                        onChange={handleImageChange} />
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {/* --- SECCIÓN DEL LOTE INICIAL (Solo al crear) --- */}
                    {!isEditing && (
                        <div className="specific-data-container" style={{borderTop: '2px dashed var(--primary-color)', marginTop: '1rem'}}>
                            <h4 className="subtitle" style={{color: 'var(--primary-color)'}}>
                                Lote Inicial (Opcional)
                            </h4>
                            <small className="form-help-text" style={{display: 'block', marginTop: '-1rem', marginBottom: '1rem'}}>
                                Ingresa el costo, precio y stock de tu primera compra.
                            </small>

                            {saleType === 'unit' ? (
                                <div id="unit-options">
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="product-price">Precio de Venta ($) *</label>
                                        <input className="form-input" id="product-price" type="number" step="0.01" min="0"
                                            value={price} onChange={(e) => setPrice(e.target.value)} required={!isEditing} />
                                        {cost > 0 && (
                                            <small className="form-help-text" style={{ display: 'block' }}>
                                                {unitProfitMargin}
                                            </small>
                                        )}
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="product-cost">Costo por Unidad ($)</label>
                                        <input className="form-input" id="product-cost" type="number" step="0.01" min="0"
                                            value={cost} onChange={(e) => setCost(e.target.value)} />
                                        <button
                                            type="button"
                                            id="cost-help-button"
                                            className="btn btn-help"
                                            onClick={() => setShowCostCalculator(true)}
                                        >
                                            Calcular Costo
                                        </button>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="product-stock">Stock (Unidades)</label>
                                        <input className="form-input" id="product-stock" type="number" step="1" min="0"
                                            value={stock} onChange={(e) => setStock(e.target.value)} />
                                    </div>
                                </div>
                            ) : (
                                <div id="bulk-options">
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="bulk-sale-price">
                                            Precio de Venta (por {bulkUnit}) *
                                        </label>
                                        <input
                                            className="form-input"
                                            id="bulk-sale-price"
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={price} // Usamos 'price' para el precio de venta por unidad
                                            onChange={(e) => setPrice(e.target.value)}
                                            required={!isEditing}
                                        />
                                        {bulkCost > 0 && (
                                            <small className="form-help-text" style={{ display: 'block' }}>
                                                {bulkProfitMargin}
                                            </small>
                                        )}
                                    </div>
                                    <div className="form-group bulk-purchase-group">
                                        <label className="form-label">Info de Compra (Stock)</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: 'var(--spacing-sm)' }}>
                                            <input
                                                className="form-input"
                                                type="number"
                                                placeholder="Cantidad"
                                                value={bulkQty}
                                                onChange={(e) => setBulkQty(e.target.value)}
                                                step="0.01"
                                                min="0"
                                            />
                                            <select
                                                className="form-input"
                                                value={bulkUnit}
                                                onChange={(e) => setBulkUnit(e.target.value)}
                                            >
                                                <option value="kg">kg</option>
                                                <option value="lt">lt</option>
                                                <option value="gr">gr</option>
                                                <option value="ml">ml</option>
                                            </select>
                                            <input
                                                className="form-input"
                                                type="number"
                                                placeholder="Costo Total ($)"
                                                value={bulkCost}
                                                onChange={(e) => setBulkCost(e.target.value)}
                                                step="0.01"
                                                min="0"
                                            />
                                        </div>
                                        <small className="form-help-text" style={{ display: 'block' }}>
                                            {bulkCostPerUnit > 0 && `Costo por ${bulkUnit}: $${bulkCostPerUnit.toFixed(2)}`}
                                        </small>
                                    </div>
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label" htmlFor="product-expiry">Fecha de Caducidad (Opcional)</label>
                                <input
                                    className="form-input"
                                    id="product-expiry"
                                    type="date"
                                    value={expiryDate}
                                    onChange={(e) => setExpiryDate(e.target.value)}
                                />
                            </div>
                        </div>
                    )}
                    
                    <button type="submit" className="btn btn-save">
                        {isEditing ? 'Actualizar Producto' : 'Guardar Producto'}
                    </button>
                    <button type="button" className="btn btn-cancel" onClick={onCancel}>
                        Cancelar
                    </button>
                </form>
            </div>

            <CostCalculatorModal
                show={showCostCalculator}
                onClose={() => setShowCostCalculator(false)}
                onAssignCost={handleAssignCost}
            />
            <ScannerModal
                show={isScannerOpen}
                onClose={() => setIsScannerOpen(false)}
                onScanSuccess={handleBarcodeScanned}
            />
        </>
    );
}