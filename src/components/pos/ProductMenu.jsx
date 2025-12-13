import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { getProductAlerts } from '../../services/utils';
import LazyImage from '../common/LazyImage';
import ProductModifiersModal from './ProductModifiersModal';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import VariantSelectorModal from './VariantSelectorModal';
import './ProductMenu.css';

export default function ProductMenu({
  products,
  categories,
  selectedCategoryId,
  onSelectCategory,
  searchTerm,
  onSearchChange,
  onOpenScanner
}) {
  const addItemToOrder = useOrderStore((state) => state.addItem);
  const features = useFeatureConfig();

  // --- ESTADOS PARA MODIFICADORES (Restaurantes) ---
  const [modModalOpen, setModModalOpen] = useState(false);
  const [selectedProductFormMod, setSelectedProductForMod] = useState(null);

  // --- ESTADOS PARA VARIANTES (Ropa/Zapatos) ---
  const [variantModalOpen, setVariantModalOpen] = useState(false);
  const [selectedProductForVariant, setSelectedProductForVariant] = useState(null);

  // --- INFINITE SCROLL ---
  const [displayLimit, setDisplayLimit] = useState(50);
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    setDisplayLimit(50);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [selectedCategoryId, searchTerm, products]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      setDisplayLimit(prev => {
        if (prev >= products.length) return prev;
        return prev + 50;
      });
    }
  };

  const visibleProducts = useMemo(() => {
    return products.slice(0, displayLimit);
  }, [products, displayLimit]);

  // --- HANDLERS ---
  const handleProductClick = (product, isOutOfStock) => {
    // 1. Lógica de Variantes (Prioridad alta)
    const useVariants = features.hasVariants && product.batchManagement?.enabled;

    if (useVariants) {
      setSelectedProductForVariant(product); 
      setVariantModalOpen(true);             
      return;
    }

    // 2. Lógica de Modificadores (Extras/Receta)
    if (features.hasModifiers && product.modifiers && product.modifiers.length > 0) {
      setSelectedProductForMod(product);     
      setModModalOpen(true);                 
      return;
    }

    const cleanProduct = {
      ...product,
      wholesaleTiers: features.hasWholesale ? product.wholesaleTiers : []
    };

    addItemToOrder(cleanProduct);
  };

  const handleConfirmVariants = (variantItem) => {
    addItemToOrder(variantItem);
    setVariantModalOpen(false);
    setSelectedProductForVariant(null);
  }

  const handleConfirmModifiers = (customizedProduct) => {
    addItemToOrder(customizedProduct);
    setModModalOpen(false);
    setSelectedProductForMod(null);
  }

  // --- CORRECCIÓN AQUÍ ---
  const renderStockInfo = (item) => {
    // Verificamos si tiene trackStock explícito O si tiene gestión de lotes habilitada (importados por CSV)
    const isTracking = item.trackStock || item.batchManagement?.enabled;

    if (!isTracking) return <div className="stock-info no-stock-label" style={{color:'#999'}}>---</div>;
    
    const unit = item.saleType === 'bulk' ? ` ${item.bulkData?.purchase?.unit || 'Granel'}` : ' U';
    
    // Mostramos stock si es mayor a 0, de lo contrario AGOTADO
    return item.stock > 0
      ? <div className="stock-info">Stock: {item.stock}{unit}</div>
      : <div className="stock-info out-of-stock-label">AGOTADO</div>;
  };

  return (
    <div className="pos-menu-container">
      <h3 className="subtitle">Menú de Productos</h3>

      <div id="category-filters" className="category-filters">
        <button
          className={`category-filter-btn ${selectedCategoryId === null ? 'active' : ''}`}
          onClick={() => onSelectCategory(null)}
        >
          Todos
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            className={`category-filter-btn ${selectedCategoryId === cat.id ? 'active' : ''}`}
            onClick={() => onSelectCategory(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      <div className="pos-controls">
        <input
          type="text"
          id="pos-product-search"
          className="form-input"
          placeholder="Buscar por Nombre, Código o SKU"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <button id="scan-barcode-btn" className="btn btn-scan" title="Escanear" onClick={onOpenScanner}>
          📷
        </button>
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{ height: '100%', flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '5px' }}
      >
        <div id="menu-items" className="menu-items-grid" aria-label="Elementos del menú">

          {visibleProducts.length === 0 ? (
            (products.length === 0 && !searchTerm && !selectedCategoryId) ? (
              <div className="menu-empty-state">
                <div className="empty-icon">📦</div>
                <p>No hay productos registrados.</p>
                <small>Ve a la sección <strong>Productos</strong> para crear tu inventario.</small>
              </div>
            ) : (
              <div className="menu-empty-state">
                <div className="empty-icon">🔍</div>
                <p>No hay coincidencias.</p>
                <small>Intenta con otro nombre o escanea el código.</small>
              </div>
            )
          ) : (
            visibleProducts.map((item) => {
              const { isLowStock, isNearingExpiry, isOutOfStock } = getProductAlerts(item);
              const hasModifiers = features.hasModifiers && item.modifiers && item.modifiers.length > 0;
              const hasVariants = features.hasVariants && item.batchManagement?.enabled;

              const itemClasses = ['menu-item', isLowStock ? 'low-stock-warning' : '', isNearingExpiry ? 'nearing-expiry-warning' : '', isOutOfStock ? 'out-of-stock' : ''].filter(Boolean).join(' ');

              return (
                <div
                  key={item.id}
                  className={itemClasses}
                  onClick={() => handleProductClick(item, isOutOfStock)}
                  role="button"
                  tabIndex={isOutOfStock ? -1 : 0}
                  aria-disabled={isOutOfStock}
                  aria-label={`${item.name} precio ${item.price}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleProductClick(item, isOutOfStock);
                    }
                  }}
                >
                  {isOutOfStock && <div className="stock-overlay">Agotado</div>}

                  {hasModifiers && !isOutOfStock && (
                    <div className="modifier-badge" style={{ position: 'absolute', top: '5px', left: '5px', background: 'var(--primary-color)', color: 'white', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', zIndex: 2 }}>
                      ✨ Extras
                    </div>
                  )}

                  {hasVariants && !isOutOfStock && (
                    <div className="modifier-badge" style={{ position: 'absolute', top: '5px', left: '5px', background: 'var(--secondary-color)', color: 'white', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', zIndex: 2 }}>
                      🎨 Opciones
                    </div>
                  )}

                  {features.hasLabFields && item.requiresPrescription && !isOutOfStock && (
                    <div className="prescription-badge" style={{
                      position: 'absolute',
                      top: (hasModifiers || hasVariants) ? '30px' : '5px',
                      left: '5px',
                      background: '#FF3B5C',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      fontWeight: 'bold',
                      zIndex: 2,
                      boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }}>
                      Receta
                    </div>
                  )}

                  <LazyImage className="menu-item-image" src={item.image} alt={item.name} />
                  <h3 className="menu-item-name">{item.name}</h3>
                  <p className="menu-item-price">
                    ${item.price.toFixed(2)}
                    {item.saleType === 'bulk' && <span className="menu-item-unit"> / {item.bulkData?.purchase?.unit || 'kg'}</span>}
                  </p>
                  {renderStockInfo(item)}
                </div>
              );
            })
          )}

          {visibleProducts.length < products.length && visibleProducts.length > 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '20px', color: '#999' }}>
              Cargando más productos...
            </div>
          )}
        </div>
      </div>

      <ProductModifiersModal
        show={modModalOpen}
        onClose={() => { setModModalOpen(false); setSelectedProductForMod(null); }}
        product={selectedProductFormMod}
        onConfirm={handleConfirmModifiers}
      />

      <VariantSelectorModal
        show={variantModalOpen}
        onClose={() => { setVariantModalOpen(false); setSelectedProductForVariant(null); }}
        product={selectedProductForVariant}
        onConfirm={handleConfirmVariants}
      />
    </div>
  );
}