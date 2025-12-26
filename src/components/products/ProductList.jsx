import React, { useState, useMemo } from 'react';
import { getProductAlerts } from '../../services/utils';
import LazyImage from '../common/LazyImage';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useProductStore } from '../../store/useProductStore';
import WasteModal from './WasteModal';
import './ProductList.css';

export default function ProductList({ products, categories, isLoading, onEdit, onDelete, onToggleStatus }) {
  const features = useFeatureConfig();

  // --- STORE ---
  const refreshData = useProductStore((state) => state.loadInitialProducts);
  const loadMoreProducts = useProductStore((state) => state.loadMoreProducts);
  const hasMoreProducts = useProductStore((state) => state.hasMoreProducts);
  const isGlobalLoading = useProductStore((state) => state.isLoading);
  
  // ✅ CORRECCIÓN 1: Importamos la búsqueda global para buscar en toda la BD
  const searchGlobal = useProductStore((state) => state.searchProducts);

  const [searchTerm, setSearchTerm] = useState('');
  const [showWaste, setShowWaste] = useState(false);
  const [productForWaste, setProductForWaste] = useState(null);

  const categoryMap = useMemo(() => {
    return new Map(categories.map(cat => [cat.id, cat.name]));
  }, [categories]);

  // Filtro local visual (para resaltar coincidencias rápidas sobre los resultados que traiga la BD)
  const filteredProducts = useMemo(() => {
    return products.filter(item =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.barcode?.includes(searchTerm) ||
      item.sku?.includes(searchTerm)
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
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <p>Cargando inventario...</p>
      </div>
    );
  }

  return (
    <div className="product-list-container">
      <div className="product-list-header">
        <h3 className="subtitle">Inventario de Productos</h3>
        <div className="search-wrapper">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="modern-search-input"
            placeholder="Buscar por nombre, código o SKU..."
            value={searchTerm}
            // ✅ CORRECCIÓN 2: Al escribir, buscamos en el servidor, no solo en la lista local
            onChange={(e) => {
              const val = e.target.value;
              setSearchTerm(val);
              searchGlobal(val); 
            }}
          />
        </div>
      </div>

      {filteredProducts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📦</div>
          <h3>No se encontraron productos</h3>
          <p>{searchTerm ? `No hay resultados para "${searchTerm}"` : 'Agrega productos para comenzar'}</p>
        </div>
      ) : (
        <>
          <div className="product-grid">
            {filteredProducts.map(item => {
              const categoryName = categoryMap.get(item.categoryId) || 'General';
              const isActive = item.isActive !== false;
              
              // Análisis de alertas
              const { isLowStock, isNearingExpiry, expiryDays } = getProductAlerts(item);
              const isTracked = item.trackStock || item.batchManagement?.enabled;
              const unitLabel = item.bulkData?.purchase?.unit || (item.saleType === 'bulk' ? 'kg' : 'pza');

              // Clases dinámicas para la tarjeta
              let cardStatusClass = '';
              if (isNearingExpiry) cardStatusClass = 'card-critical';
              else if (isLowStock) cardStatusClass = 'card-warning';

              return (
                <div key={item.id} className={`product-card ${cardStatusClass} ${!isActive ? 'card-inactive' : ''}`}>
                  
                  {/* --- Cabecera de Tarjeta --- */}
                  <div className="card-header">
                    <div className="card-image-wrapper">
                      <LazyImage src={item.image} alt={item.name} />
                      <span className={`status-badge ${isActive ? 'status-active' : 'status-inactive'}`}>
                        {isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                    
                    <div className="card-title-section">
                      <h4 className="product-name" title={item.name}>{item.name}</h4>
                      <span className="product-category">{categoryName}</span>
                    </div>
                  </div>

                  {/* --- Cuerpo de Información --- */}
                  <div className="card-body">
                    
                    {/* Sección de Alertas Visibles */}
                    {(isLowStock || isNearingExpiry) && (
                      <div className="alert-box">
                        {isNearingExpiry && (
                          <div className="alert-item alert-expiry">
                            <span className="alert-icon">⏰</span>
                            <span>{expiryDays === 0 ? 'Caduca HOY' : `Caduca en ${expiryDays} días`}</span>
                          </div>
                        )}
                        {isLowStock && isTracked && item.stock > 0 && (
                          <div className="alert-item alert-stock">
                            <span className="alert-icon">⚠️</span>
                            <span>Stock Bajo ({item.stock} {unitLabel})</span>
                          </div>
                        )}
                        {isTracked && item.stock <= 0 && (
                          <div className="alert-item alert-empty">
                            <span className="alert-icon">🚫</span>
                            <span>AGOTADO</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Metadatos (Tags) */}
                    <div className="meta-tags">
                      {item.sku && <span className="tag">SKU: {item.sku}</span>}
                      {item.sustancia && <span className="tag tag-blue">💊 {item.sustancia}</span>}
                      {item.location && <span className="tag tag-gray">📍 {item.location}</span>}
                      {item.batchManagement?.enabled && <span className="tag tag-purple">🔢 Lotes</span>}
                    </div>

                    {/* Datos Económicos */}
                    <div className="stats-row">
                      <div className="stat-group">
                        <span className="stat-label">Precio</span>
                        <span className="stat-value price">${item.price?.toFixed(2)}</span>
                      </div>
                      <div className="stat-group">
                        <span className="stat-label">Costo</span>
                        <span className="stat-value">${item.cost?.toFixed(2)}</span>
                      </div>
                      <div className="stat-group">
                        <span className="stat-label">Existencia</span>
                        {isTracked ? (
                           <span className={`stat-value ${item.stock <= 0 ? 'text-error' : ''}`}>
                             {item.stock} <small>{unitLabel}</small>
                           </span>
                        ) : (
                          <span className="stat-value infinite">∞</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* --- Footer de Acciones --- */}
                  <div className="card-footer">
                     <button
                      className={`icon-btn ${isActive ? 'btn-disable' : 'btn-enable'}`}
                      onClick={() => onToggleStatus(item)}
                      title={isActive ? "Desactivar Producto" : "Activar Producto"}
                    >
                      {isActive ? '🛑' : '✅'}
                    </button>

                    {features.hasWaste && isActive && (
                      <button className="icon-btn btn-waste" onClick={() => handleOpenWaste(item)} title="Registrar Merma">
                        🗑️ Merma
                      </button>
                    )}

                    <div className="action-spacer"></div>

                    <button className="icon-btn btn-edit" onClick={() => onEdit(item)} title="Editar">
                      ✏️
                    </button>
                    <button className="icon-btn btn-delete" onClick={() => onDelete(item)} title="Eliminar">
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Botón "Cargar Más" solo visible si NO estamos buscando (para no mezclar resultados de búsqueda con paginación) */}
          {!searchTerm && hasMoreProducts && (
            <div className="load-more-container">
              <button
                className="btn-load-more"
                onClick={() => loadMoreProducts()}
                disabled={isGlobalLoading}
              >
                {isGlobalLoading ? 'Cargando...' : '⬇️ Cargar más productos'}
              </button>
              <p className="count-label">Mostrando {products.length} productos</p>
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
