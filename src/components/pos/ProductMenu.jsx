// src/components/pos/ProductMenu.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { getProductAlerts, showMessageModal } from '../../services/utils';
import LazyImage from '../common/LazyImage';
import ProductModifiersModal from './ProductModifiersModal';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import VariantSelectorModal from './VariantSelectorModal';
import { queryBatchesByProductIdAndActive } from '../../services/database'; // ✅ IMPORTAR
import './ProductMenu.css';

const playBeep = (freq = 1200, type = 'sine') => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return; 
    
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type; 
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch (e) {
    console.warn("Audio error", e);
  }
};

export default function ProductMenu({
  products,
  categories,
  selectedCategoryId,
  onSelectCategory,
  searchTerm,
  onSearchChange,
  onOpenScanner
}) {
  const addSmartItem = useOrderStore((state) => state.addSmartItem);
  const addItemToOrder = useOrderStore((state) => state.addItem);
  const features = useFeatureConfig();

  // --- ESTADOS PARA MODIFICADORES (Restaurantes) ---
  const [modModalOpen, setModModalOpen] = useState(false);
  const [selectedProductFormMod, setSelectedProductForMod] = useState(null);

  // --- ESTADOS PARA VARIANTES (Ropa/Zapatos) ---
  const [variantModalOpen, setVariantModalOpen] = useState(false);
  const [selectedProductForVariant, setSelectedProductForVariant] = useState(null);

  // ✅ NUEVO: Caché para saber qué productos SÍ tienen variantes reales
  const [productsWithVariants, setProductsWithVariants] = useState(new Set());
  const [isCheckingVariants, setIsCheckingVariants] = useState(false);

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

  // ✅ NUEVO: Verificar qué productos tienen variantes reales
  useEffect(() => {
    const checkVariants = async () => {
      if (!features.hasVariants) return;
      
      setIsCheckingVariants(true);
      const withVariants = new Set();

      // Solo verificamos productos que tienen batchManagement habilitado
      const candidates = visibleProducts.filter(p => p.batchManagement?.enabled);

      // Verificamos en paralelo (máximo 10 a la vez para no saturar)
      const chunks = [];
      for (let i = 0; i < candidates.length; i += 10) {
        chunks.push(candidates.slice(i, i + 10));
      }

      for (const chunk of chunks) {
        await Promise.all(
          chunk.map(async (product) => {
            try {
              const batches = await queryBatchesByProductIdAndActive(product.id, true);
              // Si tiene al menos 1 lote activo con stock, entonces SÍ tiene variantes
              if (batches && batches.length > 0) {
                withVariants.add(product.id);
              }
            } catch (error) {
              console.warn(`Error verificando variantes de ${product.id}:`, error);
            }
          })
        );
      }

      setProductsWithVariants(withVariants);
      setIsCheckingVariants(false);
    };

    checkVariants();
  }, [visibleProducts, features.hasVariants]);

  // --- HANDLER PRINCIPAL DE CLIC EN PRODUCTO (CORREGIDO) ---
  const handleProductClick = (product, isOutOfStock) => {
    // 0. Seguridad de Stock
    if (isOutOfStock) return;

    // ---------------------------------------------------------
    // CASO 1: BOUTIQUE / ROPA / ZAPATERÍA
    // ✅ CORRECCIÓN: Ahora verificamos si realmente tiene variantes
    // ---------------------------------------------------------
    if (features.hasVariants && 
        product.batchManagement?.enabled && 
        productsWithVariants.has(product.id)) { // ✅ VALIDACIÓN REAL
      
      setSelectedProductForVariant(product); 
      setVariantModalOpen(true);             
      return;
    }

    // ---------------------------------------------------------
    // CASO 2: RESTAURANTE
    // ---------------------------------------------------------
    if (features.hasModifiers && product.modifiers && product.modifiers.length > 0) {
      setSelectedProductForMod(product);     
      setModModalOpen(true);                 
      return;
    }

    // ---------------------------------------------------------
    // CASO 3: ABARROTES / FARMACIA / GENERAL (Venta Rápida)
    // ---------------------------------------------------------
    const cleanProduct = {
      ...product,
      wholesaleTiers: features.hasWholesale ? product.wholesaleTiers : []
    };

    addSmartItem(cleanProduct);
    playBeep(1000, 'sine');

    if (product.saleType === 'bulk') {
      showMessageModal(
        `⚖️ Producto a Granel: ${product.name}`,
        null, 
        { type: 'warning', duration: 3000 }
      );
    }
  };

  const handleConfirmVariants = (variantItem) => {
    addSmartItem(variantItem); 
    setVariantModalOpen(false);
    setSelectedProductForVariant(null);
  }

  const handleConfirmModifiers = (customizedProduct) => {
    addSmartItem(customizedProduct);
    setModModalOpen(false);
    setSelectedProductForMod(null);
  }

  const renderStockInfo = (item) => {
    const isTracking = item.trackStock || item.batchManagement?.enabled;

    if (!isTracking) return <div className="stock-info no-stock-label" style={{color:'#999'}}>---</div>;
    
    const unit = item.saleType === 'bulk' ? ` ${item.bulkData?.purchase?.unit || 'Granel'}` : ' U';
    
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
                <div className="empty-icon"></div>
                <p>No hay productos registrados.</p>
                <small>Ve a la sección <strong>Productos</strong> para crear tu inventario.</small>
              </div>
            ) : (
              <div className="menu-empty-state">
                <div className="empty-icon"></div>
                <p>No hay coincidencias.</p>
                <small>Intenta con otro nombre o escanea el código.</small>
              </div>
            )
          ) : (
            visibleProducts.map((item) => {
              const { isLowStock, isNearingExpiry, isOutOfStock } = getProductAlerts(item);
              const hasModifiers = features.hasModifiers && item.modifiers && item.modifiers.length > 0;
              
              // ✅ CORRECCIÓN CRÍTICA: Solo mostrar badge si tiene variantes REALES
              const hasVariants = features.hasVariants && 
                                  item.batchManagement?.enabled && 
                                  productsWithVariants.has(item.id);

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

                  {/* Badge de Modificadores (Restaurante) */}
                  {hasModifiers && !isOutOfStock && (
                    <div className="modifier-badge" style={{ position: 'absolute', top: '5px', left: '5px', background: 'var(--primary-color)', color: 'white', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', zIndex: 2 }}>
                      ✨ Extras
                    </div>
                  )}

                  {/* ✅ Badge de Variantes (SOLO si tiene variantes reales) */}
                  {hasVariants && !isOutOfStock && (
                    <div className="modifier-badge" style={{ position: 'absolute', top: '5px', left: '5px', background: 'var(--secondary-color)', color: 'white', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', zIndex: 2 }}>
                      🎨 Opciones
                    </div>
                  )}

                  {/* Badge de Receta Médica (Farmacia) */}
                  {features.hasLabFields && (item.requiresPrescription || (item.prescriptionType && item.prescriptionType !== 'otc')) && !isOutOfStock && (
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
