// src/components/pos/ProductMenu.jsx
import React from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import './ProductMenu.css'; // Importamos los estilos

// Constantes para las alertas, traídas de tu lógica original
const LOW_STOCK_THRESHOLD = 5;
const EXPIRY_DAYS_THRESHOLD = 7;
// Calculamos 'hoy' una sola vez para eficiencia
const now = new Date();
now.setHours(0, 0, 0, 0);

/**
 * Este es el componente "tonto" (de vista).
 * Recibe toda la información y las funciones desde PosPage.jsx.
 */
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

  const handleProductClick = (product, isOutOfStock) => {
    // No hacer nada si está agotado
    if (isOutOfStock) return;
    addItemToOrder(product);
  };

  /**
   * Helper para renderizar la información de stock
   * (Esta es la lógica que faltaba de tu 'renderMenu' en app.js)
   */
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

      {/* Renderizado de Filtros de Categoría */}
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

      {/* Controles de Búsqueda y Escáner */}
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

      {/* Renderizado de la Cuadrícula de Productos */}
      <div id="menu-items" className="menu-items-grid" aria-label="Elementos del menú">
        {products.length === 0 ? (
          <p className="empty-message">No hay productos que coincidan.</p>
        ) : (
          products.map((item) => {
            // Lógica de alertas de stock y caducidad (de app.js)
            let isLowStock = false;
            let isNearingExpiry = false;
            const isOutOfStock = item.trackStock && item.stock <= 0;

            if (item.trackStock && item.stock > 0 && item.stock < LOW_STOCK_THRESHOLD) {
              isLowStock = true;
            }

            if (item.expiryDate) {
              const expiryDate = new Date(item.expiryDate);
              const diffTime = expiryDate - now;
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              if (diffDays >= 0 && diffDays <= EXPIRY_DAYS_THRESHOLD) {
                isNearingExpiry = true;
              }
            }
            
            // Construye las clases CSS dinámicamente
            const itemClasses = [
              'menu-item',
              isLowStock ? 'low-stock-warning' : '',
              isNearingExpiry ? 'nearing-expiry-warning' : '',
              isOutOfStock ? 'out-of-stock' : ''
            ].filter(Boolean).join(' '); // .filter(Boolean) elimina strings vacíos

            return (
              <div
                key={item.id}
                className={itemClasses}
                onClick={() => handleProductClick(item, isOutOfStock)}
              >
                {isOutOfStock && (
                  <div className="stock-overlay">Agotado</div>
                )}
                <img
                  className="menu-item-image"
                  src={item.image || 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir'}
                  alt={item.name}
                  onError={(e) => e.target.src = 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir'}
                />
                <h3 className="menu-item-name">{item.name}</h3>
                <p className="menu-item-price">
                  ${item.price.toFixed(2)}
                  {item.saleType === 'bulk' && (
                    <span className="menu-item-unit"> / {item.bulkData?.purchase?.unit || 'kg'}</span>
                  )}
                </p>
                {renderStockInfo(item)}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}