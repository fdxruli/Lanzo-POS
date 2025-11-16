// src/components/products/ProductForm.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { compressImage, lookupBarcodeInAPI } from '../../services/utils';
import { showMessageModal } from '../../services/utils';
import CostCalculatorModal from './CostCalculatorModal';
import ScannerModal from '../common/ScannerModal';
import './ProductForm.css'

const defaultPlaceholder = 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir';

export default function ProductForm({
    onSave, onCancel, productToEdit, categories, onOpenCategoryManager,
    products, onEdit
}) {

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
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [saleType, setSaleType] = useState('unit');
    const [cost, setCost] = useState('');
    const [price, setPrice] = useState('');
    const [stock, setStock] = useState('0'); // Se mantiene '0' como default
    const [bulkQty, setBulkQty] = useState('');
    const [bulkUnit, setBulkUnit] = useState('kg');
    const [bulkCost, setBulkCost] = useState('');
    const [bulkSalePrice, setBulkSalePrice] = useState('');
    const [internalEditingProduct, setInternalEditingProduct] = useState(null);
    const [showSpecificData, setShowSpecificData] = useState(false);

    // 2. EFECTO PARA RELLENAR EL FORMULARIO (EDICIÓN)
    useEffect(() => {
        setInternalEditingProduct(productToEdit);
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
                setBulkQty(productToEdit.bulkData.purchase.quantity || ''); // Usar '' si es null
                setBulkUnit(productToEdit.bulkData.purchase.unit || 'kg');
                setBulkCost(productToEdit.bulkData.purchase.cost || '');
                setBulkSalePrice(productToEdit.price || '');
            } else {
                setCost(productToEdit.cost || '');
                setPrice(productToEdit.price || '');
                setStock(productToEdit.stock || '0');
            }

            // Si el producto que se edita tiene datos específicos, muestra la sección
            if (productToEdit.description || productToEdit.categoryId || productToEdit.expiryDate || productToEdit.image || productToEdit.cost > 0 || productToEdit.stock > 0) {
                setShowSpecificData(true);
            } else {
                setShowSpecificData(false);
            }

        } else {
            resetForm();
        }
    }, [productToEdit]);

    // 3. RESET FORM
    const resetForm = () => {
        setName(''); setBarcode(''); setDescription('');
        setImagePreview(defaultPlaceholder); setImageData(null);
        setCategoryId(''); setExpiryDate(''); setSaleType('unit');
        setCost(''); setPrice(''); setStock('0');
        setBulkQty(''); setBulkUnit('kg'); setBulkCost(''); setBulkSalePrice('');
        setInternalEditingProduct(null);
        setShowSpecificData(false);
    };

    // ... (handleImageChange, unitProfitMargin, bulkCostPerUnit, bulkProfitMargin NO CAMBIAN) ...
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
        const p = parseFloat(bulkSalePrice);
        if (bulkCostPerUnit > 0 && p > bulkCostPerUnit) {
            const margin = ((p - bulkCostPerUnit) / p) * 100;
            return `Margen de ganancia: ${margin.toFixed(1)}%`;
        }
        return '';
    }, [bulkCostPerUnit, bulkSalePrice]);


    const handleBarcodeLookup = async (codeToLookup) => {
        if (!codeToLookup) {
            showMessageModal('Por favor, ingresa un código de barras para buscar.');
            return;
        }

        // --- ¡CORRECCIÓN! PASO 1: Revisar la DB Local PRIMERO ---
        const localProduct = products.find(p => p.barcode === codeToLookup);

        if (localProduct) {
            // ¡ENCONTRADO LOCALMENTE! Este es el escenario de "nuevo lote".
            showMessageModal(
                `El código "${codeToLookup}" ya está en uso por "${localProduct.name}". ¿Qué deseas hacer?`,
                () => { // onConfirm -> "Copiar para nuevo lote"
                    // Pre-rellenamos el formulario
                    setName(localProduct.name);
                    setBarcode(localProduct.barcode);
                    setDescription(localProduct.description || '');
                    setImagePreview(localProduct.image || defaultPlaceholder);
                    setImageData(localProduct.image || null);
                    setCategoryId(localProduct.categoryId || '');
                    setSaleType(localProduct.saleType || 'unit');

                    if (localProduct.saleType === 'bulk' && localProduct.bulkData) {
                        setBulkQty(localProduct.bulkData.purchase.quantity || '');
                        setBulkUnit(localProduct.bulkData.purchase.unit || 'kg');
                        setBulkCost(localProduct.bulkData.purchase.cost || '');
                        setBulkSalePrice(localProduct.price || '');
                    } else {
                        setCost(localProduct.cost || '');
                        setPrice(localProduct.price || '');
                    }

                    // ¡Campos clave se limpian!
                    setStock(''); // Limpiar stock
                    setExpiryDate(''); // Limpiar fecha
                    setInternalEditingProduct(null); // Asegura que guardemos como NUEVO

                    // Mostramos los datos específicos al copiar
                    setShowSpecificData(true);

                    showMessageModal('Datos copiados. Ingresa el nuevo Stock y Caducidad. Te recomendamos añadir "(Lote 2)" al nombre.');
                    // Damos focus al campo de stock (si es 'unit')
                    setTimeout(() => {
                        const stockInput = document.getElementById('product-stock');
                        if (stockInput) stockInput.focus();
                    }, 100);
                },
                {
                    confirmButtonText: 'Registrar Nuevo Lote',
                    extraButton: {
                        text: 'Editar Original',
                        action: () => onEdit(localProduct)
                    }
                }
            );
            return; // ¡Importante! Detener la ejecución aquí.
        }

        // --- PASO 2: Si no se encontró localmente, buscar en la API ---
        setIsLookingUp(true);
        const apiResult = await lookupBarcodeInAPI(codeToLookup);
        setIsLookingUp(false);

        if (apiResult.success) {
            // API SÍ lo encontró (y local no)
            setName(apiResult.product.name || name);
            setDescription(prevDesc =>
                apiResult.product.brand ? `Marca: ${apiResult.product.brand}` : (prevDesc || '')
            );
            if (apiResult.product.image) {
                setImagePreview(apiResult.product.image);
                setImageData(apiResult.product.image); // Guardamos la URL
            }
            setShowSpecificData(true); // Mostrar campos al encontrar en API
            showMessageModal('¡Producto encontrado en API! Revisa y completa la información.');
        } else {
            // API falló Y local falló
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

    // ... (handleSubmit NO CAMBIA, la lógica de parseo ya maneja NaN/strings vacíos) ...
    const handleSubmit = (e) => {
        e.preventDefault();

        let productData = {};

        if (saleType === 'unit') {
            const nStock = parseInt(stock, 10);
            productData = {
                name, barcode, description, categoryId, expiryDate,
                image: imageData,
                saleType: 'unit',
                price: parseFloat(price),
                cost: parseFloat(cost), // Esto será NaN si está vacío, y se guardará como null
                stock: isNaN(nStock) ? 0 : nStock,
                trackStock: nStock > 0,
                bulkData: null,
            };
        } else {
            const nBulkQty = parseFloat(bulkQty);
            productData = {
                name, barcode, description, categoryId, expiryDate,
                image: imageData,
                saleType: 'bulk',
                price: parseFloat(bulkSalePrice),
                cost: bulkCostPerUnit, // Se calcula (será 0 si está vacío)
                stock: isNaN(nBulkQty) ? 0 : nBulkQty,
                trackStock: nBulkQty > 0,
                bulkData: {
                    purchase: { quantity: nBulkQty, unit: bulkUnit, cost: parseFloat(bulkCost) },
                    sale: { unit: bulkUnit }
                }
            };
        }

        onSave(productData, internalEditingProduct);
        resetForm();
    };


    // 4. VISTA (JSX) - ¡MODIFICADO!
    return (
        <>
            <div className="product-form-container">
                <h3 className="subtitle" id="product-form-title">
                    {internalEditingProduct ? `Editar: ${internalEditingProduct.name}` : 'Añadir Nuevo Producto'}
                </h3>
                <form id="product-form" onSubmit={handleSubmit}>

                    {/* --- CAMPOS ESENCIALES (Siempre visibles) --- */}
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

                    {/* --- CAMPOS DE PRECIO (Siempre visibles) --- */}

                    {saleType === 'unit' ? (
                        <div id="unit-options">
                            <div className="form-group">
                                <label className="form-label" htmlFor="product-price">Precio de Venta ($) *</label>
                                <input className="form-input" id="product-price" type="number" step="0.01" min="0"
                                    value={price} onChange={(e) => setPrice(e.target.value)} required />
                                {cost > 0 && ( // Solo muestra el margen si hay un costo
                                    <small className="form-help-text" style={{ display: 'block' }}>
                                        {unitProfitMargin}
                                    </small>
                                )}
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
                                    value={bulkSalePrice}
                                    onChange={(e) => setBulkSalePrice(e.target.value)}
                                    required
                                />
                                {bulkCost > 0 && ( // Solo muestra el margen si hay un costo
                                    <small className="form-help-text" style={{ display: 'block' }}>
                                        {bulkProfitMargin}
                                    </small>
                                )}
                            </div>
                        </div>
                    )}

                    {/* --- FIN DE CAMPOS ESENCIALES --- */}


                    {/* --- BOTÓN TOGGLE --- */}
                    <button
                        type="button"
                        className="btn-toggle-specific"
                        onClick={() => setShowSpecificData(!showSpecificData)}
                        aria-expanded={showSpecificData}
                    >
                        {showSpecificData ? 'Ocultar datos específicos' : 'Agregar datos específicos (opcional)'}
                        {showSpecificData ? ' 🔼' : ' 🔽'}
                    </button>


                    {/* --- CAMPOS ESPECÍFICOS (Ocultos por defecto) --- */}
                    {showSpecificData && (
                        <div className="specific-data-container">

                            {/* --- INICIO: CAMPOS MOVIDOS (Costo y Stock) --- */}
                            {saleType === 'unit' ? (
                                <div id="specific-unit-options">
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
                                <div id="specific-bulk-options">
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
                            {/* --- FIN: CAMPOS MOVIDOS --- */}


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
                        </div>
                    )}
                    {/* --- FIN DE CAMPOS ESPECÍFICOS --- */}


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
            <ScannerModal
                show={isScannerOpen}
                onClose={() => setIsScannerOpen(false)}
                onScanSuccess={handleBarcodeScanned}
            />
        </>
    );
}