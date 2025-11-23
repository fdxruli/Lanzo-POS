// src/components/pos/ProductMenu.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { getProductAlerts } from '../../services/utils';
import LazyImage from '../common/LazyImage';
import ProductModifiersModal from './ProductModifiersModal';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
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

  const [modModalOpen, setModModalOpen] = useState(false);
  const [selectedProductFormMod, setSelectedProductForMod] = useState(null);

  // --- OPTIMIZACIÓN DE RENDERIZADO (INFINITE SCROLL) ---
  // Empezamos mostrando solo 50 productos para carga instantánea
  const [displayLimit, setDisplayLimit] = useState(50);
  const scrollContainerRef = useRef(null);

  // 1. Resetear el límite cuando cambian los filtros (búsqueda o categoría)
  useEffect(() => {
    setDisplayLimit(50);
    // Opcional: Scrollear arriba al cambiar filtros
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [selectedCategoryId, searchTerm, products]);

  // 2. Detectar Scroll para cargar más items suavemente
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;

    // Si el usuario está cerca del final (a 300px), cargamos más
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      // Usamos un callback para asegurar que leemos el valor actual
      setDisplayLimit(prev => {
        // Si ya mostramos todos, no hacemos nada
        if (prev >= products.length) return prev;
        return prev + 50; // Cargar lote siguiente
      });
    }
  };

  // 3. Filtrar visualmente solo los necesarios (Slice)
  // Esto es super rápido porque solo renderizamos 'displayLimit' elementos en el DOM
  const visibleProducts = useMemo(() => {
    return products.slice(0, displayLimit);
  }, [products, displayLimit]);

  // --- HANDLERS EXISTENTES ---
  const handleProductClick = (product, isOutOfStock) => {
    if (isOutOfStock) return;

    if (features.hasModifiers && product.modifiers && product.modifiers.length > 0) {
      setSelectedProductForMod(product);
      setModModalOpen(true);
    } else {
      addItemToOrder(product);
    }
  };

  const handleConfirmModifiers = (customizedProduct) => {
    addItemToOrder(customizedProduct);
    setModModalOpen(false);
    setSelectedProductForMod(null);
  }

  const renderStockInfo = (item) => {
    if (!item.trackStock) {
      return <div className="stock-info no-stock-label">Sin seguimiento</div>;
    }
    const unit = item.saleType === 'bulk' ? ` ${item.bulkData?.purchase?.unit || 'Granel'}` : ' U';

    if (item.stock > 0) {
      return <div className="stock-info">Stock: {item.stock}{unit}</div>;
    } else {
      return <div className="stock-info out-of-stock-label">AGOTADO</div>;
    }
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
          placeholder="Buscar producto..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <button
          id="scan-barcode-btn"
          className="btn btn-scan"
          title="Escanear"
          onClick={onOpenScanner}
        >
          📷
        </button>
      </div>

      {/* 4. CONTENEDOR SCROLLABLE 
          Definimos una altura fija (o dinámica con calc) y overflow-y auto.
          Esto activa el scroll dentro de la tarjeta en lugar de scrollear toda la página.
      */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          height: 'calc(100vh - 350px)', // Altura dinámica: Pantalla menos cabeceras
          minHeight: '400px',            // Altura mínima de seguridad
          overflowY: 'auto',
          paddingRight: '5px'            // Espacio para el scrollbar
        }}
      >
        <div id="menu-items" className="menu-items-grid" aria-label="Elementos del menú">
          {visibleProducts.length === 0 ? (
            <p className="empty-message">No hay productos que coincidan.</p>
          ) : (
            visibleProducts.map((item) => {
              const { isLowStock, isNearingExpiry, isOutOfStock } = getProductAlerts(item);

              // 4. VALIDACIÓN VISUAL:
              // Solo mostramos que tiene modificadores si el negocio lo permite
              const hasModifiers = features.hasModifiers && item.modifiers && item.modifiers.length > 0;

              const itemClasses = ['menu-item', isLowStock ? 'low-stock-warning' : '', isNearingExpiry ? 'nearing-expiry-warning' : '', isOutOfStock ? 'out-of-stock' : ''].filter(Boolean).join(' ');

              return (
                <div key={item.id} className={itemClasses} onClick={() => handleProductClick(item, isOutOfStock)}>
                  {isOutOfStock && <div className="stock-overlay">Agotado</div>}

                  {/* Solo mostramos la etiqueta si features.hasModifiers es true */}
                  {hasModifiers && !isOutOfStock && (
                    <div className="modifier-badge" style={{ position: 'absolute', top: '5px', left: '5px', background: 'var(--primary-color)', color: 'white', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', zIndex: 2 }}>
                      ✨ Opciones
                    </div>
                  )}

                  {item.requiresPrescription && !isOutOfStock && (
                    <div className="prescription-badge" style={{
                      position: 'absolute',
                      top: hasModifiers ? '30px' : '5px', // Si ya hay badge de opciones, lo bajamos
                      left: '5px',
                      background: '#FF3B5C', // Rojo alerta
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      fontWeight: 'bold',
                      zIndex: 2,
                      boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }}>
                      ⚕️ Receta
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
          {/* Spinner invisible al final para dar espacio */}
          {visibleProducts.length < products.length && (
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
    </div>
  );
}