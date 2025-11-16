// src/components/products/BatchManager.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useDashboardStore } from '../../store/useDashboardStore';
import { saveData, STORES, deleteData } from '../../services/database';
import { showMessageModal } from '../../services/utils';
import './BatchManager.css';

/**
 * Formulario para añadir o editar un lote (Modal)
 * Lo anidamos aquí para simplificar el manejo de archivos.
 * Este es tu "Formulario de Nuevo Lote" (UI 1).
 */
const BatchForm = ({ product, batchToEdit, onClose, onSave }) => {
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');

  const isEditing = !!batchToEdit;

  useEffect(() => {
    if (isEditing) {
      setCost(batchToEdit.cost);
      setPrice(batchToEdit.price);
      setStock(batchToEdit.stock);
      setExpiryDate(batchToEdit.expiryDate ? batchToEdit.expiryDate.split('T')[0] : '');
      setNotes(batchToEdit.notes || '');
    } else {
      setCost('');
      setPrice('');
      setStock('');
      setExpiryDate('');
      setNotes('');
    }
  }, [batchToEdit, isEditing]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const nStock = parseInt(stock, 10);
    const nCost = parseFloat(cost);
    const nPrice = parseFloat(price);

    if (isNaN(nStock) || isNaN(nCost) || isNaN(nPrice)) {
        showMessageModal("Por favor, ingresa valores numéricos válidos para costo, precio y stock.");
        return;
    }

    const now = new Date().toISOString();
    
    const batchData = {
      id: isEditing ? batchToEdit.id : `batch-${product.id}-${Date.now()}`,
      productId: product.id,
      cost: nCost,
      price: nPrice,
      stock: nStock,
      expiryDate: expiryDate || null,
      notes: notes || null,
      trackStock: nStock > 0,
      isActive: nStock > 0, // Se activa si tiene stock
      createdAt: isEditing ? batchToEdit.createdAt : now,
    };

    await onSave(batchData);
    onClose();
  };

  return (
    <div className="modal" style={{ display: 'flex' }}>
      <div className="modal-content batch-form-modal">
        <h2 className="modal-title">{isEditing ? 'Editar Lote' : 'Registrar Nuevo Lote'}</h2>
        <p>Producto: <strong>{product.name}</strong></p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Costo por unidad ($) *</label>
            <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Precio de venta ($) *</label>
            <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Cantidad a ingresar (Stock) *</label>
            <input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Fecha de caducidad (opcional)</label>
            <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Notas del lote (opcional)</label>
            <textarea placeholder="Ej: Compra en Bodega Aurrera" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-save">Guardar Lote</button>
          <button type="button" className="btn btn-cancel" onClick={onClose}>Cancelar</button>
        </form>
      </div>
    </div>
  );
};

/**
 * Componente principal BatchManager (Tu "UI 2")
 */
export default function BatchManager({ selectedProductId, onProductSelect }) {
  // Conexión al store
  const rawProducts = useDashboardStore((state) => state.rawProducts);
  const rawBatches = useDashboardStore((state) => state.rawBatches);
  const refreshData = useDashboardStore((state) => state.loadAllData);

  // Estado local
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [batchToEdit, setBatchToEdit] = useState(null);

  const selectedProduct = useMemo(() => {
    return rawProducts.find(p => p.id === selectedProductId);
  }, [selectedProductId, rawProducts]);

  const productBatches = useMemo(() => {
    if (!selectedProductId) return [];
    return rawBatches
      .filter(b => b.productId === selectedProductId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Más nuevos primero
  }, [selectedProductId, rawBatches]);

  const inventoryValue = useMemo(() => {
    return productBatches.reduce((sum, b) => sum + (b.cost * b.stock), 0);
  }, [productBatches]);

  const totalStock = useMemo(() => {
    return productBatches.reduce((sum, b) => sum + b.stock, 0);
  }, [productBatches]);

  const handleSaveStrategy = async (e) => {
    const newStrategy = e.target.value;
    if (selectedProduct) {
      const updatedProduct = {
        ...selectedProduct,
        batchManagement: {
          ...selectedProduct.batchManagement,
          enabled: true, // Aseguramos que esté activo
          selectionStrategy: newStrategy,
        },
        updatedAt: new Date().toISOString()
      };
      await saveData(STORES.MENU, updatedProduct);
      await refreshData();
      showMessageModal('Estrategia actualizada.');
    }
  };

  const handleSaveBatch = async (batchData) => {
    try {
      // Al guardar un lote, nos aseguramos que la gestión de lotes
      // esté habilitada para el producto padre.
      if (selectedProduct && !selectedProduct.batchManagement?.enabled) {
        const updatedProduct = {
          ...selectedProduct,
          batchManagement: {
            ...selectedProduct.batchManagement,
            enabled: true,
          },
          updatedAt: new Date().toISOString()
        };
        await saveData(STORES.MENU, updatedProduct);
      }

      await saveData(STORES.PRODUCT_BATCHES, batchData);
      await refreshData();
      showMessageModal('Lote guardado exitosamente.');
    } catch (error) {
      console.error("Error al guardar lote:", error);
      showMessageModal(`Error al guardar lote: ${error.message}`);
    }
  };

  const handleEditBatch = (batch) => {
    setBatchToEdit(batch);
    setIsModalOpen(true);
  };

  const handleDeleteBatch = async (batch) => {
    if (batch.stock > 0) {
        showMessageModal("No se puede eliminar un lote que aún tiene stock.");
        return;
    }
    if (window.confirm(`¿Seguro que quieres eliminar el lote ${batch.id}? Esta acción no se puede deshacer.`)) {
        try {
            await deleteData(STORES.PRODUCT_BATCHES, batch.id);
            await refreshData();
            showMessageModal('Lote eliminado.');
        } catch (error) {
            console.error("Error al eliminar lote:", error);
            showMessageModal(`Error al eliminar lote: ${error.message}`);
        }
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleDateString();
  };

  return (
    <div className="batch-manager-container">
      {/* 1. Selector de Producto */}
      <div className="form-group">
        <label className="form-label" htmlFor="product-batch-select">
          Selecciona un Producto para Gestionar sus Lotes
        </label>
        <select
          id="product-batch-select"
          className="form-input"
          value={selectedProductId || ''}
          onChange={(e) => onProductSelect(e.target.value)}
        >
          <option value="" disabled>Elige un producto...</option>
          {rawProducts.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* 2. Vista de Gestión (si hay producto) */}
      {selectedProduct ? (
        <div className="batch-details-container">
          <div className="batch-controls">
            <div className="form-group batch-strategy">
              <label>Estrategia de venta:</label>
              <select
                className="form-input"
                value={selectedProduct.batchManagement?.selectionStrategy || 'fifo'}
                onChange={handleSaveStrategy}
              >
                <option value="fifo">FIFO (Primero en entrar, primero en salir)</option>
                <option value="lifo">LIFO (Último en entrar, primero en salir)</option>
                <option value="lowest_price">Precio más bajo primero</option>
                <option value="highest_price">Precio más alto primero</option>
                <option value="nearest_expiry">Próximo a caducar primero</option>
              </select>
            </div>
            <button className="btn btn-save" onClick={() => { setBatchToEdit(null); setIsModalOpen(true); }}>
              [+] Registrar Nuevo Lote
            </button>
          </div>

          <table className="batch-list-table">
            <thead>
              <tr>
                <th>Ingreso</th>
                <th>Costo</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Caduca</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {productBatches.map(batch => (
                <tr key={batch.id} className={!batch.isActive ? 'inactive-batch' : ''}>
                  <td>{formatDate(batch.createdAt)}</td>
                  <td>${batch.cost.toFixed(2)}</td>
                  <td>${batch.price.toFixed(2)}</td>
                  <td>{batch.stock}</td>
                  <td>{formatDate(batch.expiryDate)}</td>
                  <td>
                    {batch.stock === 0 ? <span className="batch-badge agotado">Agotado</span> :
                     batch.stock < 5 ? <span className="batch-badge bajo">Bajo</span> :
                     <span className="batch-badge activo">Activo</span>}
                  </td>
                  <td>
                    <button className="btn-action" onClick={() => handleEditBatch(batch)}>✏️</button>
                    <button className="btn-action" onClick={() => handleDeleteBatch(batch)}>🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          <div className="batch-summary">
            <p><strong>Stock total:</strong> {totalStock} unidades</p>
            <p><strong>Valor de inventario (Costo):</strong> ${inventoryValue.toFixed(2)}</p>
          </div>
        </div>
      ) : (
        <p className="empty-message">Por favor, selecciona un producto.</p>
      )}

      {/* 3. Modal de Formulario */}
      {isModalOpen && (
        <BatchForm
          product={selectedProduct}
          batchToEdit={batchToEdit}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveBatch}
        />
      )}
    </div>
  );
}