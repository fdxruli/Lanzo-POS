// src/components/products/BatchManager.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useDashboardStore } from '../../store/useDashboardStore';
import { saveData, STORES, deleteData } from '../../services/database';
import { showMessageModal } from '../../services/utils';
import { useFeatureConfig } from '../../hooks/useFeatureConfig'; // 1. IMPORTAMOS EL HOOK
import './BatchManager.css';

/**
 * Formulario para añadir o editar un lote O variante (Modal)
 * Este es tu "Formulario de Nuevo Lote" (UI 1).
 */
const BatchForm = ({ product, batchToEdit, onClose, onSave, features }) => { // 2. Recibe 'features'
  
  // --- Estados Comunes ---
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [notes, setNotes] = useState('');
  
  // --- Estado para Lotes (Farmacia) ---
  const [expiryDate, setExpiryDate] = useState('');

  // --- 3. NUEVOS Estados para Variantes (Ropa/Ferretería) ---
  const [sku, setSku] = useState('');
  const [attribute1, setAttribute1] = useState(''); // Ej: Talla, Modelo
  const [attribute2, setAttribute2] = useState(''); // Ej: Color, Marca

  const isEditing = !!batchToEdit;

  useEffect(() => {
    if (isEditing) {
      // Cargar datos comunes
      setCost(batchToEdit.cost);
      setPrice(batchToEdit.price);
      setStock(batchToEdit.stock);
      setNotes(batchToEdit.notes || '');

      // 4. Cargar datos condicionales
      if (features.hasLots) {
        setExpiryDate(batchToEdit.expiryDate ? batchToEdit.expiryDate.split('T')[0] : '');
      }
      if (features.hasVariants) {
        setSku(batchToEdit.sku || '');
        // (Esto es un ejemplo simple, puedes hacerlo más robusto)
        const attrs = batchToEdit.attributes || {};
        setAttribute1(attrs.talla || attrs.modelo || '');
        setAttribute2(attrs.color || attrs.marca || '');
      }
    } else {
      // Resetear datos comunes
      setCost('');
      setPrice('');
      setStock('');
      setNotes('');
      
      // Resetear datos condicionales
      if (features.hasLots) {
        setExpiryDate('');
      }
      if (features.hasVariants) {
        setSku('');
        setAttribute1('');
        setAttribute2('');
      }
    }
    // 5. Dependencia de 'features' añadida
  }, [batchToEdit, isEditing, features]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const nStock = parseInt(stock, 10);
    const nCost = parseFloat(cost);
    const nPrice = parseFloat(price);

    if (isNaN(nStock) || isNaN(nCost) || isNaN(nPrice)) {
        showMessageModal("Por favor, ingresa valores numéricos válidos for costo, precio y stock.");
        return;
    }

    const now = new Date().toISOString();
    
    // 6. Construir el objeto de datos dinámicamente
    const batchData = {
      id: isEditing ? batchToEdit.id : `batch-${product.id}-${Date.now()}`,
      productId: product.id,
      cost: nCost,
      price: nPrice,
      stock: nStock,
      notes: notes || null,
      trackStock: nStock > 0,
      isActive: nStock > 0,
      createdAt: isEditing ? batchToEdit.createdAt : now,
      
      // --- Campos Condicionales ---
      
      // (Farmacia)
      expiryDate: (features.hasLots && expiryDate) ? expiryDate : null,
      
      // (Ropa/Ferretería)
      sku: features.hasVariants ? sku : null,
      attributes: features.hasVariants ? {
        // (Ejemplo simple, puedes mejorar esto con etiquetas dinámicas)
        talla: attribute1, 
        color: attribute2
      } : null,
    };

    await onSave(batchData);
    onClose();
  };

  return (
    <div className="modal" style={{ display: 'flex' }}>
      <div className="modal-content batch-form-modal">
        {/* 7. Título Dinámico */}
        <h2 className="modal-title">{isEditing ? 'Editar' : 'Registrar'} {features.hasVariants ? 'Variante' : 'Lote'}</h2>
        <p>Producto: <strong>{product.name}</strong></p>
        
        <form onSubmit={handleSubmit}>
        
          {/* 8. CAMPOS CONDICIONALES PARA VARIANTES */}
          {features.hasVariants && (
            <>
              <div className="form-group">
                <label>SKU (Opcional)</label>
                <input type="text" placeholder="Ej: PLA-R-M" value={sku} onChange={(e) => setSku(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Atributo 1 (Ej: Talla, Modelo)</label>
                <input type="text" placeholder="Ej: M" value={attribute1} onChange={(e) => setAttribute1(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Atributo 2 (Ej: Color, Marca)</label>
                <input type="text" placeholder="Ej: Rojo" value={attribute2} onChange={(e) => setAttribute2(e.target.value)} />
              </div>
            </>
          )}

          {/* 9. CAMPOS COMUNES (Costo, Precio, Stock) */}
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

          {/* 10. CAMPO CONDICIONAL PARA LOTES */}
          {features.hasLots && (
            <div className="form-group">
              <label>Fecha de caducidad (opcional)</label>
              <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
          )}
          
          <div className="form-group">
            <label>Notas (opcional)</label>
            <textarea placeholder="Ej: Compra en Bodega Aurrera" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          
          <button type="submit" className="btn btn-save">Guardar {features.hasVariants ? 'Variante' : 'Lote'}</button>
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
  // 11. LLAMAMOS AL HOOK
  const features = useFeatureConfig();
  
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
    // ... (Esta función no necesita cambios)
    const newStrategy = e.target.value;
    if (selectedProduct) {
      const updatedProduct = {
        ...selectedProduct,
        batchManagement: {
          ...selectedProduct.batchManagement,
          enabled: true,
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
    // ... (Esta función no necesita cambios)
    try {
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
      showMessageModal('Lote/Variante guardado exitosamente.');
    } catch (error) {
      console.error("Error al guardar lote/variante:", error);
      showMessageModal(`Error al guardar: ${error.message}`);
    }
  };

  const handleEditBatch = (batch) => {
    setBatchToEdit(batch);
    setIsModalOpen(true);
  };

  const handleDeleteBatch = async (batch) => {
    // ... (Esta función no necesita cambios)
    if (batch.stock > 0) {
        showMessageModal("No se puede eliminar un lote/variante que aún tiene stock.");
        return;
    }
    if (window.confirm(`¿Seguro que quieres eliminar ${batch.id}? Esta acción no se puede deshacer.`)) {
        try {
            await deleteData(STORES.PRODUCT_BATCHES, batch.id);
            await refreshData();
            showMessageModal('Lote/Variante eliminado.');
        } catch (error) {
            console.error("Error al eliminar:", error);
            showMessageModal(`Error al eliminar: ${error.message}`);
        }
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleDateString();
  };

  // Función para mostrar atributos de variante
  const formatAttributes = (attrs) => {
    if (!attrs) return '-';
    // (Ejemplo simple, puedes mejorar esto)
    return `${attrs.talla || '?'} / ${attrs.color || '?'}`;
  };

  return (
    <div className="batch-manager-container">
      {/* 1. Selector de Producto */}
      <div className="form-group">
        <label className="form-label" htmlFor="product-batch-select">
          Selecciona un Producto para Gestionar sus {features.hasVariants ? 'Variantes' : 'Lotes'}
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
            
            {/* 12. Estrategia (Solo visible si NO son variantes) */}
            {!features.hasVariants && (
              <div className="form-group batch-strategy">
                <label>Estrategia de venta:</label>
                <select
                  className="form-input"
                  value={selectedProduct.batchManagement?.selectionStrategy || 'fifo'}
                  onChange={handleSaveStrategy}
                >
                  <option value="fifo">FIFO (Primero en entrar, primero en salir)</option>
                  <option value="lifo">LIFO (Último en entrar, primero en salir)</option>
                  {/* ... (otras opciones) ... */}
                </select>
              </div>
            )}
            
            {/* 13. Botón de Registro Dinámico */}
            <button className="btn btn-save" onClick={() => { setBatchToEdit(null); setIsModalOpen(true); }}>
              [+] Registrar {features.hasVariants ? 'Nueva Variante' : 'Nuevo Lote'}
            </button>
          </div>

          {/* 14. TABLA ADAPTATIVA */}
          <table className="batch-list-table">
            <thead>
              <tr>
                {/* Columnas de Variantes */}
                {features.hasVariants && (
                  <>
                    <th>Atributos</th>
                    <th>SKU</th>
                  </>
                )}
                {/* Columnas de Lotes */}
                {features.hasLots && (
                  <>
                    <th>Ingreso</th>
                    <th>Caduca</th>
                  </>
                )}
                {/* Columnas Comunes */}
                <th>Costo</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {productBatches.map(batch => (
                <tr key={batch.id} className={!batch.isActive ? 'inactive-batch' : ''}>
                  {/* Celdas de Variantes */}
                  {features.hasVariants && (
                    <>
                      <td>{formatAttributes(batch.attributes)}</td>
                      <td>{batch.sku || '-'}</td>
                    </>
                  )}
                  {/* Celdas de Lotes */}
                  {features.hasLots && (
                    <>
                      <td>{formatDate(batch.createdAt)}</td>
                      <td>{formatDate(batch.expiryDate)}</td>
                    </>
                  )}
                  
                  {/* Celdas Comunes */}
                  <td>${batch.cost.toFixed(2)}</td>
                  <td>${batch.price.toFixed(2)}</td>
                  <td>{batch.stock}</td>
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

      {/* 15. Pasar 'features' al Modal */}
      {isModalOpen && (
        <BatchForm
          product={selectedProduct}
          batchToEdit={batchToEdit}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveBatch}
          features={features}
        />
      )}
    </div>
  );
}