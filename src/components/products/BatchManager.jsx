// src/components/products/BatchManager.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useDashboardStore } from '../../store/useDashboardStore';
import { saveData, STORES, deleteData } from '../../services/database';
import { showMessageModal } from '../../services/utils';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useCaja } from '../../hooks/useCaja';
import './BatchManager.css';
import { Menu } from 'lucide-react';

/**
 * Formulario para añadir o editar un lote O variante (Modal)
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
  const [attribute1, setAttribute1] = useState('');
  const [attribute2, setAttribute2] = useState('');

  // Estado para pagar desde caja
  const [pagadoDeCaja, setPagadoDeCaja] = useState(false);

  // Acceso a la caja
  const { registrarMovimiento, cajaActual } = useCaja();

  const isEditing = !!batchToEdit;

  useEffect(() => {
    if (isEditing) {
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
      let calculatedCost = '';

      if (product.recipe && product.recipe.length > 0) {
        const totalRecipeCost = product.recipe.reduce((sum, item) => {
          const ingredient = menu.find(p => p.id === item.ingredientId);
          const unitCost = ingredient?.cost || 0;
          return sum + (item.quantity * unitCost);
        }, 0);

        if (totalRecipeCost > 0) {
          calculatedCost = totalRecipeCost.toFixed(2);
        }
      }

      setCost(calculatedCost);
      setPrice(product.price || '');

      setStock('');
      setNotes('');
      setPagadoDeCaja(false);

      if (features.hasLots) setExpiryDate('');
      if (features.hasVariants) {
        setSku('');
        setAttribute1('');
        setAttribute2('');
      }
    }
  }, [batchToEdit, isEditing, features, product, menu]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const nStock = parseInt(stock, 10);
    const nCost = parseFloat(cost);
    const nPrice = parseFloat(price);

    if (isNaN(nStock) || isNaN(nCost) || isNaN(nPrice)) {
      showMessageModal("Por favor, ingresa valores numéricos válidos.");
      return;
    }

    // Lógica de pago desde caja
    if (pagadoDeCaja && !isEditing) {
      if (product.BatchManager?.enabled) {
        if (product.shelfLife && product.shelfLife > 0) {
          const today = new Date();
          today.setDate(today.getDate() + parseInt(product.shelfLife));
          setExpiryDate(today.toISOString().split('T')[0]);
        } else {
          setExpiryDate('');
        }
      }
      if (!cajaActual || cajaActual.estado !== 'abierta') {
        showMessageModal("⚠️ La caja está cerrada. Abre la caja para registrar el pago.");
        return;
      }

      const totalCosto = nCost * nStock;
      const conceptoSalida = `Compra Stock: ${product.name} (x${nStock})`;

      const exito = await registrarMovimiento('salida', totalCosto, conceptoSalida);

      if (!exito) {
        showMessageModal("Error al registrar la salida de dinero.");
        return;
      }
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
            <label>Costo Unitario ($) *</label>
            <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Precio Venta ($) *</label>
            <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Stock Actual *</label>
            <input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} required />
          </div>

          {features.hasLots && (
            <div className="form-group">
              <label>Fecha Caducidad</label>
              <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
          )}

          <div className="form-group">
            <label>Notas</label>
            <textarea placeholder="Detalles de compra..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {!isEditing && (
            <div className="form-group-checkbox" style={{ marginTop: '10px', padding: '10px', backgroundColor: '#fff3cd', borderRadius: '8px' }}>
              <input
                type="checkbox"
                id="pay-from-caja"
                checked={pagadoDeCaja}
                onChange={(e) => setPagadoDeCaja(e.target.checked)}
              />
              <label htmlFor="pay-from-caja">💸 Pagar con dinero de Caja</label>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
            <button type="button" className="btn btn-cancel" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-save">Guardar</button>
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
  const rawProducts = useDashboardStore((state) => state.rawProducts);
  const refreshData = useDashboardStore((state) => state.loadAllData);

  const menu = useDashboardStore((state) => state.menu);

  const loadBatchesForProduct = useDashboardStore((state) => state.loadBatchesForProduct);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [batchToEdit, setBatchToEdit] = useState(null);
  const [localBatches, setLocalBatches] = useState([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (selectedProductId) {
      const prod = rawProducts.find(p => p.id === selectedProductId);
      if (prod) {
        setSearchTerm(prod.name);
      }
    } else {
      setSearchTerm('');
    }
  }, [selectedProductId, rawProducts]);

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return [];
    const lower = searchTerm.toLowerCase();
    return rawProducts
      .filter(p => p.name.toLowerCase().includes(lower))
      .slice(0, 10);
  }, [searchTerm, rawProducts]);

  const selectedProduct = useMemo(() => {
    return rawProducts.find(p => p.id === selectedProductId);
  }, [selectedProductId, rawProducts]);

  // CORRECCIÓN 2: Sintaxis del useEffect arreglada (paréntesis y dependencias)
  useEffect(() => {
    const fetchBatches = async () => {
      if (selectedProductId) {
        setIsLoadingBatches(true);
        try {
          const batches = await loadBatchesForProduct(selectedProductId);
          // Aseguramos que sea un array para evitar error de .sort
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

  // CORRECCIÓN 3: Validación de seguridad en el sort
  const productBatches = useMemo(() => {
    if (!selectedProductId || !localBatches) return [];
    return [...localBatches].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [selectedProductId, localBatches]);

  const inventoryValue = useMemo(() => {
    return productBatches.reduce((sum, b) => sum + (b.cost * b.stock), 0);
  }, [productBatches]);

  const totalStock = useMemo(() => {
    return productBatches.reduce((sum, b) => sum + b.stock, 0);
  }, [productBatches]);

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    setShowSuggestions(true);
    if (e.target.value === '') {
      onProductSelect(null);
    }
  };

  const handleSelectProduct = (product) => {
    setSearchTerm(product.name);
    onProductSelect(product.id);
    setShowSuggestions(false);
  }

  const handleClearSearch = () => {
    setSearchTerm('');
    onProductSelect(null);
    setShowSuggestions(false);
  }

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
      await refreshData(); // Recarga para actualizar la vista global
      showMessageModal('Estrategia actualizada.');
    }
  };

  const handleSaveBatch = async (batchData) => {
    try {
      // Activar gestión de lotes si no estaba activa
      if (selectedProduct && !selectedProduct.batchManagement?.enabled) {
        const updatedProduct = {
          ...selectedProduct,
          batchManagement: {
            enabled: true,
            selectionStrategy: 'fifo'
          }
        };
        await saveData(STORES.MENU, updatedProduct);
      }

      await saveData(STORES.PRODUCT_BATCHES, batchData);

      // Recargar solo los lotes locales para rapidez
      const updatedBatches = await loadBatchesForProduct(selectedProductId);
      setLocalBatches(updatedBatches);

      // Actualizar vista global en segundo plano
      await refreshData(true);
      showMessageModal('Guardado exitosamente.');
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
      showMessageModal("No puedes eliminar un lote con stock. Pon el stock en 0 primero.");
      return;
    }
    if (window.confirm('¿Eliminar este registro permanentemente?')) {
      try {
        await deleteData(STORES.PRODUCT_BATCHES, batch.id);
        const updatedBatches = await loadBatchesForProduct(selectedProductId);
        setLocalBatches(updatedBatches);
        refreshData(true);
        showMessageModal('Eliminado.');
      } catch (error) {
        console.error(error);
      }
    }
  };

  const formatDate = (iso) => iso ? new Date(iso).toLocaleDateString() : '-';

  return (
    <div className="batch-manager-container">
      <div className="form-group">
        <label className="form-label">Buscar Producto</label>
        <div className="product-selector-wrapper">
          <input
            type="text"
            className="form-input product-search-input"
            placeholder="Escribe para buscar (ej. Huevo, Paracetamol)..."
            value={searchTerm}
            onChange={handleSearchChange}
            onFocus={() => setShowSuggestions(true)}
            // Retrasamos el blur para permitir el click en la lista
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          />

          {searchTerm && (
            <button className="btn-clear-search" onClick={handleClearSearch}>×</button>
          )}

          {showSuggestions && searchTerm && (
            <div className="product-suggestions-list">
              {filteredProducts.length === 0 ? (
                <div style={{ padding: '10px', color: '#666', fontStyle: 'italic' }}>
                  No se encontraron productos.
                </div>
              ) : (
                filteredProducts.map(p => (
                  <div
                    key={p.id}
                    className="product-suggestion-item"
                    onMouseDown={() => handleSelectProduct(p)} // onMouseDown ocurre antes que onBlur
                  >
                    <span className="suggestion-name">{p.name}</span>
                    <span className="suggestion-meta">Stock Actual: {p.stock || 0}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {isLoadingBatches && <p style={{ textAlign: 'center', color: '#666' }}>Cargando...</p>}

      {!isLoadingBatches && !selectedProduct && !searchTerm && (
        <p style={{ textAlign: 'center', color: 'var(--text-light)', marginTop: '20px' }}>
          👆 Busca un producto arriba para gestionar sus lotes.
        </p>
      )}

      {!isLoadingBatches && selectedProduct && (
        <div className="batch-details-container">
          <div className="batch-controls">
            {!features.hasVariants && (
              <div className="form-group batch-strategy">
                <label>Estrategia:</label>
                <select
                  className="form-input"
                  value={selectedProduct.batchManagement?.selectionStrategy || 'fifo'}
                  onChange={handleSaveStrategy}
                >
                  <option value="fifo">FIFO (Primero entra, primero sale)</option>
                  <option value="lifo">LIFO (Último entra, primero sale)</option>
                </select>
              </div>
            )}
            <button className="btn btn-save" onClick={() => { setBatchToEdit(null); setIsModalOpen(true); }}>
              + Nuevo Ingreso
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="batch-list-table">
              <thead>
                <tr>
                  {features.hasVariants && <th>Variante / SKU</th>}
                  {features.hasLots && <th>Caducidad</th>}
                  <th>Costo</th>
                  <th>Precio</th>
                  <th>Stock</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {productBatches.map(batch => (
                  <tr key={batch.id} className={!batch.isActive ? 'inactive-batch' : ''}>
                    {features.hasVariants && (
                      <td>
                        {batch.attributes?.talla} {batch.attributes?.color} <br />
                        <small>{batch.sku}</small>
                      </td>
                    )}
                    {features.hasLots && <td>{formatDate(batch.expiryDate)}</td>}
                    <td>${batch.cost.toFixed(2)}</td>
                    <td>${batch.price.toFixed(2)}</td>
                    <td>
                      {batch.stock}
                      {batch.stock < 5 && batch.stock > 0 && <span className="batch-badge bajo">Bajo</span>}
                      {batch.stock === 0 && <span className="batch-badge agotado">0</span>}
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

          <div className="batch-summary">
            <p>Stock Total: {totalStock}</p>
            <p>Valor Inventario: ${inventoryValue.toFixed(2)}</p>
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