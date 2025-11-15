// src/components/products/ProductForm.jsx
import React, { useState, useEffect, useMemo } from 'react';
// ¡MODIFICADO! Importamos la nueva función y el modal de mensajes
import { compressImage, lookupBarcodeInAPI } from '../../services/utils'; 
import { showMessageModal } from '../../services/utils'; // ¡NUEVO!
import CostCalculatorModal from './CostCalculatorModal';
import ScannerModal from '../common/ScannerModal';
import './ProductForm.css'

const defaultPlaceholder = 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir';

export default function ProductForm({ onSave, onCancel, productToEdit, categories, onOpenCategoryManager }) {

    // 1. ESTADO DEL FORMULARIO
    const [name, setName] = useState('');
    const [barcode, setBarcode] = useState('');
    const [description, setDescription] = useState('');
    const [imagePreview, setImagePreview] = useState(defaultPlaceholder);
    const [imageData, setImageData] = useState(null); 
    const [categoryId, setCategoryId] = useState('');
    const [expiryDate, setExpiryDate] = useState('');
    const [showCostCalculator, setShowCostCalculator] = useState(false);
    
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isLookingUp, setIsLookingUp] = useState(false); // ¡NUEVO! Estado de carga

    // ... (estados de saleType, cost, price, stock, bulk, etc. sin cambios) ...
    const [saleType, setSaleType] = useState('unit');
    const [cost, setCost] = useState('');
    const [price, setPrice] = useState('');
    const [stock, setStock] = useState('0');
    const [bulkQty, setBulkQty] = useState('');
    const [bulkUnit, setBulkUnit] = useState('kg');
    const [bulkCost, setBulkCost] = useState('');
    const [bulkSalePrice, setBulkSalePrice] = useState('');


    // 2. EFECTO PARA RELLENAR EL FORMULARIO (EDICIÓN)
    // ... (useEffect de productToEdit no cambia) ...
    useEffect(() => {
        if (productToEdit) {
            // ... (lógica de rellenar formulario) ...
            setName(productToEdit.name);
            setBarcode(productToEdit.barcode || '');
            setDescription(productToEdit.description || '');
            setImagePreview(productToEdit.image || defaultPlaceholder);
            setImageData(productToEdit.image || null);
            setCategoryId(productToEdit.categoryId || '');
            setExpiryDate(productToEdit.expiryDate || '');
            setSaleType(productToEdit.saleType || 'unit');

            if (productToEdit.saleType === 'bulk' && productToEdit.bulkData) {
                setBulkQty(productToEdit.bulkData.purchase.quantity);
                setBulkUnit(productToEdit.bulkData.purchase.unit);
                setBulkCost(productToEdit.bulkData.purchase.cost);
                setBulkSalePrice(productToEdit.price); 
            } else {
                setCost(productToEdit.cost || '');
                setPrice(productToEdit.price || '');
                setStock(productToEdit.stock || '0');
            }
        } else {
            resetForm();
        }
    }, [productToEdit]);
    
    // ... (resetForm, handleImageChange, márgenes de ganancia no cambian) ...
    const resetForm = () => {
        setName(''); setBarcode(''); setDescription('');
        setImagePreview(defaultPlaceholder); setImageData(null);
        setCategoryId(''); setExpiryDate(''); setSaleType('unit');
        setCost(''); setPrice(''); setStock('0');
        setBulkQty(''); setBulkUnit('kg'); setBulkCost(''); setBulkSalePrice('');
    };
    
    const handleImageChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressed = await compressImage(file); 
                setImagePreview(compressed);
                setImageData(compressed);
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
        const p = parseFloat(bulkSalePrice);
        if (bulkCostPerUnit > 0 && p > bulkCostPerUnit) {
            const margin = ((p - bulkCostPerUnit) / p) * 100;
            return `Margen de ganancia: ${margin.toFixed(1)}%`;
        }
        return '';
    }, [bulkCostPerUnit, bulkSalePrice]);


    // --- ¡NUEVAS FUNCIONES DE BÚSQUEDA! ---

    /**
     * ¡NUEVO! Llama a la API y actualiza el estado del formulario
     */
    const handleBarcodeLookup = async (codeToLookup) => {
        if (!codeToLookup) {
            showMessageModal('Por favor, ingresa un código de barras para buscar.');
            return;
        }

        setIsLookingUp(true);
        const result = await lookupBarcodeInAPI(codeToLookup);
        setIsLookingUp(false);

        if (result.success) {
            // ¡Éxito! Rellenamos los campos
            // (Mantenemos el valor existente si la API no devuelve nada para ese campo)
            setName(result.product.name || name);
            setDescription(prevDesc => 
                result.product.brand ? `Marca: ${result.product.brand}` : (prevDesc || '')
            );
            
            if (result.product.image) {
                setImagePreview(result.product.image);
                setImageData(result.product.image); // Guardamos la URL de la imagen
            }
            
            showMessageModal('¡Producto encontrado! Revisa y completa la información.');
        } else {
            // Fracaso
            showMessageModal(`No se encontró información para el código ${codeToLookup}.`);
        }
    };

    /**
     * ¡MODIFICADO! Ahora llama a la búsqueda automáticamente.
     */
    const handleBarcodeScanned = (code) => {
        setBarcode(code); // Actualiza el estado del formulario
        setIsScannerOpen(false); // Cierra el modal
        handleBarcodeLookup(code); // ¡NUEVO! Llama a la búsqueda
    };
    
    const handleAssignCost = (totalCost) => {
        setCost(totalCost.toFixed(2));
    };
    
    // ... (handleSubmit no cambia) ...
    const handleSubmit = (e) => {
        e.preventDefault();
        // ... (lógica de productData no cambia) ...
         let productData = {};
        if (saleType === 'unit') {
            const nStock = parseInt(stock, 10);
            productData = {
                name, barcode, description, categoryId, expiryDate,
                image: imageData,
                saleType: 'unit',
                price: parseFloat(price),
                cost: parseFloat(cost),
                stock: isNaN(nStock) ? 0 : nStock,
                trackStock: nStock > 0,
                bulkData: null,
            };
        } else { // 'bulk'
            const nBulkQty = parseFloat(bulkQty);
            productData = {
                name, barcode, description, categoryId, expiryDate,
                image: imageData,
                saleType: 'bulk',
                price: parseFloat(bulkSalePrice), 
                cost: bulkCostPerUnit,
                stock: isNaN(nBulkQty) ? 0 : nBulkQty,
                trackStock: nBulkQty > 0,
                bulkData: {
                    purchase: { quantity: nBulkQty, unit: bulkUnit, cost: parseFloat(bulkCost) },
                    sale: { unit: bulkUnit } 
                }
            };
        }

        onSave(productData);
        resetForm();
    };


    // 4. VISTA (JSX)
    return (
        <>
            <div className="product-form-container">
                {/* ... (título y form tag) ... */}
                <h3 className="subtitle" id="product-form-title">
                    {productToEdit ? `Editar: ${productToEdit.name}` : 'Añadir Nuevo Producto'}
                </h3>
                <form id="product-form" onSubmit={handleSubmit}>

                    {/* ... (Campo 'Nombre del Producto' sin cambios) ... */}
                    <div className="form-group">
                        <label className="form-label" htmlFor="product-name">Nombre del Producto</label>
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

                    {/* --- ¡CAMPO DE CÓDIGO DE BARRAS MODIFICADO! --- */}
                    <div className="form-group">
                        <label className="form-label" htmlFor="product-barcode">Código de Barras (Opcional)</label>
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
                            {/* --- ¡NUEVO BOTÓN DE BÚSQUEDA! --- */}
                            <button
                                type="button"
                                className="btn-lookup" // Añadiremos un estilo para esto
                                onClick={() => handleBarcodeLookup(barcode)}
                                title="Buscar información del producto"
                                disabled={isLookingUp} // ¡NUEVO!
                            >
                                {isLookingUp ? '...' : '🔍'}
                            </button>
                        </div>
                    </div>
                    
                    {/* ... (El resto del formulario: descripción, tipo de venta, etc. no cambia) ... */}
                    <div className="form-group">
                        <label className="form-label" htmlFor="product-description">Descripción (Opcional)</label>
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
                        <label className="form-label" htmlFor="sale-type">Tipo de Venta</label>
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

                    {saleType === 'unit' ? (
                        <div id="unit-options">
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
                                <label className="form-label" htmlFor="product-price">Precio de Venta ($)</label>
                                <input className="form-input" id="product-price" type="number" step="0.01" min="0"
                                    value={price} onChange={(e) => setPrice(e.target.value)} />
                                <small className="form-help-text" style={{ display: 'block' }}>
                                    {unitProfitMargin}
                                </small>
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="product-stock">Stock (Unidades)</label>
                                <input className="form-input" id="product-stock" type="number" step="1" min="0"
                                    value={stock} onChange={(e) => setStock(e.target.value)} />
                            </div>
                        </div>
                    ) : (
                         <div id="bulk-options">
                            <div className="form-group bulk-purchase-group">
                                <label className="form-label">Info de Compra</label>
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

                            <div className="form-group">
                                <label className="form-label" htmlFor="bulk-sale-price">
                                    Precio de Venta (por {bulkUnit})
                                </label>
                                <input
                                    className="form-input"
                                    id="bulk-sale-price"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={bulkSalePrice}
                                    onChange={(e) => setBulkSalePrice(e.target.value)}
                                />
                                <small className="form-help-text" style={{ display: 'block' }}>
                                    {bulkProfitMargin}
                                </small>
                            </div>
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label" htmlFor="product-category">Categoría</label>
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
                        <label className="form-label" htmlFor="product-expiry">Fecha de Caducidad (Opcional)</label>
                        <input
                            className="form-input"
                            id="product-expiry"
                            type="date"
                            value={expiryDate}
                            onChange={(e) => setExpiryDate(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label" htmlFor="product-image-file">Imagen</label>
                        <div className="image-upload-container">
                            <img id="image-preview" className="image-preview" src={imagePreview} alt="Preview" />
                            <input className="file-input" id="product-image-file" type="file" accept="image/*"
                                onChange={handleImageChange} />
                        </div>
                    </div>

                    <button type="submit" className="btn btn-save">Guardar Producto</button>
                    <button type="button" className="btn btn-cancel" onClick={onCancel}>
                        Cancelar
                    </button>
                </form>
            </div>
            
            {/* ... (Modales de CostCalculator y Scanner sin cambios) ... */}
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