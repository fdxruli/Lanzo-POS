import React, { useState, useMemo, useEffect } from 'react';
import { getProductAlerts } from '../../services/utils';
import LazyImage from '../common/LazyImage';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useProductStore } from '../../store/useProductStore';
import WasteModal from './WasteModal';
import './ProductList.css';

export default function ProductList({ products, categories, isLoading, onEdit, onDelete, onToggleStatus }) {
  // 1. Obtenemos la configuración del negocio (Farmacia, Abarrotes, etc.)
  const features = useFeatureConfig();

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
        // Si hay texto, busca en la BD (trae el producto #124 aunque no esté cargado)
        searchProducts(searchTerm);
      } else if (searchTerm.trim().length === 0) {
        // Si borra el texto, recarga la lista paginada normal (los primeros 50)
        // Nota: Solo recargar si la lista actual parece ser un resultado de búsqueda (pocos items)
        // o simplemente forzar la recarga para restaurar el orden.
        loadInitialProducts();
      }
    }, 600); // Espera 600ms antes de buscar

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const filteredProducts = useMemo(() => {
    // Si estamos buscando, confiamos en lo que trajo el store (que ya viene filtrado por BD)
    // Pero mantenemos este filtro por si acaso quieres filtrar visualmente algo ya cargado.
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
          <span className="product-count">{filteredProducts.length} productos</span>
        </div>

        <div className="search-box">
          <i className="search-icon">🔍</i>
          <input
            type="text"
            placeholder={features.hasLabFields ? "Buscar: Nombre, SKU, Sustancia..." : "Buscar: Nombre, SKU, Código..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {filteredProducts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📦</div>
          <h3>No se encontraron productos</h3>
          <p>Intenta ajustar tu búsqueda o agrega nuevo inventario.</p>
        </div>
      ) : (
        <div className="product-grid">
          {filteredProducts.map(item => {
            const categoryName = categoryMap.get(item.categoryId) || 'General';
            const isActive = item.isActive !== false;

            // --- Lógica de Alertas ---
            const { isLowStock, isNearingExpiry, expiryDays } = getProductAlerts(item);
            const isTracked = item.trackStock || item.batchManagement?.enabled;

            // Unidad de medida: Solo mostramos 'kg/g' si el negocio soporta Granel (features.hasBulk)
            // Si es Farmacia (forceUnitMode), siempre será 'pza' o nada.
            const unitLabel = features.hasBulk
              ? (item.bulkData?.purchase?.unit || (item.saleType === 'bulk' ? 'kg' : 'pza'))
              : (item.saleType === 'bulk' ? 'kg' : 'pza');

            // --- Cálculos Financieros ---
            const margin = calculateMargin(item.price, item.cost);

            // --- Lógica de Visualización Condicional (Contexto del Rubro) ---
            // Solo mostrar ubicación si existe Y tiene dato (evita campo vacío en Farmacia)
            const showLocation = item.location && item.location.trim() !== '';

            // Solo mostrar Stock Min/Max si el rubro lo soporta (ej. Ferretería) Y el producto rastrea stock
            const showMinMax = features.hasMinMax && isTracked;

            // Solo mostrar datos médicos si el rubro es Farmacia
            const showPharmacyDetails = features.hasLabFields && (item.sustancia || item.laboratorio);

            // Solo mostrar código de barras si tiene uno
            const showBarcode = item.barcode && item.barcode.trim() !== '';

            // Estilos de borde
            let borderClass = '';
            if (features.hasExpiry && isNearingExpiry) borderClass = 'border-critical'; // Solo si rubro maneja caducidad
            else if (isLowStock) borderClass = 'border-warning';

            return (
              <div key={item.id} className={`product-card-complex ${borderClass} ${!isActive ? 'opacity-dim' : ''}`}>

                {/* 1. Cabecera */}
                <div className="complex-header">
                  <div className="img-area">
                    <LazyImage src={item.image} alt={item.name} />
                    <span className={`status-dot ${isActive ? 'status-active' : 'status-inactive'}`}></span>
                  </div>
                  <div className="title-area">
                    <div className="title-top">
                      <h4 title={item.name}>{item.name}</h4>
                    </div>
                    <div className="sub-meta">
                      <span className="category-badge">{categoryName}</span>
                      {/* SKU es útil en casi todos, pero vital en Ferretería/Ropa */}
                      {features.hasSKU && item.sku && <span className="sku-badge">SKU: {item.sku}</span>}
                    </div>
                  </div>
                  <div className="actions-area">
                    <button className="icon-btn" onClick={() => onEdit(item)} title="Editar">✏️</button>
                    <button className="icon-btn" onClick={() => onDelete(item)} title="Eliminar">🗑️</button>
                  </div>
                </div>

                {/* 2. Banner de Alertas (Contextual) */}
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

                {/* 3. Métricas Principales */}
                <div className="main-stats">
                  <div className="stat-block">
                    <span className="stat-label">Precio</span>
                    <span className="stat-value price">${item.price?.toFixed(2)}</span>
                  </div>
                  <div className="stat-block">
                    <span className="stat-label">Stock</span>
                    <span className={`stat-value stock ${item.stock <= 0 ? 'text-red' : ''}`}>
                      {isTracked ? item.stock : '∞'}
                      {/* Solo mostrar unidad pequeña si el negocio maneja granel/unidades mixtas */}
                      {features.hasBulk && <small>{unitLabel}</small>}
                    </span>
                  </div>
                  <div className="stat-block">
                    <span className="stat-label">Margen</span>
                    <span className={`stat-value ${margin > 30 ? 'text-success' : 'text-muted'}`}>
                      {margin ? `${margin}%` : '--'}
                    </span>
                  </div>
                </div>

                {/* 4. Grilla de Detalles (Solo lo que importa al Rubro) */}
                <div className="details-table">

                  {/* Fila A: Farmacia (Prioridad Alta) */}
                  {showPharmacyDetails && (
                    <div className="detail-row full-width pharmacy-row">
                      <div className="pharmacy-content">
                        {item.sustancia && <span className="ph-substance">💊 {item.sustancia}</span>}
                        {item.presentation && <span className="ph-pres">({item.presentation})</span>}
                        {item.laboratorio && <span className="ph-lab">{item.laboratorio}</span>}
                      </div>
                    </div>
                  )}

                  {/* Fila B: Logística / Ferretería */}
                  {showMinMax && (
                    <div className="detail-row">
                      <span className="dt-label">Mín/Máx:</span>
                      <span className="dt-value">{item.minStock || 0} / {item.maxStock || '∞'}</span>
                    </div>
                  )}

                  {showLocation && (
                    <div className="detail-row">
                      <span className="dt-label">Ubicación:</span>
                      <span className="dt-value">📍 {item.location}</span>
                    </div>
                  )}

                  {showBarcode && (
                    <div className="detail-row full-width">
                      <span className="dt-label">Código:</span>
                      <span className="dt-value monospace">{item.barcode}</span>
                    </div>
                  )}
                </div>

                {/* 5. Footer con Badges de Features Activos */}
                <div className="complex-footer">
                  <div className="feature-badges">
                    {/* Solo mostramos badges de features ACTIVOS en el config */}
                    {features.hasWholesale && item.wholesaleTiers?.length > 0 && (
                      <span className="feat-badge purple">Mayoreo</span>
                    )}
                    {features.hasRecipes && item.recipe?.length > 0 && (
                      <span className="feat-badge blue">Receta</span>
                    )}
                    {features.hasLots && item.batchManagement?.enabled && (
                      <span className="feat-badge orange">Lotes</span>
                    )}
                    {/* Tipo de producto es universal */}
                    {item.productType === 'ingredient' && (
                      <span className="feat-badge gray">Insumo</span>
                    )}
                  </div>

                  <div className="footer-actions">
                    <button
                      className={`mini-toggle ${isActive ? 'active' : ''}`}
                      onClick={() => onToggleStatus(item)}
                    >
                      {isActive ? 'ACTIVO' : 'OFF'}
                    </button>

                    {features.hasWaste && isActive && (
                      <button className="mini-btn-waste" onClick={() => handleOpenWaste(item)} title="Registrar Merma">
                        📉
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
            {isGlobalLoading ? 'Cargando...' : '⬇️ Ver más productos'}
          </button>
        </div>
      )}

      <WasteModal show={showWaste} onClose={handleCloseWaste} product={productForWaste} onConfirm={handleWasteConfirmed} />
    </div>
  );
}