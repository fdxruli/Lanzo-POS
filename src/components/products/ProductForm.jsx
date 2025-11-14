import React, { useState, useEffect, useMemo } from 'react';
import { compressImage } from '../../services/utils'; //
import CostCalculatorModal from './CostCalculatorModal';
import './ProductForm.css'

const defaultPlaceholder = 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir';

export default function ProductForm({ onSave, onCancel, productToEdit, categories, onOpenCategoryManager }) {

    // 1. ESTADO DEL FORMULARIO
    const [name, setName] = useState('');
    const [barcode, setBarcode] = useState('');
    const [description, setDescription] = useState('');
    const [imagePreview, setImagePreview] = useState(defaultPlaceholder);
    const [imageData, setImageData] = useState(null); // Guardamos la data comprimida
    const [categoryId, setCategoryId] = useState('');
    const [expiryDate, setExpiryDate] = useState('');
    const [showCostCalculator, setShowCostCalculator] = useState(false);
    const handleAssignCost = (totalCost) => {
        setCost(totalCost.toFixed(2));
    };

    // Lógica de "Tipo de Venta"
    const [saleType, setSaleType] = useState('unit'); // 'unit' o 'bulk'

    // - Campos de "Unidad"
    const [cost, setCost] = useState('');
    const [price, setPrice] = useState('');
    const [stock, setStock] = useState('0');

    // - Campos de "A Granel"
    const [bulkQty, setBulkQty] = useState('');
    const [bulkUnit, setBulkUnit] = useState('kg');
    const [bulkCost, setBulkCost] = useState('');
    const [bulkSalePrice, setBulkSalePrice] = useState('');

    // 2. EFECTO PARA RELLENAR EL FORMULARIO (EDICIÓN)
    useEffect(() => {
        if (productToEdit) {
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
                setBulkSalePrice(productToEdit.price); // El precio de venta se guarda en 'price'
            } else {
                setCost(productToEdit.cost || '');
                setPrice(productToEdit.price || '');
                setStock(productToEdit.stock || '0');
            }
        } else {
            // Limpiar formulario si 'productToEdit' es null (ej. al cancelar)
            resetForm();
        }
    }, [productToEdit]);

    // 3. LÓGICA INTERNA Y HANDLERS

    const resetForm = () => {
        setName(''); setBarcode(''); setDescription('');
        setImagePreview(defaultPlaceholder); setImageData(null);
        setCategoryId(''); setExpiryDate(''); setSaleType('unit');
        setCost(''); setPrice(''); setStock('0');
        setBulkQty(''); setBulkUnit('kg'); setBulkCost(''); setBulkSalePrice('');
    };

    /**
     * Lógica de compresión de imagen
     * de 'productImageFileInput' en app.js
     */
    const handleImageChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressed = await compressImage(file); //
                setImagePreview(compressed);
                setImageData(compressed);
            } catch (error) {
                console.error("Error al comprimir imagen:", error);
                setImagePreview(defaultPlaceholder);
                setImageData(null);
            }
        }
    };

    /**
     * Lógica de márgenes de ganancia
     * de 'updateUnitMessages' y 'profit-margin.js'
     */
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


    /**
     * Prepara los datos y llama al padre (onSave)
     */
    const handleSubmit = (e) => {
        e.preventDefault();

        let productData = {};

        // Lógica de 'saveProduct' en app.js
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
                price: parseFloat(bulkSalePrice), // El precio de venta es por unidad de venta
                cost: bulkCostPerUnit, // Costo calculado por unidad
                stock: isNaN(nBulkQty) ? 0 : nBulkQty, // Stock es la cantidad total comprada
                trackStock: nBulkQty > 0,
                bulkData: {
                    purchase: { quantity: nBulkQty, unit: bulkUnit, cost: parseFloat(bulkCost) },
                    sale: { unit: bulkUnit } // Asumimos que se vende en la misma unidad
                }
            };
        }

        onSave(productData);
        resetForm();
    };

    // 4. VISTA (JSX)
    // HTML de 'add-product-content'
    return (
        <>
            <div className="product-form-container">
                <h3 className="subtitle" id="product-form-title">
                    {productToEdit ? `Editar: ${productToEdit.name}` : 'Añadir Nuevo Producto'}
                </h3>
                <form id="product-form" onSubmit={handleSubmit}>

                    {/* --- CAMPOS BÁSICOS --- */}
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

                    <div className="form-group">
                        <label className="form-label" htmlFor="product-barcode">Código de Barras (Opcional)</label>
                        <input
                            className="form-input"
                            id="product-barcode"
                            type="text"
                            placeholder="Escanea o ingresa el código"
                            value={barcode}
                            onChange={(e) => setBarcode(e.target.value)}
                        />
                    </div>

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

                    {/* --- RENDERIZADO CONDICIONAL --- */}
                    {/* Reemplaza la lógica de mostrar/ocultar de updateProductForm */}

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
                                    onClick={() => setShowCostCalculator(true)} // <-- CORREGIDO
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
                                <label className="form-label">Info de Compra (Ej: 1 Saco)</label>
                                {/* ... (Inputs de bulkQty, bulkUnit, bulkCost) ... */}
                                <small className="form-help-text" style={{ display: 'block' }}>
                                    {bulkCostPerUnit > 0 && `Costo por ${bulkUnit}: $${bulkCostPerUnit.toFixed(2)}`}
                                </small>
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="bulk-sale-price">Precio de Venta (por {bulkUnit})</label>
                                <input className="form-input" id="bulk-sale-price" type="number" step="0.01" min="0"
                                    value={bulkSalePrice} onChange={(e) => setBulkSalePrice(e.target.value)} />
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
            <CostCalculatorModal
                show={showCostCalculator}
                onClose={() => setShowCostCalculator(false)}
                onAssignCost={handleAssignCost}
            />
        </>
    );
}