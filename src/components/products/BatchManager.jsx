// src/components/products/BatchManager.jsx
import React, { useState, useMemo, useEffect, useRef } from 'react';

// --- CAMBIO: Usamos los stores especializados ---
import { useProductStore } from '../../store/useProductStore';
import { useStatsStore } from '../../store/useStatsStore';

import { saveDataSafe, saveBatchAndSyncProductSafe, deleteDataSafe, saveData, STORES, deleteData, queryByIndex, saveBatchAndSyncProduct } from '../../services/database';
import { showMessageModal } from '../../services/utils';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useCaja } from '../../hooks/useCaja';
import { generateID } from '../../services/utils';
import './BatchManager.css';

/**
 * Formulario Optimizado (Compatible con Ropa, Farmacia y Restaurante)
 */
const BatchForm = ({ product, batchToEdit, onClose, onSave, features, menu }) => {
  // --- Estados Comunes ---
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [notes, setNotes] = useState('');

  // --- Estado para Lotes (Farmacia) ---
  const [expiryDate, setExpiryDate] = useState('');

  // --- Estados para Variantes (Ropa/Ferretería) ---
  const [sku, setSku] = useState('');
  const [attribute1, setAttribute1] = useState(''); // Talla
  const [attribute2, setAttribute2] = useState(''); // Color
  const [location, setLocation] = useState('');
  const [pagadoDeCaja, setPagadoDeCaja] = useState(false);

  // Referencia para enfocar el primer input al guardar y continuar
  const firstInputRef = useRef(null);

  const { registrarMovimiento, cajaActual } = useCaja();
  const isEditing = !!batchToEdit;

  useEffect(() => {
    if (isEditing) {
      // --- MODO EDICIÓN ---
      setCost(batchToEdit.cost);
      setPrice(batchToEdit.price);
      setStock(batchToEdit.stock);
      setNotes(batchToEdit.notes || '');
      setLocation(batchToEdit.location || '');
      if (features.hasLots) {
        setExpiryDate(batchToEdit.expiryDate ? batchToEdit.expiryDate.split('T')[0] : '');
      }
      if (features.hasVariants) {
        setSku(batchToEdit.sku || '');
        const attrs = batchToEdit.attributes || {};
        setAttribute1(attrs.talla || attrs.modelo || '');
        setAttribute2(attrs.color || attrs.marca || '');
      }
    } else {
      // --- MODO CREACIÓN (Lógica Inteligente Restaurada) ---

      // 1. Intentamos calcular costo desde receta (Para Restaurantes)
      let initialCost = product.cost || '';

      if (features.hasRecipes && product.recipe && product.recipe.length > 0) {
        const totalRecipeCost = product.recipe.reduce((sum, item) => {
          const ingredient = menu.find(p => p.id === item.ingredientId);
          const unitCost = ingredient?.cost || 0;
          return sum + (item.quantity * unitCost);
        }, 0);

        if (totalRecipeCost > 0) {
          initialCost = totalRecipeCost.toFixed(2);
        }
      }

      setCost(initialCost);
      setPrice(product.price || ''); // Hereda precio base (Optimización Ropa)
      setStock('');
      setNotes('');
      setPagadoDeCaja(false);
      setLocation('');

      if (features.hasLots) setExpiryDate('');

      if (features.hasVariants) {
        setSku('');
        setAttribute1('');
        // Nota: No borramos attribute2 (Color) para agilizar la carga de tallas del mismo color
        setAttribute2('');
      }
    }
  }, [batchToEdit, isEditing, features, product, menu]);

  // Generador de SKU Automático
  const generateAutoSku = () => {
    if (sku.trim()) return sku;

    const cleanName = product.name.replace(/\s+/g, '').toUpperCase().substring(0, 4);
    const attr1Code = attribute1.replace(/\s+/g, '').toUpperCase();
    const attr2Code = attribute2.replace(/\s+/g, '').toUpperCase().substring(0, 3);

    return `${cleanName}-${attr2Code}-${attr1Code}-${Date.now().toString().slice(-4)}`;
  };

  // --- CAMBIO: Usamos useStatsStore para ajustar inventario ---
  const adjustInventoryValue = useStatsStore(state => state.adjustInventoryValue);

  const handleProcessSave = async (shouldClose) => {
    const nStock = parseInt(stock, 10);
    const nCost = parseFloat(cost);
    const nPrice = parseFloat(price);

    const oldTotalValue = isEditing ? (batchToEdit.cost * batchToEdit.stock) : 0;
    const newTotalValue = nCost * nStock;
    const valueDifference = newTotalValue - oldTotalValue;

    if (isNaN(nStock) || isNaN(nCost) || isNaN(nPrice)) {
      showMessageModal("Por favor, ingresa valores numéricos válidos.");
      return false;
    }

    // Lógica de pago desde caja
    if (pagadoDeCaja && !isEditing) {
      if (!cajaActual || cajaActual.estado !== 'abierta') {
        showMessageModal("⚠️ La caja está cerrada. Abre la caja para registrar el pago.");
        return false;
      }
      const totalCosto = nCost * nStock;
      const exito = await registrarMovimiento('salida', totalCosto, `Compra Stock: ${product.name} (x${nStock})`);
      if (!exito) {
        showMessageModal("Error al registrar la salida de dinero.");
        return false;
      }
    }

    if (sku && sku.trim() !== '') {
      // Buscamos si existe algun lote con ese SKU
      const existingBatches = await queryByIndex(STORES.PRODUCT_BATCHES, 'sku', sku);

      // Si estamos editando, excluimos el lote actual de la búsqueda
      const isDuplicate = existingBatches.some(b =>
        isEditing ? b.id !== batchToEdit.id : true
      );

      if (isDuplicate) {
        showMessageModal(`⚠️ El SKU "${sku}" ya está en uso en otro lote/producto.`);
        return false;
      }
    }

    const finalSku = features.hasVariants ? generateAutoSku() : null;

    const batchData = {
      id: isEditing ? batchToEdit.id : generateID('batch'),
      productId: product.id,
      cost: nCost,
      price: nPrice,
      stock: nStock,
      notes: notes || null,
      trackStock: nStock > 0,
      isActive: nStock > 0,
      createdAt: isEditing ? batchToEdit.createdAt : new Date().toISOString(),
      expiryDate: (features.hasLots && expiryDate) ? expiryDate : null,
      sku: finalSku,
      attributes: features.hasVariants ? {
        talla: attribute1,
        color: attribute2
      } : null,
      location: location,
    };

    const success = await onSave(batchData);
    if (!success) return false;

    await adjustInventoryValue(valueDifference);

    if (shouldClose) {
      onClose();
    } else {
      // --- FLUJO RÁPIDO (Agilidad para Ropa) ---
      setStock('');
      // Solo limpiamos Talla y SKU, mantenemos Color, Costo y Precio
      setAttribute1('');
      setSku('');
      showMessageModal('Guardado. Agrega la siguiente talla.', null, { type: 'success' });

      // Re-enfocar el input de Talla/Modelo para seguir escribiendo sin usar el mouse
      setTimeout(() => {
        // Buscamos el input de Talla (Attribute 1)
        const tallaInput = document.getElementById('input-talla');
        if (tallaInput) tallaInput.focus();
        else if (firstInputRef.current) firstInputRef.current.focus();
      }, 100);
    }
    return true;
  };

  return (
    <div className="modal" style={{ display: 'flex' }}>
      <div className="modal-content batch-form-modal">
        <h2 className="modal-title">{isEditing ? 'Editar' : 'Registrar'} {features.hasVariants ? 'Variante' : 'Lote'}</h2>
        <p>Producto: <strong>{product.name}</strong></p>

        <form onSubmit={(e) => e.preventDefault()}>
          {features.hasVariants && (
            <>
              <div className="form-group">
                <label>Color / Marca / Material</label>
                <input
                  ref={firstInputRef}
                  type="text"
                  placeholder="Ej: Rojo, Nike, Acero"
                  value={attribute2}
                  onChange={(e) => setAttribute2(e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>Talla / Modelo / Dimensiones</label>
                <input
                  id="input-talla" /* ID para el auto-focus */
                  type="text"
                  placeholder="Ej: M, 28 mx, 10cm"
                  value={attribute1}
                  onChange={(e) => setAttribute1(e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>SKU (Auto-generado si se deja vacío)</label>
                <input
                  type="text"
                  placeholder="Generar automático..."
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className="form-input"
                />
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Costo Unitario ($)</label>
              <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className="form-input" />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Precio Venta ($)</label>
              <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="form-input" />
            </div>
          </div>

          <div className="form-group">
            <label>Cantidad (Stock) *</label>
            <input
              type="number"
              min="0"
              step="1"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              className="form-input"
              style={{ fontSize: '1.2rem', fontWeight: 'bold' }}
            />
          </div>

          <div className="form-group">
            <label>Ubicación en Bodega</label>
            <input
              type="text"
              placeholder="Ej: Estante A-3"
              value={location}
              onChange={e => setLocation(e.target.value)}
              className="form-input"
            />
          </div>

          {features.hasLots && (
            <div className="form-group">
              <label>Fecha Caducidad</label>
              <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="form-input" />
            </div>
          )}

          <div className="form-group">
            <label>Notas</label>
            <textarea placeholder="Detalles de compra..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {!isEditing && (
            <div className="form-group-checkbox" style={{ marginTop: '5px', padding: '8px', backgroundColor: '#fff3cd', borderRadius: '8px' }}>
              <input
                type="checkbox"
                id="pay-from-caja"
                checked={pagadoDeCaja}
                onChange={(e) => setPagadoDeCaja(e.target.checked)}
              />
              <label htmlFor="pay-from-caja" style={{ fontSize: '0.9rem' }}>💸 Pagar con dinero de Caja</label>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>
            {/* BOTÓN PRINCIPAL: GUARDAR Y AGREGAR OTRO */}
            {!isEditing && (
              <button
                type="button"
                className="btn btn-save"
                onClick={() => handleProcessSave(false)}
                style={{ backgroundColor: 'var(--secondary-color)' }}
              >
                💾 Guardar y Agregar Otra Talla/Lote
              </button>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-cancel" onClick={onClose} style={{ flex: 1 }}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={() => handleProcessSave(true)} style={{ flex: 1 }}>
                {isEditing ? 'Actualizar' : 'Guardar y Cerrar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

/**
 * Componente Principal
 */
export default function BatchManager({ selectedProductId, onProductSelect }) {
  const features = useFeatureConfig();

  // --- CAMBIO: Usamos useProductStore y useStatsStore ---
  const rawProducts = useProductStore((state) => state.rawProducts);
  const refreshData = useProductStore((state) => state.loadInitialProducts); // Ojo: loadAllData ya no existe
  const menu = useProductStore((state) => state.menu);
  const loadBatchesForProduct = useProductStore((state) => state.loadBatchesForProduct);
  const adjustInventoryValue = useStatsStore(state => state.adjustInventoryValue);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [batchToEdit, setBatchToEdit] = useState(null);
  const [localBatches, setLocalBatches] = useState([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Sincronizar buscador
  useEffect(() => {
    if (selectedProductId) {
      const prod = rawProducts.find(p => p.id === selectedProductId);
      if (prod) setSearchTerm(prod.name);
    } else {
      setSearchTerm('');
    }
  }, [selectedProductId, rawProducts]);

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return [];
    const lower = searchTerm.toLowerCase();
    return rawProducts.filter(p => p.name.toLowerCase().includes(lower)).slice(0, 10);
  }, [searchTerm, rawProducts]);

  const selectedProduct = useMemo(() => {
    return rawProducts.find(p => p.id === selectedProductId);
  }, [selectedProductId, rawProducts]);

  // Cargar lotes
  useEffect(() => {
    const fetchBatches = async () => {
      if (selectedProductId) {
        setIsLoadingBatches(true);
        try {
          const batches = await loadBatchesForProduct(selectedProductId);
          setLocalBatches(Array.isArray(batches) ? batches : []);
        } catch (error) {
          console.error("Error cargando lotes:", error);
          setLocalBatches([]);
        } finally {
          setIsLoadingBatches(false);
        }
      } else {
        setLocalBatches([]);
      }
    };
    fetchBatches();
  }, [selectedProductId, loadBatchesForProduct]);

  const productBatches = useMemo(() => {
    if (!selectedProductId || !localBatches) return [];
    return [...localBatches].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [selectedProductId, localBatches]);

  const totalStock = productBatches.reduce((sum, b) => sum + b.stock, 0);
  const inventoryValue = productBatches.reduce((sum, b) => sum + (b.cost * b.stock), 0);

  const handleSelectProduct = (product) => {
    setSearchTerm(product.name);
    onProductSelect(product.id);
    setShowSuggestions(false);
  }

  const handleActionableError = (result) => {
    const { message } = result.error;
    showMessageModal(message);
  };

  const handleSaveBatch = async (batchData) => {
    try {
      // Si el producto no tenía activado el manejo de lotes, lo activamos
      if (selectedProduct && !selectedProduct.batchManagement?.enabled) {
        // Esto podría hacerse dentro de saveBatchAndSyncProduct también, 
        // pero está bien dejarlo explícito aquí.
        const updatedProduct = {
          ...selectedProduct,
          batchManagement: { enabled: true, selectionStrategy: 'fifo' }
        };
        await saveDataSafe(STORES.MENU, updatedProduct);
      }

      // AQUÍ ESTÁ EL CAMBIO CLAVE:
      // En lugar de saveData(STORES.PRODUCT_BATCHES...), usamos la función sincronizada.
      const result = await saveBatchAndSyncProductSafe(batchData);

      const updatedBatches = await loadBatchesForProduct(selectedProductId);
      setLocalBatches(updatedBatches);

      // Refrescamos la lista global de productos para ver el nuevo stock total en la tabla
      await refreshData();

      showMessageModal('✅ Lote guardado y stock total actualizado.');

    } catch (error) {
      console.error(error);
      showMessageModal(`Error: ${error.message}`);
    }
  };

  const handleEditBatch = (batch) => {
    setBatchToEdit(batch);
    setIsModalOpen(true);
  };

  const handleDeleteBatch = async (batch) => {
    if (batch.stock > 0) {
      showMessageModal("No puedes eliminar con stock disponible. Pon el stock en 0 primero.");
      return;
    }
    if (window.confirm('¿Eliminar este registro permanentemente?')) {
      try {
        const batchValue = batch.cost * batch.stock;

        const result = await deleteDataSafe(STORES.PRODUCT_BATCHES, batch.id);

        if (batchValue > 0) {
          await adjustInventoryValue(-batchValue);
        }

        const updatedBatches = await loadBatchesForProduct(selectedProductId);
        setLocalBatches(updatedBatches);
        refreshData();
      } catch (error) { console.error(error); }
    }
  };

  // Formato de fecha seguro
  const formatDate = (iso) => iso ? new Date(iso).toLocaleDateString() : '-';

  return (
    <div className="batch-manager-container">
      <div className="form-group">
        <label className="form-label">Buscar Producto</label>
        <div className="product-selector-wrapper">
          <input
            type="text"
            className="form-input product-search-input"
            placeholder="Buscar producto..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          />
          {searchTerm && <button className="btn-clear-search" onClick={() => { setSearchTerm(''); onProductSelect(null); }}>×</button>}

          {showSuggestions && searchTerm && (
            <div className="product-suggestions-list">
              {filteredProducts.map(p => (
                <div key={p.id} className="product-suggestion-item" onMouseDown={() => handleSelectProduct(p)}>
                  <span className="suggestion-name">{p.name}</span>
                  {/* --- RECUPERADO: Muestra el stock para referencia rápida --- */}
                  <span className="suggestion-meta">Stock: {p.stock || 0}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!selectedProduct && !isLoadingBatches && (
        <p style={{ textAlign: 'center', color: '#888', marginTop: '20px' }}>Selecciona un producto para comenzar.</p>
      )}

      {selectedProduct && (
        <div className="batch-details-container">
          <div className="batch-controls">
            <h4 style={{ margin: 0, fontSize: '1rem' }}>
              Lotes/Variantes: {productBatches.length} <br />
              <span style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>Stock Total: {totalStock} | Valor: ${inventoryValue.toFixed(2)}</span>
            </h4>
            <button className="btn btn-save" onClick={() => { setBatchToEdit(null); setIsModalOpen(true); }}>
              + Nuevo Ingreso
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="batch-list-table">
              <thead>
                <tr>
                  {features.hasVariants ? <th>Variante</th> : <th>Fecha</th>}
                  {features.hasVariants && <th>SKU</th>}
                  {features.hasLots && <th>Caducidad</th>}
                  <th>Precio</th>
                  <th>Ubicacion</th>
                  <th>Stock</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {productBatches.map(batch => (
                  <tr key={batch.id} className={!batch.isActive ? 'inactive-batch' : ''}>
                    <td>
                      {features.hasVariants ? (
                        <><strong>{batch.attributes?.talla || '-'}</strong> {batch.attributes?.color}</>
                      ) : (
                        <>{formatDate(batch.createdAt)}</>
                      )}
                    </td>
                    <td><small>{batch.location || '-'}</small></td>
                    {features.hasVariants && <td><small>{batch.sku}</small></td>}
                    {features.hasLots && <td>{formatDate(batch.expiryDate)}</td>}
                    <td>${batch.price.toFixed(2)}</td>
                    <td>
                      <span className={`batch-badge ${batch.stock > 0 ? 'activo' : 'agotado'}`}>{batch.stock}</span>
                    </td>
                    <td>
                      <button className="btn-action" onClick={() => handleEditBatch(batch)}>✏️</button>
                      <button className="btn-action" onClick={() => handleDeleteBatch(batch)}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isModalOpen && (
        <BatchForm
          product={selectedProduct}
          batchToEdit={batchToEdit}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveBatch}
          features={features}
          menu={menu}
        />
      )}
    </div>
  );
}