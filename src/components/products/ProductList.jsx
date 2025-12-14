import React, { useState, useMemo } from 'react';
import { getProductAlerts } from '../../services/utils';
import LazyImage from '../common/LazyImage';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useProductStore } from '../../store/useProductStore';
import WasteModal from './WasteModal';
import './ProductList.css';

export default function ProductList({ products, categories, isLoading, onEdit, onDelete, onToggleStatus }) {
  const features = useFeatureConfig();

  const refreshData = useProductStore((state) => state.loadInitialProducts);
  const loadMoreProducts = useProductStore((state) => state.loadMoreProducts);
  const hasMoreProducts = useProductStore((state) => state.hasMoreProducts);
  const isGlobalLoading = useProductStore((state) => state.isLoading);

  const [searchTerm, setSearchTerm] = useState('');
  const [showWaste, setShowWaste] = useState(false);
  const [productForWaste, setProductForWaste] = useState(null);

  const categoryMap = useMemo(() => {
    return new Map(categories.map(cat => [cat.id, cat.name]));
  }, [categories]);

  const filteredProducts = useMemo(() => {
    return products.filter(item =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  const handleOpenWaste = (product) => {
    setProductForWaste(product);
    setShowWaste(true);
  };

  const handleCloseWaste = () => {
    setProductForWaste(null);
    setShowWaste(false);
  };

  const handleWasteConfirmed = async () => {
    await refreshData();
  };

  if (isLoading && products.length === 0) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Cargando productos...</div>;
  }

  return (
    <div className="product-list-container">
      <h3 className="subtitle">Lista de Productos</h3>

      <div className="search-container">
        <input
          type="text"
          id="product-search-input"
          className="form-input"
          placeholder="Buscar por Nombre, Código o SKU"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {filteredProducts.length === 0 ? (
        <div className="empty-message">No hay productos {searchTerm && 'que coincidan'}.</div>
      ) : (
        <>
          <div id="product-list" className="product-list">
            {filteredProducts.map(item => {
              const categoryName = categoryMap.get(item.categoryId) || 'Sin categoría';
              const isActive = item.isActive !== false;
              
              // --- CAMBIO AUDITORÍA: Extraemos expiryDays también ---
              const { isLowStock, isNearingExpiry, expiryDays } = getProductAlerts(item);

              // Lógica de Stock Inteligente
              const isTracked = item.trackStock || item.batchManagement?.enabled;

              // CORRECCIÓN: Leemos la unidad guardada, si no existe usamos 'pza' como fallback
              const unitLabel = item.bulkData?.purchase?.unit || (item.saleType === 'bulk' ? 'kg' : 'pza');

              const itemClasses = [
                'product-item',
                isLowStock ? 'low-stock-warning' : '',
                isNearingExpiry ? 'nearing-expiry-warning' : ''
              ].filter(Boolean).join(' ');

              return (
                <div key={item.id} className={itemClasses}>
                  <div className={`product-status-badge ${isActive ? 'active' : 'inactive'}`}>
                    {isActive ? 'Activo' : 'Inactivo'}
                  </div>

                  <div className="product-item-info">
                    <LazyImage src={item.image} alt={item.name} />

                    <div className="product-item-details">
                      <span className="product-item-title" title={item.name}>{item.name}</span>

                      {features.hasVariants && (
                        <div style={{ fontSize: '0.75rem', color: '#666', fontFamily: 'monospace', marginBottom: '4px', display: 'flex', gap: '5px' }}>
                          {/* Si tiene gestión de lotes, es un producto padre con variantes */}
                          {item.batchManagement?.enabled ? (
                            <span style={{ backgroundColor: '#f3f4f6', padding: '2px 4px', borderRadius: '4px' }}>Variantes Múltiples</span>
                          ) : (
                            /* Si no, mostramos el SKU o código de barras simple */
                            <span>SKU: {item.sku || item.barcode || '---'}</span>
                          )}
                        </div>
                      )}

                      {item.sustancia && (
                        <p style={{ color: 'var(--secondary-color)', fontWeight: '500', fontSize: '0.8rem', justifyContent: 'flex-start' }}>
                          💊 {item.sustancia}
                        </p>
                      )}

                      {item.location && (
                        <div style={{
                          fontSize: '0.75rem',
                          backgroundColor: '#f1f5f9',
                          color: '#475569',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          display: 'inline-block',
                          marginTop: '2px',
                          border: '1px solid #cbd5e1'
                        }}>
                          📍 {item.location}
                        </div>
                      )}

                      <p style={{ color: '#666', fontSize: '0.8rem', justifyContent: 'flex-start' }}>{categoryName}</p>

                      <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <p>
                          <strong>Precio:</strong>
                          <span className="product-price-highlight">${item.price?.toFixed(2)}</span>
                        </p>
                        <p>
                          <span style={{ color: 'var(--text-light)' }}>Costo:</span>
                          <span>${item.cost?.toFixed(2)}</span>
                        </p>

                        <p style={{ marginTop: '2px' }}>
                          <strong>Existencia:</strong>
                          {isTracked ? (
                            item.stock > 0 ? (
                              <span style={{ fontWeight: 'bold', color: isLowStock ? 'var(--warning-color)' : 'var(--text-dark)' }}>
                                {item.stock} <small style={{ fontSize: '0.75em', textTransform: 'uppercase' }}>{unitLabel}</small>
                              </span>
                            ) : (
                              <span style={{ color: 'var(--error-color)', fontWeight: 'bold', fontSize: '0.9rem' }}>AGOTADO</span>
                            )
                          ) : (
                            <span style={{ fontStyle: 'italic', color: '#999', fontSize: '0.8rem' }}>Sin control</span>
                          )}
                        </p>
                      </div>

                      {/* --- CAMBIO AUDITORÍA: Alertas visuales detalladas --- */}
                      
                      {isLowStock && isTracked && item.stock > 0 && (
                        <span className="alert-indicator low-stock-indicator">
                          Stock bajo
                        </span>
                      )}

                      {isNearingExpiry && (
                        <span className="alert-indicator nearing-expiry-indicator">
                          {expiryDays === 0 ? '⏰ Caduca HOY' : `⏰ Caduca en ${expiryDays} días`}
                        </span>
                      )}
                      
                      {/* ----------------------------------------------------- */}
                    </div>
                  </div>

                  <div className="product-item-controls">
                    <button
                      className={`btn-toggle-status ${isActive ? 'btn-deactivate' : 'btn-activate'}`}
                      onClick={() => onToggleStatus(item)}
                      title={isActive ? "Desactivar" : "Activar"}
                    >
                      {isActive ? 'Desactivar' : 'Activar'}
                    </button>

                    {features.hasWaste && isActive && (
                      <button className="btn-waste" onClick={() => handleOpenWaste(item)} title="Registrar Merma">
                        Merma
                      </button>
                    )}

                    <button className="edit-product-btn" onClick={() => onEdit(item)} title="Editar">
                      ✏️
                    </button>

                    <button className="delete-product-btn" onClick={() => onDelete(item)} title="Eliminar">
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {!searchTerm && hasMoreProducts && (
            <div style={{ textAlign: 'center', marginTop: '20px', paddingBottom: '20px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => loadMoreProducts()}
                disabled={isGlobalLoading}
                style={{ minWidth: '200px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
              >
                {isGlobalLoading ? (
                  <>
                    <div className="spinner-loader small" style={{ borderWidth: '2px', width: '16px', height: '16px' }}></div>
                    Cargando...
                  </>
                ) : (
                  '⬇️ Cargar más productos'
                )}
              </button>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-light)', marginTop: '5px' }}>
                Mostrando {products.length} productos
              </p>
            </div>
          )}
        </>
      )}

      <WasteModal
        show={showWaste}
        onClose={handleCloseWaste}
        product={productForWaste}
        onConfirm={handleWasteConfirmed}
      />
    </div>
  );
}