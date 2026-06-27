import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useAppStore } from '../../store/useAppStore';
import { showMessageModal } from '../../services/utils';
import { isCloudSalesInventoryEnabled } from '../../services/sync/syncConstants';
import {
  isProductReadyForCloudSale,
  resolveProductCloudSyncBadge
} from '../../services/products/productConstants';
import ProductCard from './ProductCard';
import ProductModifiersModal from './ProductModifiersModal';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import VariantSelectorModal from './VariantSelectorModal';
import { useInventoryMovement } from '../../hooks/useInventoryMovement';
import { getAvailableVariantBatches } from './variantUtils';
import './ProductMenu.css';
import { PackageSearch, ScanLine, Search } from 'lucide-react';

let globalAudioCtx = null;

const PRODUCT_UNSYNCED_SALE_MESSAGE = [
  'Producto no sincronizado.',
  'Este producto existe solo en este dispositivo.',
  'Sincroniza el catá' + 'logo antes de ' + 'vend' + 'erlo en modo cl' + 'oud.'
].join(' ');

const PRODUCT_CARD_SHELL_STYLE = {
  position: 'relative',
  minWidth: 0
};

const PRODUCT_SYNC_BADGE_BASE_STYLE = {
  position: 'absolute',
  top: 6,
  left: 6,
  zIndex: 4,
  display: 'inline-flex',
  maxWidth: 'calc(100% - 12px)',
  minHeight: 20,
  alignItems: 'center',
  padding: '3px 7px',
  overflow: 'hidden',
  border: '1px solid currentColor',
  borderRadius: 999,
  background: 'var(--card-background-color)',
  boxShadow: '0 4px 10px rgba(15, 23, 42, 0.12)',
  fontSize: '0.62rem',
  fontWeight: 800,
  lineHeight: 1,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  pointerEvents: 'none'
};

const PRODUCT_SYNC_BADGE_COLOR = {
  synced: '#047857',
  pending: '#a15c05',
  unsynced: '#b45309',
  error: '#b91c1c'
};

const buildProductSyncBadgeStyle = (status) => ({
  ...PRODUCT_SYNC_BADGE_BASE_STYLE,
  color: PRODUCT_SYNC_BADGE_COLOR[status] || PRODUCT_SYNC_BADGE_COLOR.unsynced
});

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
    console.warn('Audio error', e);
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
  const addSmartItem = useActiveOrders((state) => state.addSmartItem);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const features = useFeatureConfig();

  // --- ESTADOS PARA MODIFICADORES (Restaurantes) ---
  const [modModalOpen, setModModalOpen] = useState(false);
  const [selectedProductForMod, setSelectedProductForMod] = useState(null);

  // --- ESTADOS PARA VARIANTES (Ropa/Zapatos) ---
  const [variantModalOpen, setVariantModalOpen] = useState(false);
  const [selectedProductForVariant, setSelectedProductForVariant] = useState(null);
  // Lotes pre-cargados: se pasan al modal para evitar su spinner interno
  const [preloadedBatches, setPreloadedBatches] = useState(null);
  // ID del producto cuya carga está en curso (para feedback visual en la card)
  const [loadingVariantId, setLoadingVariantId] = useState(null);
  const [variantStatusByProductId, setVariantStatusByProductId] = useState({});

  const { loadBatchesForProduct } = useInventoryMovement();

  // --- INFINITE SCROLL ---
  const [displayLimit, setDisplayLimit] = useState(50);
  const scrollContainerRef = useRef(null);

  const cloudSalesInventoryEnabled = useMemo(
    () => isCloudSalesInventoryEnabled(licenseDetails),
    [licenseDetails]
  );

  const buildProductSyncBadge = useCallback((product) => {
    if (!cloudSalesInventoryEnabled) return null;
    return resolveProductCloudSyncBadge(product);
  }, [cloudSalesInventoryEnabled]);

  const guardCloudSyncedProduct = useCallback((product) => {
    if (!cloudSalesInventoryEnabled || isProductReadyForCloudSale(product)) return true;

    showMessageModal(
      PRODUCT_UNSYNCED_SALE_MESSAGE,
      null,
      { type: 'warning', duration: 4500 }
    );
    return false;
  }, [cloudSalesInventoryEnabled]);

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

  useEffect(() => {
    let cancelled = false;

    if (!features.hasVariants) {
      setVariantStatusByProductId({});
      return () => {
        cancelled = true;
      };
    }

    const productsWithBatchManagement = visibleProducts.filter(
      (product) => product?.id && product?.batchManagement?.enabled === true
    );

    const resolveVariantStatuses = async () => {
      const entries = await Promise.all(
        productsWithBatchManagement.map(async (product) => {
          try {
            const batches = await loadBatchesForProduct(product.id);
            return [product.id, getAvailableVariantBatches(batches).length > 0];
          } catch (error) {
            console.error('[ProductMenu] Error resolviendo variantes:', error);
            return [product.id, false];
          }
        })
      );

      if (!cancelled) {
        setVariantStatusByProductId(Object.fromEntries(entries));
      }
    };

    resolveVariantStatuses();

    return () => {
      cancelled = true;
    };
  }, [features.hasVariants, loadBatchesForProduct, visibleProducts]);

  // --- HANDLER PRINCIPAL DE CLIC EN PRODUCTO (ADAPTABLE POR RUBRO) ---
  // MEMOIZADO: Evita re-renders de ProductCard cuando se escribe en el buscador
  const handleCardClick = useCallback(async (product) => {
    if (!guardCloudSyncedProduct(product)) return;

    // ---------------------------------------------------------
    // CASO 1: BOUTIQUE / ROPA / ZAPATERÍA
    // Si el negocio maneja variantes (features.hasVariants es true)
    // Y el producto tiene gestión de lotes/tallas activada.
    // ---------------------------------------------------------
    if (features.hasVariants && product.batchManagement?.enabled) {
      // Pre-cargar lotes ANTES de abrir el modal.
      // - Si el producto no tiene lotes reales (batchManagement habilitado pero sin
      //   lotes creados), se agrega directamente sin abrir el modal innecesariamente.
      // - Si tiene lotes reales, se pasan pre-cargados al modal eliminando su spinner.
      setLoadingVariantId(product.id);
      try {
        const allBatches = await loadBatchesForProduct(product.id);
        const activeBatches = getAvailableVariantBatches(allBatches);
        setVariantStatusByProductId((current) => ({
          ...current,
          [product.id]: activeBatches.length > 0
        }));

        if (activeBatches.length === 0) {
          // Sin variantes reales → agregar el producto base directamente
          const cleanProduct = {
            ...product,
            wholesaleTiers: features.hasWholesale ? product.wholesaleTiers : []
          };
          addSmartItem(cleanProduct);
          playBeep(1000, 'sine');
        } else {
          // Con variantes reales → abrir modal con lotes ya cargados (sin spinner)
          setSelectedProductForVariant(product);
          setPreloadedBatches(activeBatches);
          setVariantModalOpen(true);
        }
      } catch (err) {
        console.error('[ProductMenu] Error pre-cargando variantes:', err);
        // En caso de error de BD, abrir el modal y dejar que él haga su propia carga
        setSelectedProductForVariant(product);
        setPreloadedBatches(null);
        setVariantModalOpen(true);
      } finally {
        setLoadingVariantId(null);
      }
      return;
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
  }, [features.hasModifiers, features.hasVariants, features.hasWholesale, addSmartItem, loadBatchesForProduct, guardCloudSyncedProduct]);

  const handleConfirmVariants = useCallback((variantItem) => {
    if (!guardCloudSyncedProduct(selectedProductForVariant || variantItem)) return;

    // Como ya viene el lote seleccionado del modal, addSmartItem
    // detectará que ya trae batchId y lo pasará directo. Es seguro.
    addSmartItem(variantItem);
    setVariantModalOpen(false);
    setSelectedProductForVariant(null);
    setPreloadedBatches(null);
  }, [addSmartItem, guardCloudSyncedProduct, selectedProductForVariant]);

  const handleConfirmModifiers = useCallback((customizedProduct) => {
    if (!guardCloudSyncedProduct(selectedProductForMod || customizedProduct)) return;

    addSmartItem(customizedProduct);
    setModModalOpen(false);
    setSelectedProductForMod(null);
  }, [addSmartItem, guardCloudSyncedProduct, selectedProductForMod]);

  // --- HANDLERS DE CIERRE DE MODALES ---
  const handleCloseVariantModal = useCallback(() => {
    setVariantModalOpen(false);
    setSelectedProductForVariant(null);
    setPreloadedBatches(null);
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
      <div className="pos-menu-utility">
        <div className="pos-menu-heading">
          <div>
            <h2>Productos</h2>
            <p>Selecciona un producto para agregarlo al pedido</p>
          </div>
          <span className="pos-results-count" aria-live="polite">
            <span aria-hidden="true" />
            {products.length} {products.length === 1 ? 'resultado' : 'resultados'}
          </span>
        </div>

        <div className="pos-controls">
          <label className="pos-search-field" htmlFor="pos-product-search">
            <Search size={20} aria-hidden="true" />
            <input
              type="search"
              id="pos-product-search"
              placeholder="Buscar por nombre, código o SKU"
              value={searchTerm}
              onChange={handleSearchChange}
              autoComplete="off"
              aria-label="Buscar productos por nombre, código o SKU"
            />
            <span className="pos-search-shortcut" aria-hidden="true">/ Buscar</span>
          </label>
          <button
            type="button"
            id="scan-barcode-btn"
            className="btn-scan"
            title="Abrir lector de código de barras"
            aria-label="Abrir lector de código de barras"
            onClick={handleScannerClick}
          >
            <ScanLine size={21} aria-hidden="true" />
            <span>Código de barras</span>
          </button>
        </div>

        <div id="category-filters" className="category-filters" aria-label="Categorías de productos">
          <button
            type="button"
            className={`category-filter-btn ${selectedCategoryId === null ? 'active' : ''}`}
            onClick={() => handleCategoryClick(null)}
          >
            Todos
          </button>
          {categories.map(cat => (
            <button
              type="button"
              key={cat.id}
              className={`category-filter-btn ${selectedCategoryId === cat.id ? 'active' : ''}`}
              onClick={() => handleCategoryClick(cat.id)}
            >
              {cat.name}
            </button>
          ))}
          {showOutofStockCategory && (
            <button
              type="button"
              className={`category-filter-btn category-filter-btn--danger ${selectedCategoryId === 'CAT_DYNAMIC_AGOTADOS' ? 'active' : ''}`}
              onClick={() => handleCategoryClick('CAT_DYNAMIC_AGOTADOS')}
            >
              Agotados
            </button>
          )}
        </div>
      </div>

      <div
        className="pos-menu-scroll"
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        <div id="menu-items" className="menu-items-grid" aria-label="Productos disponibles">

          {visibleProducts.length === 0 ? (
            (products.length === 0 && !searchTerm && !selectedCategoryId) ? (
              <div className="menu-empty-state">
                <PackageSearch size={38} aria-hidden="true" />
                <p>No hay productos registrados.</p>
                <small>Ve a la sección <strong>Productos</strong> para crear tu inventario.</small>
              </div>
            ) : (
              <div className="menu-empty-state">
                <PackageSearch size={38} aria-hidden="true" />
                <p>No hay coincidencias.</p>
                <small>Intenta con otro nombre o escanea el código.</small>
              </div>
            )
          ) : (
            visibleProducts.map((item) => {
              const syncBadge = buildProductSyncBadge(item);
              return (
                <div className="pos-product-card-shell" style={PRODUCT_CARD_SHELL_STYLE} key={item.id}>
                  {syncBadge && (
                    <span
                      className={`pos-product-sync-badge pos-product-sync-badge--${syncBadge.status}`}
                      style={buildProductSyncBadgeStyle(syncBadge.status)}
                      title={syncBadge.title}
                      aria-label={syncBadge.title}
                    >
                      {syncBadge.label}
                    </span>
                  )}
                  <ProductCard
                    product={item}
                    features={features}
                    onCardClick={handleCardClick}
                    isLoadingVariant={loadingVariantId === item.id}
                    hasAvailableVariants={variantStatusByProductId[item.id] === true}
                  />
                </div>
              );
            })
          )}

          {visibleProducts.length < products.length && visibleProducts.length > 0 && (
            <div className="pos-products-loading" role="status">
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
        preloadedBatches={preloadedBatches}
      />
    </div>
  );
}
