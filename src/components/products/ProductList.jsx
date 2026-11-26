import { useState, useMemo, useEffect, useRef } from 'react';
import { getProductAlerts } from '../../services/utils';
import LazyImage from '../common/LazyImage';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useInventoryCatalogStore } from '../../store/useInventoryCatalogStore';
import { useCatalogReconnect } from '../../hooks/useCatalogReconnect';
import { queryBatchesByProductIdsAndActive, searchProductsInDB } from '../../services/database';
import {
  INVENTORY_UNCATEGORIZED_FILTER,
  isInventoryCatalogEligible,
  isInventoryUncategorizedFilter
} from '../../services/products/productCatalogQueryService';
import { getAvailableStock, getCommittedStock } from '../../services/db/utils';
import { extractCalendarDate } from '../../utils/dateUtils';
import { formatShelfLife, getProductBatchSummaryMap, getProductCardExpiryState } from '../../services/products/productBatchSummary';
import { resolveProductSaleUnit } from '../../utils/productUnitConfiguration';
import WasteModal from './WasteModal';
import InventoryEntryModal from './InventoryEntryModal';
import { getPharmacyClassification } from '../../utils/pharmacyClassification';
import { canAddInventoryEntry } from '../../services/inventory/inventoryEntryEligibility';
import ProductCloudSyncIndicators from './ProductCloudSyncIndicators';
import IndividualProductRecoveryDialog from './IndividualProductRecoveryDialog';
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
  ),
  Layers: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
  ),
  Price: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
  )
};

const formatDate = (value) => {
  const calendarDate = extractCalendarDate(value);
  if (!calendarDate) return null;
  const [year, month, day] = calendarDate.split('-');
  return `${day}/${month}/${year}`;
};

const CATEGORY_OPTION_PREFIX = 'category:';
const UNCATEGORIZED_OPTION_VALUE = 'inventory:uncategorized';
const PRODUCT_SEARCH_TIMEOUT_MS = 15000;

export default function ProductList({ products, categories = [], isLoading, onEdit, onDelete, onToggleStatus, onManageBatches, onOpenDailyPrice, canManageProducts = true, canManageInventory = true, canDeleteProducts = true, reviewOnly = false, historicalCostReview = false }) {
  const features = useFeatureConfig();

  // Acciones del Store (solo paginacion/cache)
  const fetchPage = useInventoryCatalogStore((state) => state.fetchPage);
  const refreshData = useInventoryCatalogStore((state) => state.loadInitialProducts);
  const hasMore = useInventoryCatalogStore((state) => state.hasMore);
  const isGlobalLoading = useInventoryCatalogStore((state) => state.isLoading);
  const loadFirstPage = useInventoryCatalogStore((state) => state.loadFirstPage);
  const filters = useInventoryCatalogStore((state) => state.filters);
  const { reconnect, catalogLoading, catalogUnavailable } = useCatalogReconnect(loadFirstPage, filters);
  const catalogBlocked = catalogLoading || catalogUnavailable;

  const [searchTerm, setSearchTerm] = useState('');
  const [appliedSearchTerm, setAppliedSearchTerm] = useState('');
  const normalizedSearchTerm = searchTerm.trim();
  const [searchResults, setSearchResults] = useState([]);
  const [searchConnection, setSearchConnection] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearchError, setHasSearchError] = useState(false);
  const [searchExecution, setSearchExecution] = useState(0);
  const searchRequestId = useRef(0);
  const searchTimeout = useRef(null);
  const searchInput = useRef(null);
  const [showWaste, setShowWaste] = useState(false);
  const [productForWaste, setProductForWaste] = useState(null);
  const [productForInventoryEntry, setProductForInventoryEntry] = useState(null);
  const [productForRecovery, setProductForRecovery] = useState(null);
  const [batchSummaries, setBatchSummaries] = useState(() => new Map());

  // LEER DE LA BD CENTRAL: Estado para el filtro desplegable de activos/inactivos
  const statusFilter = useInventoryCatalogStore((state) => state.filters.status || 'active');
  const categoryFilter = useInventoryCatalogStore((state) => state.filters.categoryId ?? null);
  const setFilters = useInventoryCatalogStore((state) => state.setFilters);

  const categoryMap = useMemo(() => {
    return new Map(categories.map(cat => [String(cat.id), cat.name]));
  }, [categories]);

  const categoryFilterValue = categoryFilter === null
    ? ''
    : (isInventoryUncategorizedFilter(categoryFilter)
      ? UNCATEGORIZED_OPTION_VALUE
      : `${CATEGORY_OPTION_PREFIX}${categoryFilter}`);

  useEffect(() => {
    if (reviewOnly) {
      searchRequestId.current += 1;
      if (searchTimeout.current !== null) {
        window.clearTimeout(searchTimeout.current);
        searchTimeout.current = null;
      }
      setSearchResults([]);
      setIsSearching(false);
      setHasSearchError(false);
      return undefined;
    }
    if (catalogBlocked) return;
    let isActive = true;
    const requestId = ++searchRequestId.current;
    const term = appliedSearchTerm;
    let timeoutId = null;

    if (searchTimeout.current !== null) {
      window.clearTimeout(searchTimeout.current);
      searchTimeout.current = null;
    }

    if (!term) {
      setSearchResults([]);
      setIsSearching(false);
      setHasSearchError(false);
      return () => {
        isActive = false;
      };
    }

    setIsSearching(true);
    setHasSearchError(false);
    timeoutId = window.setTimeout(() => {
      if (isActive && requestId === searchRequestId.current) {
        isActive = false;
        searchTimeout.current = null;
        setIsSearching(false);
        setHasSearchError(true);
        if (reconnect) setSearchResults([]);
        setSearchConnection(reconnect);
      }
    }, PRODUCT_SEARCH_TIMEOUT_MS);
    searchTimeout.current = timeoutId;

    const fetchSearchResults = async () => {
      try {
        const results = await searchProductsInDB(term, statusFilter, categoryFilter, {
          eligible: (product) => isInventoryCatalogEligible(product, {
            status: statusFilter,
            productType: 'sellable',
            categoryId: categoryFilter
          })
        });
        if (isActive && requestId === searchRequestId.current) {
          setSearchResults(results.filter((product) => (
            isInventoryCatalogEligible(product, {
              status: statusFilter,
              productType: 'sellable',
              categoryId: categoryFilter
            })
          )));
          setHasSearchError(false);
        }
      } catch (error) {
        console.error('Error buscando productos en ProductList:', error);
        if (isActive && requestId === searchRequestId.current) {
          setHasSearchError(true);
          if (reconnect) setSearchResults([]);
        }
      } finally {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          if (searchTimeout.current === timeoutId) searchTimeout.current = null;
        }
        if (isActive && requestId === searchRequestId.current) {
          setIsSearching(false);
          setSearchConnection(reconnect);
        }
      }
    };

    fetchSearchResults();

    return () => {
      isActive = false;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        if (searchTimeout.current === timeoutId) searchTimeout.current = null;
      }
    };
  }, [appliedSearchTerm, catalogBlocked, categoryFilter, reconnect, reviewOnly, searchExecution, statusFilter]);

  const isSearchMode = appliedSearchTerm.length > 0;
  const isSearchEditPending = isSearchMode && normalizedSearchTerm !== appliedSearchTerm;
  const isSearchPending = isSearchMode && (isSearching || searchConnection !== reconnect);
  const showSearchError = !catalogBlocked && searchConnection === reconnect && isSearchMode && hasSearchError;
  const isInitialCatalogLoading = !isSearchMode && (isLoading || isGlobalLoading) && products.length === 0;
  const displayProducts = useMemo(() => {
    if (reviewOnly) return products;
    if (catalogBlocked) return [];
    if (!isSearchMode) return products;
    if (searchConnection !== reconnect) return [];
    return searchResults.filter((product) => isInventoryCatalogEligible(product, {
      status: statusFilter,
      productType: 'sellable',
      categoryId: categoryFilter
    }));
  }, [catalogBlocked, categoryFilter, isSearchMode, products, reconnect, reviewOnly, searchConnection, searchResults, statusFilter]);
  const visibleProductIds = useMemo(() => displayProducts.map((product) => product.id).filter(Boolean), [displayProducts]);

  useEffect(() => {
    if (catalogBlocked) return;
    let cancelled = false;
    queryBatchesByProductIdsAndActive(visibleProductIds)
      .then((batches) => { if (!cancelled) setBatchSummaries(getProductBatchSummaryMap(batches)); })
      .catch(() => { if (!cancelled) setBatchSummaries(new Map()); });
    return () => { cancelled = true; };
  }, [catalogBlocked, visibleProductIds]);

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

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    if (!normalizedSearchTerm || (isSearching && normalizedSearchTerm === appliedSearchTerm)) return;

    if (normalizedSearchTerm !== appliedSearchTerm) setSearchResults([]);
    setAppliedSearchTerm(normalizedSearchTerm);
    setIsSearching(true);
    setHasSearchError(false);
    setSearchExecution((execution) => execution + 1);
  };

  const handleRetrySearch = () => {
    if (!appliedSearchTerm) return;
    setIsSearching(true);
    setHasSearchError(false);
    setSearchExecution((execution) => execution + 1);
  };

  const handleClearSearch = () => {
    searchRequestId.current += 1;
    if (searchTimeout.current !== null) {
      window.clearTimeout(searchTimeout.current);
      searchTimeout.current = null;
    }
    setSearchTerm('');
    setAppliedSearchTerm('');
    setSearchResults([]);
    setIsSearching(false);
    setHasSearchError(false);
    searchInput.current?.focus();
  };

  return (
    <div className="product-list-container">
      {/* --- Header --- */}
      <div className="list-header">
        <div className="title-group">
          <h3 className="subtitle">Inventario</h3>
          <span className="product-count">{displayProducts.length} items mostrados</span>
        </div>

        {!reviewOnly && <div className="product-list-actions">
          <form
            className="product-search-form"
            role="search"
            aria-label="Buscar productos"
            onSubmit={handleSearchSubmit}
          >
            <div className="search-box product-list-search">
              <span className="search-icon"><Icons.Search /></span>
              <input
                ref={searchInput}
                type="text"
                placeholder={features.hasLabFields ? "Buscar: Nombre, Sustancia..." : "Buscar: Nombre, Código..."}
                aria-label="Buscar productos"
                enterKeyHint="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              {(searchTerm.length > 0 || isSearchMode) && (
                <button
                  type="button"
                  className="product-search-clear"
                  aria-label="Limpiar búsqueda"
                  title="Limpiar búsqueda"
                  onClick={handleClearSearch}
                >
                  Limpiar
                </button>
              )}
            </div>
            <button
              type="submit"
              className="product-search-submit"
              disabled={!normalizedSearchTerm || (isSearching && normalizedSearchTerm === appliedSearchTerm)}
            >
              <Icons.Search />
              Buscar
            </button>
          </form>

          <select
            value={statusFilter}
            onChange={(e) => setFilters({ status: e.target.value })}
            aria-label="Filtrar por estado"
            className="product-status-filter"
          >
            <option value="all">Todos los estados</option>
            <option value="active">Solo Activos</option>
            <option value="inactive">Solo Inactivos</option>
          </select>

          <select
            value={categoryFilterValue}
            onChange={(event) => {
              const { value } = event.target;
              if (!value) {
                setFilters({ categoryId: null });
              } else if (value === UNCATEGORIZED_OPTION_VALUE) {
                setFilters({ categoryId: INVENTORY_UNCATEGORIZED_FILTER });
              } else if (value.startsWith(CATEGORY_OPTION_PREFIX)) {
                const selectedCategory = categories.find((category) => (
                  String(category.id) === value.slice(CATEGORY_OPTION_PREFIX.length)
                ));
                if (selectedCategory) setFilters({ categoryId: selectedCategory.id });
              }
            }}
            aria-label="Filtrar por categoría"
            className="product-category-filter"
          >
            <option value="">Todas las categorías</option>
            <option value={UNCATEGORIZED_OPTION_VALUE}>Sin categoría</option>
            {categories.map((category) => (
              <option key={category.id} value={`${CATEGORY_OPTION_PREFIX}${category.id}`}>
                {category.name}
              </option>
            ))}
          </select>

          {!reviewOnly && canManageProducts && features.hasDailyPricing && (
            <button
                className="ui-button ui-button--secondary btn-update-price"
                onClick={onOpenDailyPrice}
                title="Actualizar Precios del Día"
            >
                <Icons.Price />
                Actualizar Precios
            </button>
          )}
        </div>}
      </div>

      {!reviewOnly && isSearchEditPending && (
        <p className="product-search-edit-note">
          Consulta aplicada: «{appliedSearchTerm}». Pulsa Buscar para aplicar el texto editado.
        </p>
      )}

      {!reviewOnly && isSearchPending && (
        <div className="product-search-feedback" role="status" aria-live="polite">
          <span className="ui-spinner ui-spinner--sm product-search-spinner" aria-hidden="true" />
          <span>Buscando productos...</span>
        </div>
      )}

      {!reviewOnly && showSearchError && (
        <div className="product-search-error" role="alert">
          <span>No se pudieron buscar los productos. Intenta nuevamente.</span>
          <button
            type="button"
            className="ui-button ui-button--secondary ui-button--sm"
            onClick={handleRetrySearch}
          >
            Reintentar
          </button>
        </div>
      )}

      {!reviewOnly && catalogUnavailable ? (
        <p role="status">El catálogo local no está disponible.</p>
      ) : (!reviewOnly && catalogLoading) || isInitialCatalogLoading ? (
        <div className="ui-loading-state loader-container" role="status">
          <div className="ui-spinner spinner" aria-hidden="true" />
          <p>Cargando inventario...</p>
        </div>
      ) : (isSearchPending || showSearchError) && displayProducts.length === 0 ? null : displayProducts.length === 0 ? (
        <div className="ui-empty-state empty-state">
          <div className="ui-empty-state__icon empty-icon"><Icons.Empty /></div>
          <h3>No se encontraron productos</h3>
          <p>Prueba con otra categoría, estado o término de búsqueda.</p>
        </div>
      ) : (
        <div className="product-grid">
          {displayProducts.map(item => {
            const rawCategoryId = [item.categoryId, item.category_id]
              .find((value) => value !== null && value !== undefined && value !== '') ?? null;
            const categoryName = rawCategoryId === null
              ? 'Sin categoría'
              : (categoryMap.get(String(rawCategoryId)) || 'Categoría no disponible');
            const isActive = item.isActive !== false;
            const availableStock = getAvailableStock(item);
            const committedStock = getCommittedStock(item);
            const productImageSource = item.imageUrl || item.image_url || item.image;

            // Alertas
            const { isLowStock } = getProductAlerts(item);
            const batchSummary = batchSummaries.get(item.id);
            const expiry = getProductCardExpiryState(item, batchSummary);
            const shelfLife = item.expirationMode === 'SHELF_LIFE'
              ? formatShelfLife(item.shelfLifeValue, item.shelfLifeUnit)
              : null;
            const isTracked = item.trackStock !== false && (
              item.trackStock === true || item.batchManagement?.enabled === true
            );
            const pharmacy = getPharmacyClassification(item);
            const isMedicine = pharmacy.recorded && pharmacy.kind === 'medicine';

            // Unidad de medida
            const unitLabel = resolveProductSaleUnit(item);

            const margin = calculateMargin(item.price, item.cost);

            // Banderas de visualización
            const showLocation = item.location && item.location.trim() !== '';
            const showMinMax = features.hasMinMax && isTracked;
            const showPharmacyDetails = features.hasLabFields && (item.sustancia || item.laboratorio);
            const showBarcode = item.barcode && item.barcode.trim() !== '';

            // Clases dinámicas
            let borderClass = '';
            if (features.hasExpiry && (expiry.isNearingExpiry || expiry.isExpired)) borderClass = 'border-critical';
            else if (isLowStock) borderClass = 'border-warning';

            return (
              <div key={item.id} className={`ui-card ui-card--interactive product-card-complex ${borderClass} ${!isActive ? 'opacity-dim' : ''}`}>

                {/* 1. Cabecera e Imagen */}
                <div className="complex-header">
                  <div className="img-area">
                    <LazyImage src={productImageSource} alt={item.name} />
                  </div>

                  <div className="title-area">
                    <div className="title-top">
                      <h4 title={item.name}>{item.name}</h4>
                    </div>
                    <div className="sub-meta">
                      <span className="ui-badge ui-badge--neutral category-badge">{categoryName}</span>
                      {features.hasSKU && item.sku && <span className="ui-badge ui-badge--info sku-badge">SKU: {item.sku}</span>}
                    </div>
                    <ProductCloudSyncIndicators product={item} />
                  </div>

                  <div className="actions-area">
                    {!reviewOnly && isTracked && canManageInventory && (
                      <button
                        className="ui-button ui-button--neutral ui-button--sm btn-action btn-batches"
                        onClick={() => onManageBatches(item.id)}
                        title="Consultar lotes, variantes e historial"
                        disabled={!isActive}
                      >
                        <Icons.Layers /> <span>Lotes / historial</span>
                      </button>
                    )}
                    {!reviewOnly && isTracked && canManageInventory && canAddInventoryEntry(item) && (
                      <button
                        className="ui-button ui-button--primary ui-button--sm btn-action"
                        onClick={() => setProductForInventoryEntry(item)}
                        title={isMedicine ? 'Recibir medicamento con proveedor, comprobante y lote' : 'Agregar existencia'}
                        disabled={!isActive}
                      >
                        <span>＋</span> <span>{isMedicine ? 'Recibir medicamento' : 'Agregar existencia'}</span>
                      </button>
                    )}
                    {!reviewOnly && canManageProducts && isActive && (
                      item.syncStatus !== 'synced' || !item.serverVersion || !item.lastSyncedAt
                    ) && (
                      <button
                        className="ui-button ui-button--neutral ui-button--sm btn-action btn-product-recovery"
                        onClick={() => setProductForRecovery(item)}
                        title="Verificar el producto local y sus lotes sin escribir datos"
                      >
                        Verificar Cloud
                      </button>
                    )}
                    {!reviewOnly && canManageProducts && (
                    <button className="ui-button ui-button--ghost ui-button--sm btn-action btn-edit" onClick={() => onEdit(item)} title="Editar" disabled={!isActive}>
                      <Icons.Edit /> <span>Editar</span>
                    </button>
                    )}
                    {!reviewOnly && canDeleteProducts && (
                    <button className="ui-button ui-button--danger ui-button--sm btn-action btn-delete" onClick={() => onDelete(item)} title="Eliminar" disabled={!isActive}>
                      <Icons.Delete /> <span>Eliminar</span>
                    </button>
                    )}
                  </div>
                </div>

                {/* 2. Banner de Alertas (Solo si existen) */}
                {(features.hasExpiry && (expiry.isNearingExpiry || expiry.isExpired)) || (isLowStock && isTracked) ? (
                  <div className="alert-section-wrapper">
                    {features.hasExpiry && (expiry.isNearingExpiry || expiry.isExpired) && (
                      <div className="ui-alert ui-alert--danger alert-banner alert-red">
                        {expiry.isExpired ? 'Caducado' : (expiry.daysUntilExpiry === 0 ? 'Caduca hoy' : `Caduca en ${expiry.daysUntilExpiry} días`)}
                      </div>
                    )}
                    {isLowStock && isTracked && (
                      <div className="ui-alert ui-alert--warning alert-banner alert-orange">
                        ⚠️ Stock Bajo ({availableStock} {showMinMax && item.minStock !== null && item.minStock !== undefined ? `≤ ${item.minStock}` : ''})
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
                    <span className="stat-label">Disponible</span>
                    <span className={`stat-value stock ${availableStock <= 0 ? 'text-red' : ''}`}>
                      {isTracked ? availableStock : '∞'} <small>{unitLabel}</small>
                    </span>
                    {isTracked && (
                      <span className="stock-breakdown">
                        Total: {item.stock ?? 0} | Comprometido: {committedStock}
                      </span>
                    )}
                  </div>
                  <div className="stat-block">
                    <span className="stat-label">Margen</span>
                    <span className={`stat-value ${margin > 30 ? 'text-success' : 'text-muted'}`}>
                      {margin ? `${margin}%` : '--'}
                    </span>
                  </div>
                </div>

                {reviewOnly && (
                  <div className="product-lia-review-cost" role="note">
                    <span>{historicalCostReview ? 'Costo registrado actualmente en el catálogo' : 'Costo actual del catálogo'}</span>
                    <strong>{item.cost !== null && item.cost !== undefined && item.cost !== '' && Number.isFinite(Number(item.cost))
                      ? `$${Number(item.cost).toFixed(2)}`
                      : 'No disponible'}</strong>
                  </div>
                )}

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
                          <span className="value">{item.minStock ?? '--'} / {item.maxStock ?? '∞'}</span>
                        </div>
                      )}
                      {showBarcode && !showPharmacyDetails && (
                        <div className="detail-item">
                          <span className="label">Código:</span>
                          <span className="value monospace">{item.barcode}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {expiry.expiryDate && <div className="rubro-section logistics">
                    <div className="detail-item"><span className="label">Próxima caducidad:</span><span className="value">{formatDate(expiry.expiryDate)}</span></div>
                    {shelfLife && <div className="detail-item"><span className="label">Vida útil para nuevas entradas:</span><span className="value">{shelfLife}</span></div>}
                    {shelfLife && batchSummary?.nearestAlertTargetDate && <div className="detail-item"><span className="label">Consumo recomendado:</span><span className="value">{formatDate(batchSummary.nearestAlertTargetDate)}</span></div>}
                  </div>}
                  {!expiry.expiryDate && shelfLife && <div className="rubro-section logistics"><div className="detail-item"><span className="label">Vida útil:</span><span className="value">{shelfLife}</span></div></div>}
                </div>

                {/* 5. Footer con Switch de Estado y Acciones Secundarias */}
                <div className="complex-footer">
                  {!reviewOnly && canManageProducts && (
                  <div className="status-switch-container" onClick={() => onToggleStatus(item)} title={isActive ? "Desactivar" : "Activar"}>
                    <div className={`switch-track ${isActive ? 'checked' : ''}`}>
                      <div className="switch-thumb"></div>
                    </div>
                    <span className="switch-label">{isActive ? 'Activo' : 'Inactivo'}</span>
                  </div>
                  )}

                  {!reviewOnly && <div className="footer-actions">
                    {/* Badges Informativos */}
                    {features.hasWholesale && item.wholesaleTiers?.length > 0 && (
                      <span className="ui-badge ui-badge--info feat-badge purple" title="Tiene precios de mayoreo">Mayoreo</span>
                    )}
                    {item.productType === 'ingredient' && (
                      <span className="ui-badge ui-badge--neutral feat-badge gray">Insumo</span>
                    )}

                    {/* Botón de Merma (Solo visible si el rubro lo permite y está activo) */}
                    {features.hasWaste && canManageInventory && isActive && (
                      <button className="ui-button ui-button--warning ui-button--sm btn-waste-text" onClick={() => handleOpenWaste(item)}>
                        <Icons.Waste /> Merma
                      </button>
                    )}
                  </div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!reviewOnly && !catalogBlocked && !isSearchMode && hasMore && (
        <div className="pagination-container">
          <button className="ui-button ui-button--secondary btn-load-more" onClick={() => fetchPage('next')} disabled={isGlobalLoading}>
            {isGlobalLoading ? 'Cargando...' : 'Cargar más productos'}
          </button>
        </div>
      )}

      <WasteModal show={showWaste} onClose={handleCloseWaste} product={productForWaste} onConfirm={handleWasteConfirmed} />
      {productForInventoryEntry && <InventoryEntryModal key={productForInventoryEntry.id} product={productForInventoryEntry} onClose={() => setProductForInventoryEntry(null)} onCompleted={refreshData} />}
      {productForRecovery && <IndividualProductRecoveryDialog product={productForRecovery} onClose={() => setProductForRecovery(null)} />}
    </div>
  );
}
