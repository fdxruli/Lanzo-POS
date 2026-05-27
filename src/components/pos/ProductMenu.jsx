import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { showMessageModal } from '../../services/utils';
import ProductCard from './ProductCard';
import ProductModifiersModal from './ProductModifiersModal';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import VariantSelectorModal from './VariantSelectorModal';
import './ProductMenu.css';
import { ScanLine } from 'lucide-react';

let globalAudioCtx = null;

const playBeep = (freq = 1200, type = 'sine') => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    // Solo lo creamos la primera vez
    if (!globalAudioCtx) {
      globalAudioCtx = new AudioContext();
    }

    // Los navegadores móviles suspenden el audio, hay que despertarlo
    if (globalAudioCtx.state === 'suspended') {
      globalAudioCtx.resume();
    }

    const osc = globalAudioCtx.createOscillator();
    const gain = globalAudioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, globalAudioCtx.currentTime);

    gain.gain.setValueAtTime(0.1, globalAudioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.00001, globalAudioCtx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(globalAudioCtx.destination);

    osc.start();
    osc.stop(globalAudioCtx.currentTime + 0.1);
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
  onOpenScanner,
  showOutofStockCategory
}) {
  const addSmartItem = useOrderStore((state) => state.addSmartItem);
  const features = useFeatureConfig();

  // --- ESTADOS PARA MODIFICADORES (Restaurantes) ---
  const [modModalOpen, setModModalOpen] = useState(false);
  const [selectedProductForMod, setSelectedProductForMod] = useState(null);

  // --- ESTADOS PARA VARIANTES (Ropa/Zapatos) ---
  const [variantModalOpen, setVariantModalOpen] = useState(false);
  const [selectedProductForVariant, setSelectedProductForVariant] = useState(null);

  // --- INFINITE SCROLL ---
  const [displayLimit, setDisplayLimit] = useState(50);
  const scrollContainerRef = useRef(null);

  // --- EFECTO: Resetear displayLimit cuando cambian filtros de búsqueda ---
  // Reemplaza el anti-patrón de mutación de estado durante renderizado
  useEffect(() => {
    setDisplayLimit(50);
  }, [selectedCategoryId, searchTerm, products]);

  // --- EFECTO: Resetear scroll al cambiar filtros ---
  useEffect(() => {
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

  // --- HANDLER PRINCIPAL DE CLIC EN PRODUCTO (ADAPTABLE POR RUBRO) ---
  // MEMOIZADO: Evita re-renders de ProductCard cuando se escribe en el buscador
  const handleCardClick = useCallback((product) => {
    // ---------------------------------------------------------
    // CASO 1: BOUTIQUE / ROPA / ZAPATERÍA
    // Si el negocio maneja variantes (features.hasVariants es true) 
    // Y el producto tiene gestión de lotes/tallas activada.
    // ---------------------------------------------------------
    if (features.hasVariants && product.batchManagement?.enabled) {
      setSelectedProductForVariant(product);
      setVariantModalOpen(true);
      return; // Detenemos aquí, el usuario debe elegir la talla en el modal
    }

    // ---------------------------------------------------------
    // CASO 2: RESTAURANTE
    // Si el negocio maneja modificadores (features.hasModifiers es true)
    // Y el producto tiene ingredientes extra configurados.
    // ---------------------------------------------------------
    if (features.hasModifiers && product.modifiers && product.modifiers.length > 0) {
      setSelectedProductForMod(product);
      setModModalOpen(true);
      return; // Detenemos aquí, el usuario elige los extras
    }

    // ---------------------------------------------------------
    // CASO 3: ABARROTES / FARMACIA / GENERAL (Venta Rápida)
    // Aquí caen todos los demás. Incluyendo Farmacia (la receta se pide al cobrar, no al agregar).
    // ---------------------------------------------------------

    // Preparamos el producto (limpieza de datos)
    const cleanProduct = {
      ...product,
      wholesaleTiers: features.hasWholesale ? product.wholesaleTiers : []
    };

    // ACCIÓN INTELIGENTE (Smart Add)
    // Busca el lote más antiguo (FIFO) automáticamente y agrega.
    addSmartItem(cleanProduct);

    // FEEDBACK SONORO (Éxito)
    playBeep(1000, 'sine');

    // FEEDBACK VISUAL (Solo para Granel)
    // Si vendes jamón, queso, clavos o cualquier cosa por peso/medida.
    if (product.saleType === 'bulk') {
      showMessageModal(
        `⚖️ Producto a Granel: ${product.name}`,
        null,
        { type: 'warning', duration: 3000 }
      );
    }
  }, [features.hasModifiers, features.hasVariants, features.hasWholesale, addSmartItem]);

  const handleConfirmVariants = useCallback((variantItem) => {
    // Como ya viene el lote seleccionado del modal, addSmartItem 
    // detectará que ya trae batchId y lo pasará directo. Es seguro.
    addSmartItem(variantItem);
    setVariantModalOpen(false);
    setSelectedProductForVariant(null);
  }, [addSmartItem]);

  const handleConfirmModifiers = useCallback((customizedProduct) => {
    addSmartItem(customizedProduct);
    setModModalOpen(false);
    setSelectedProductForMod(null);
  }, [addSmartItem]);

  // --- HANDLERS DE CIERRE DE MODALES ---
  const handleCloseVariantModal = useCallback(() => {
    setVariantModalOpen(false);
    setSelectedProductForVariant(null);
  }, []);

  const handleCloseModModal = useCallback(() => {
    setModModalOpen(false);
    setSelectedProductForMod(null);
  }, []);

  // --- HANDLERS DE CATEGORÍAS Y BÚSQUEDA ---
  const handleCategoryClick = useCallback((categoryId) => {
    onSelectCategory?.(categoryId);
  }, [onSelectCategory]);

  const handleSearchChange = useCallback((e) => {
    onSearchChange?.(e.target.value);
  }, [onSearchChange]);

  const handleScannerClick = useCallback(() => {
    onOpenScanner?.();
  }, [onOpenScanner]);

  return (
    <div className="pos-menu-container">
      <h3 className="subtitle">Menú de Productos</h3>

      <div id="category-filters" className="category-filters">
        <button
          className={`category-filter-btn ${selectedCategoryId === null ? 'active' : ''}`}
          onClick={() => handleCategoryClick(null)}
        >
          Todos
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            className={`category-filter-btn ${selectedCategoryId === cat.id ? 'active' : ''}`}
            onClick={() => handleCategoryClick(cat.id)}
          >
            {cat.name}
          </button>
        ))}
        {showOutofStockCategory && (
          <button
            className={`category-filter-btn ${selectedCategoryId === 'CAT_DYNAMIC_AGOTADOS' ? 'active' : ''}`}
            onClick={() => handleCategoryClick('CAT_DYNAMIC_AGOTADOS')}
            style={{
              border: '1px solid var(--error-color, #ff4444)',
              color: selectedCategoryId === 'CAT_DYNAMIC_AGOTADOS' ? 'white' : 'var(--error-color, #ff4444)',
              background: selectedCategoryId === 'CAT_DYNAMIC_AGOTADOS' ? 'var(--error-color, #ff4444)' : 'transparent'
            }}
          >
            Agotados
          </button>
        )}
      </div>

      <div className="pos-controls">
        <input
          type="text"
          id="pos-product-search"
          className="form-input"
          placeholder="Buscar por Nombre, Código o SKU"
          value={searchTerm}
          onChange={handleSearchChange}
        />
        <button 
          id="scan-barcode-btn" 
          className="btn btn-scan" 
          title="Escanear" 
          onClick={handleScannerClick}
        >
          <ScanLine size={20} />
        </button>
      </div>

      <div
        className="pos-menu-scroll"
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{ height: '100%', flex: 1, minHeight: 0, overflowY: 'auto', boxSizing: 'border-box' }}
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
            visibleProducts.map((item) => (
              <ProductCard
                key={item.id}
                product={item}
                features={features}
                onCardClick={handleCardClick}
              />
            ))
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
        onClose={handleCloseModModal}
        product={selectedProductForMod}
        onConfirm={handleConfirmModifiers}
      />

      <VariantSelectorModal
        show={variantModalOpen}
        onClose={handleCloseVariantModal}
        product={selectedProductForVariant}
        onConfirm={handleConfirmVariants}
      />
    </div>
  );
}
