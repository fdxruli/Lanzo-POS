// src/components/products/BatchManager.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useDashboardStore } from '../../store/useDashboardStore';
import { saveData, STORES, deleteData } from '../../services/database';
import { showMessageModal } from '../../services/utils';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useCaja } from '../../hooks/useCaja'; // NUEVO: Importamos el hook de caja
import './BatchManager.css';

/**
 * Formulario para añadir o editar un lote O variante (Modal)
 */
const BatchForm = ({ product, batchToEdit, onClose, onSave, features }) => {
  
  // --- Estados Comunes ---
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [notes, setNotes] = useState('');
  
  // --- Estado para Lotes (Farmacia) ---
  const [expiryDate, setExpiryDate] = useState('');

  // --- Estados para Variantes (Ropa/Ferretería) ---
  const [sku, setSku] = useState('');
  const [attribute1, setAttribute1] = useState(''); 
  const [attribute2, setAttribute2] = useState(''); 

  // NUEVO: Estado para pagar desde caja
  const [pagadoDeCaja, setPagadoDeCaja] = useState(false);
  
  // NUEVO: Obtenemos acceso a la caja
  const { registrarMovimiento, cajaActual } = useCaja();

  const isEditing = !!batchToEdit;

  useEffect(() => {
    if (isEditing) {
      // Cargar datos al editar
      setCost(batchToEdit.cost);
      setPrice(batchToEdit.price);
      setStock(batchToEdit.stock);
      setNotes(batchToEdit.notes || '');

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
      // Resetear al crear nuevo
      setCost('');
      setPrice('');
      setStock('');
      setNotes('');
      setPagadoDeCaja(false); // Resetear checkbox
      
      if (features.hasLots) setExpiryDate('');
      if (features.hasVariants) {
        setSku('');
        setAttribute1('');
        setAttribute2('');
      }
    }
  }, [batchToEdit, isEditing, features]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const nStock = parseInt(stock, 10);
    const nCost = parseFloat(cost);
    const nPrice = parseFloat(price);

    if (isNaN(nStock) || isNaN(nCost) || isNaN(nPrice)) {
        showMessageModal("Por favor, ingresa valores numéricos válidos para costo, precio y stock.");
        return;
    }

    // NUEVO: Lógica inteligente de pago
    // Si el usuario marcó "Pagar de Caja" y es un NUEVO registro (no edición)
    if (pagadoDeCaja && !isEditing) {
        if (!cajaActual || cajaActual.estado !== 'abierta') {
            showMessageModal("⚠️ No se pudo registrar el pago: La caja está cerrada. Abre la caja primero.");
            return; 
        }
        
        const totalCosto = nCost * nStock;
        const conceptoSalida = `Compra Stock: ${product.name} (x${nStock})`;

        // Intentamos registrar la salida
        const exito = await registrarMovimiento('salida', totalCosto, conceptoSalida);
        
        if (!exito) {
            showMessageModal("Error al registrar la salida de dinero. El lote NO se guardó.");
            return; 
        }
        // Si tuvo éxito, procedemos a guardar el lote normalmente
    }

    const now = new Date().toISOString();
    
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
      
      // Campos Condicionales
      expiryDate: (features.hasLots && expiryDate) ? expiryDate : null,
      sku: features.hasVariants ? sku : null,
      attributes: features.hasVariants ? {
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
        <h2 className="modal-title">{isEditing ? 'Editar' : 'Registrar'} {features.hasVariants ? 'Variante' : 'Lote'}</h2>
        <p>Producto: <strong>{product.name}</strong></p>
        
        <form onSubmit={handleSubmit}>
        
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

          {/* NUEVO: Checkbox Inteligente para Pagar de Caja */}
          {!isEditing && (
            <div className="form-group-checkbox" style={{
                marginTop: '10px', 
                marginBottom: '20px',
                padding: '15px', 
                backgroundColor: 'var(--light-background)', 
                borderRadius: '8px', 
                border: '1px solid var(--warning-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px'
            }}>
                <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <input 
                        type="checkbox" 
                        id="pay-from-caja" 
                        checked={pagadoDeCaja} 
                        onChange={(e) => setPagadoDeCaja(e.target.checked)} 
                        style={{width: '20px', height: '20px'}}
                    />
                    <label htmlFor="pay-from-caja" style={{fontWeight: '700', color: 'var(--text-dark)', margin: 0, cursor: 'pointer'}}>
                        💸 Pagar con dinero de Caja
                    </label>
                </div>
                <div style={{fontSize: '0.85rem', color: 'var(--text-light)', marginLeft: '30px'}}>
                    Se registrará automáticamente una <strong>salida de efectivo</strong> por: <br/>
                    <span style={{color: 'var(--error-color)', fontWeight: 'bold', fontSize: '1rem'}}>
                        ${((parseFloat(cost) || 0) * (parseFloat(stock) || 0)).toFixed(2)}
                    </span>
                </div>
            </div>
          )}
          
          <button type="submit" className="btn btn-save">Guardar {features.hasVariants ? 'Variante' : 'Lote'}</button>
          <button type="button" className="btn btn-cancel" onClick={onClose}>Cancelar</button>
        </form>
      </div>
    </div>
  );
};

/**
 * Componente principal BatchManager
 */
export default function BatchManager({ selectedProductId, onProductSelect }) {
  const features = useFeatureConfig();
  
  const rawProducts = useDashboardStore((state) => state.rawProducts);
  const rawBatches = useDashboardStore((state) => state.rawBatches);
  const refreshData = useDashboardStore((state) => state.loadAllData);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [batchToEdit, setBatchToEdit] = useState(null);

  const selectedProduct = useMemo(() => {
    return rawProducts.find(p => p.id === selectedProductId);
  }, [selectedProductId, rawProducts]);

  const productBatches = useMemo(() => {
    if (!selectedProductId) return [];
    return rawBatches
      .filter(b => b.productId === selectedProductId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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

  const formatAttributes = (attrs) => {
    if (!attrs) return '-';
    return `${attrs.talla || '?'} / ${attrs.color || '?'}`;
  };

  return (
    <div className="batch-manager-container">
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

      {selectedProduct ? (
        <div className="batch-details-container">
          <div className="batch-controls">
            
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
                </select>
              </div>
            )}
            
            <button className="btn btn-save" onClick={() => { setBatchToEdit(null); setIsModalOpen(true); }}>
              [+] Registrar {features.hasVariants ? 'Nueva Variante' : 'Nuevo Lote'}
            </button>
          </div>

          <table className="batch-list-table">
            <thead>
              <tr>
                {features.hasVariants && (
                  <>
                    <th>Atributos</th>
                    <th>SKU</th>
                  </>
                )}
                {features.hasLots && (
                  <>
                    <th>Ingreso</th>
                    <th>Caduca</th>
                  </>
                )}
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
                  {features.hasVariants && (
                    <>
                      <td>{formatAttributes(batch.attributes)}</td>
                      <td>{batch.sku || '-'}</td>
                    </>
                  )}
                  {features.hasLots && (
                    <>
                      <td>{formatDate(batch.createdAt)}</td>
                      <td>{formatDate(batch.expiryDate)}</td>
                    </>
                  )}
                  
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