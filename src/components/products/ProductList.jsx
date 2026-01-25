import React, { useState, useMemo, useEffect } from 'react';
import { getProductAlerts } from '../../services/utils';
import LazyImage from '../common/LazyImage';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useProductStore } from '../../store/useProductStore';
import WasteModal from './WasteModal';
import './ProductList.css';

// --- ICONOS SVG REUTILIZABLES ---
const Icons = {
  Search: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
  ),
  Edit: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
  ),
  Delete: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
  ),
  Waste: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline></svg>
  ),
  Empty: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
  )
};

export default function ProductList({ products, categories, isLoading, onEdit, onDelete, onToggleStatus }) {
  const features = useFeatureConfig();

  // Acciones del Store
  const searchProducts = useProductStore((state) => state.searchProducts);
  const loadInitialProducts = useProductStore((state) => state.loadInitialProducts);
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

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchTerm.trim().length >= 2) {
        searchProducts(searchTerm);
      } else if (searchTerm.trim().length === 0) {
        loadInitialProducts();
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const filteredProducts = useMemo(() => {
    return products.filter(item =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.barcode?.includes(searchTerm) ||
      (item.sustancia && item.sustancia.toLowerCase().includes(searchTerm.toLowerCase()))
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

  const calculateMargin = (price, cost) => {
    if (!cost || cost <= 0 || !price) return null;
    const margin = ((price - cost) / price) * 100;
    return margin.toFixed(1);
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
      {/* --- Header --- */}
      <div className="list-header">
        <div className="title-group">
          <h3 className="subtitle">Inventario</h3>
          <span className="product-count">{filteredProducts.length} items mostrados</span>
        </div>

        <div className="search-box">
          <span className="search-icon"><Icons.Search /></span>
          <input
            type="text"
            placeholder={features.hasLabFields ? "Buscar: Nombre, Sustancia..." : "Buscar: Nombre, Código..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {filteredProducts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Icons.Empty /></div>
          <h3>No se encontraron productos</h3>
          <p>Intenta con otro término de búsqueda.</p>
        </div>
      ) : (
        <div className="product-grid">
          {filteredProducts.map(item => {
            const categoryName = categoryMap.get(item.categoryId) || 'General';
            const isActive = item.isActive !== false;

            // Alertas
            const { isLowStock, isNearingExpiry, expiryDays } = getProductAlerts(item);
            const isTracked = item.trackStock || item.batchManagement?.enabled;

            // Unidad de medida
            const unitLabel = features.hasBulk
              ? (item.bulkData?.purchase?.unit || (item.saleType === 'bulk' ? 'kg' : 'pza'))
              : 'pza';

            const margin = calculateMargin(item.price, item.cost);

            // Banderas de visualización
            const showLocation = item.location && item.location.trim() !== '';
            const showMinMax = features.hasMinMax && isTracked;
            const showPharmacyDetails = features.hasLabFields && (item.sustancia || item.laboratorio);
            const showBarcode = item.barcode && item.barcode.trim() !== '';

            // Clases dinámicas
            let borderClass = '';
            if (features.hasExpiry && isNearingExpiry) borderClass = 'border-critical';
            else if (isLowStock) borderClass = 'border-warning';

            return (
              <div key={item.id} className={`product-card-complex ${borderClass} ${!isActive ? 'opacity-dim' : ''}`}>

                {/* 1. Cabecera e Imagen */}
                <div className="complex-header">
                  <div className="img-area">
                    <LazyImage src={item.image} alt={item.name} />
                  </div>

                  <div className="title-area">
                    <div className="title-top">
                      <h4 title={item.name}>{item.name}</h4>
                    </div>
                    <div className="sub-meta">
                      <span className="category-badge">{categoryName}</span>
                      {features.hasSKU && item.sku && <span className="sku-badge">SKU: {item.sku}</span>}
                    </div>
                  </div>

                  <div className="actions-area">
                    <button className="btn-icon btn-edit" onClick={() => onEdit(item)} title="Editar Producto">
                      <Icons.Edit />
                    </button>
                    <button className="btn-icon btn-delete" onClick={() => onDelete(item)} title="Eliminar Producto">
                      <Icons.Delete />
                    </button>
                  </div>
                </div>

                {/* 2. Banner de Alertas (Solo si existen) */}
                {(features.hasExpiry && isNearingExpiry) || (isLowStock && isTracked) ? (
                  <div className="alert-section-wrapper">
                    {features.hasExpiry && isNearingExpiry && (
                      <div className="alert-banner alert-red">
                        📅 Caduca: {expiryDays === 0 ? 'HOY' : `${expiryDays} días`}
                      </div>
                    )}
                    {isLowStock && isTracked && (
                      <div className="alert-banner alert-orange">
                        ⚠️ Stock Bajo ({item.stock} {showMinMax ? `≤ ${item.minStock}` : ''})
                      </div>
                    )}
                  </div>
                ) : null}

                {/* 3. Métricas Principales (Precio y Stock) */}
                <div className="main-stats">
                  <div className="stat-block">
                    <span className="stat-label">Precio</span>
                    <span className="stat-value price">${item.price?.toFixed(2)}</span>
                  </div>
                  <div className="stat-block">
                    <span className="stat-label">Existencia</span>
                    <span className={`stat-value stock ${item.stock <= 0 ? 'text-red' : ''}`}>
                      {isTracked ? item.stock : '∞'} <small>{unitLabel}</small>
                    </span>
                  </div>
                  <div className="stat-block">
                    <span className="stat-label">Margen</span>
                    <span className={`stat-value ${margin > 30 ? 'text-success' : 'text-muted'}`}>
                      {margin ? `${margin}%` : '--'}
                    </span>
                  </div>
                </div>

                {/* 4. Detalles Específicos por Rubro */}
                <div className="details-container">

                  {/* CASO: FARMACIA */}
                  {showPharmacyDetails && (
                    <div className="rubro-section pharmacy">
                      <div className="detail-item full">
                        <span className="label">Sustancia:</span>
                        <span className="value">{item.sustancia}</span>
                      </div>
                      <div className="detail-row">
                        {item.presentation && <span className="pill-badge">{item.presentation}</span>}
                        {item.laboratorio && <span className="lab-badge">{item.laboratorio}</span>}
                      </div>
                    </div>
                  )}

                  {/* CASO: LOGÍSTICA / FERRETERÍA / ABARROTES */}
                  {(showLocation || showMinMax || showBarcode) && (
                    <div className="rubro-section logistics">
                      {showLocation && (
                        <div className="detail-item">
                          <span className="label">Ubicación:</span>
                          <span className="value">{item.location}</span>
                        </div>
                      )}
                      {showMinMax && (
                        <div className="detail-item">
                          <span className="label">Mín/Máx:</span>
                          <span className="value">{item.minStock} / {item.maxStock || '∞'}</span>
                        </div>
                      )}
                      {showBarcode && !showPharmacyDetails && (
                        <div className="detail-item full">
                          <span className="label">Código:</span>
                          <span className="value monospace">{item.barcode}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 5. Footer con Switch de Estado y Acciones Secundarias */}
                <div className="complex-footer">
                  <div className="status-switch-container" onClick={() => onToggleStatus(item)} title={isActive ? "Desactivar" : "Activar"}>
                    <div className={`switch-track ${isActive ? 'checked' : ''}`}>
                      <div className="switch-thumb"></div>
                    </div>
                    <span className="switch-label">{isActive ? 'Activo' : 'Inactivo'}</span>
                  </div>

                  <div className="footer-actions">
                    {/* Badges Informativos */}
                    {features.hasWholesale && item.wholesaleTiers?.length > 0 && (
                      <span className="feat-badge purple" title="Tiene precios de mayoreo">Mayoreo</span>
                    )}
                    {item.productType === 'ingredient' && (
                      <span className="feat-badge gray">Insumo</span>
                    )}

                    {/* Botón de Merma (Solo visible si el rubro lo permite y está activo) */}
                    {features.hasWaste && isActive && (
                      <button className="btn-waste-text" onClick={() => handleOpenWaste(item)}>
                        <Icons.Waste /> Merma
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!searchTerm && hasMoreProducts && (
        <div className="pagination-container">
          <button className="btn-load-more" onClick={() => loadMoreProducts()} disabled={isGlobalLoading}>
            {isGlobalLoading ? 'Cargando...' : 'Cargar más productos'}
          </button>
        </div>
      )}

      <WasteModal show={showWaste} onClose={handleCloseWaste} product={productForWaste} onConfirm={handleWasteConfirmed} />
    </div>
  );
}