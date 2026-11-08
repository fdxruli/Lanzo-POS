import { useState, useEffect } from 'react';
import { useRecycleBinStore } from '../../store/useRecycleBinStore';
import { Trash2, RotateCcw, Search, Archive, ShieldAlert } from 'lucide-react';
import './RecycleBin.css';
import { useSalesStore } from '../../store/useSalesStore';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import { captureRefundsActorHandle } from '../../services/auth/refundsActorAuthorization';
import { getSaleDisplayReference } from '../../services/sales/saleReference';
import { formatCurrencyMXN } from '../../utils/formatCurrencyMXN';

const formatDate = (dateString) => {
  if (!dateString) return 'Fecha no disponible';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return date.toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
};

const getTypeLabel = (type) => ({
  Producto: 'Producto',
  Cliente: 'Cliente',
  Pedido: 'Venta',
  Categoria: 'Categoría'
}[type] || type || 'Elemento');

const getDeletedName = (item = {}) => {
  if (item.type === 'Pedido') {
    const reference = getSaleDisplayReference(item) || String(item.id || item.timestamp || '').slice(0, 8) || 'sin folio';
    const shortReference = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(reference)
      ? reference.slice(0, 8) + '…'
      : reference;
    return 'Venta ' + shortReference;
  }
  return item.mainLabel || item.name || 'Elemento sin nombre';
};

const RecycleBin = ({ canManageSaleRefunds = false }) => {
  const { 
    deletedItems,
    allDeletedItems,
    loadRecycleBin, 
    fetchRecycleBinPage,
    restoreItem, 
    permanentlyDelete, 
    emptyBin, 
    currentPageIndex,
    totalItems,
    hasPrev,
    hasMore,
    isLoading 
  } = useRecycleBinStore();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [visibleFiltered, setVisibleFiltered] = useState(30);
  const loadRecentSales = useSalesStore((state) => state.loadRecentSales);

  // Cargar datos al entrar a la pantalla
  useEffect(() => {
    loadRecycleBin();
  }, [loadRecycleBin]);

  const isFiltering = Boolean(searchTerm.trim()) || typeFilter !== 'all';
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase('es');
  // El store ya carga todos los elementos de la papelera local; buscar en el
  // total evita que los elementos de otras páginas queden ocultos.
  const filteredItems = isFiltering
    ? allDeletedItems.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (!normalizedSearch) return true;
      const searchable = [getDeletedName(item), item.mainLabel, item.name, item.code, item.id, getTypeLabel(item.type)]
        .map((value) => String(value || '').toLocaleLowerCase('es'))
        .join(' ');
      return searchable.includes(normalizedSearch);
    })
    : deletedItems;
  const visibleItems = isFiltering ? filteredItems.slice(0, visibleFiltered) : filteredItems;

  const updateSearch = (value) => {
    setSearchTerm(value);
    setVisibleFiltered(30);
  };
  const updateTypeFilter = (value) => {
    setTypeFilter(value);
    setVisibleFiltered(30);
  };

  const handleRestore = async (item) => {
    const isSale = item.type === 'Pedido';
    if (isSale && !canManageSaleRefunds) return;
    let actorHandle = null;
    try {
      actorHandle = isSale ? captureRefundsActorHandle() : null;
    } catch {
      showMessageModal('No tienes permiso vigente para restaurar esta venta.', null, { type: 'error' });
      return;
    }
    if (await showConfirmModal(`¿Restaurar "${item.mainLabel || item.name}" a su lugar original?`, {
      title: 'Restaurar elemento',
      confirmButtonText: 'Si, restaurar',
      cancelButtonText: 'Cancelar'
    })) {
      const result = await restoreItem(item, { actorHandle });
      if (result?.success === false) {
        showMessageModal(result.message || 'No se pudo restaurar el elemento.', null, { type: 'error' });
        return;
      }
      if (item.type === 'Pedido') await loadRecentSales();
      showMessageModal(
        item.type === 'Pedido'
          ? 'Venta restaurada y movimientos de inventario reaplicados.'
          : 'Elemento restaurado correctamente.'
      );
    }
  };

  const handleDeleteForever = async (item) => {
    const isSale = item.type === 'Pedido';
    if (isSale && !canManageSaleRefunds) return;
    let actorHandle = null;
    try {
      actorHandle = isSale ? captureRefundsActorHandle() : null;
    } catch {
      showMessageModal('No tienes permiso vigente para eliminar esta venta cancelada.', null, { type: 'error' });
      return;
    }
    if (await showConfirmModal('¿Eliminar definitivamente "' + getDeletedName(item) + '"? No podrás recuperarlo desde esta papelera.', {
      title: 'Eliminar permanentemente',
      confirmButtonText: 'Si, eliminar',
      cancelButtonText: 'Cancelar'
    })) {
      await permanentlyDelete(item, { actorHandle });
    }
  };

  const handleEmptyBin = async () => {
    const containsSales = allDeletedItems.some((item) => item.type === 'Pedido');
    const includeSales = !containsSales || canManageSaleRefunds;
    let actorHandle = null;
    try {
      actorHandle = containsSales && includeSales ? captureRefundsActorHandle() : null;
    } catch {
      showMessageModal('No tienes permiso vigente para eliminar ventas canceladas.', null, { type: 'error' });
      return;
    }
    const confirmation = includeSales
      ? '¿Vaciar toda la papelera? Se eliminarán permanentemente todos los elementos.'
      : '¿Vaciar los elementos autorizados? Las ventas canceladas se conservarán porque requieren permiso de devoluciones.';
    if (await showConfirmModal(confirmation, {
      title: 'Vaciar papelera',
      confirmButtonText: 'Si, vaciar',
      cancelButtonText: 'Cancelar'
    })) {
      await emptyBin({ includeSales, actorHandle });
    }
  };

  return (
    <section className="recycle-bin-container" aria-label="Papelera local">
      <header className="recycle-header">
        <div>
          <h3>Elementos eliminados</h3>
          <p>Recupera productos, clientes, categorías o ventas canceladas de este dispositivo.</p>
        </div>
        <span className="recycle-counter">{totalItems} en papelera</span>
      </header>

      <div className="recycle-tools">
        <label className="recycle-search">
          <Search className="search-icon" size={17} aria-hidden="true" />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => updateSearch(event.target.value)}
            placeholder="Buscar elemento o folio"
            aria-label="Buscar en toda la papelera local"
          />
        </label>
        <select
          className="recycle-type-filter"
          aria-label="Filtrar elementos eliminados por tipo"
          value={typeFilter}
          onChange={(event) => updateTypeFilter(event.target.value)}
        >
          <option value="all">Todos los tipos</option>
          <option value="Producto">Productos</option>
          <option value="Cliente">Clientes</option>
          <option value="Pedido">Ventas canceladas</option>
          <option value="Categoria">Categorías</option>
        </select>
      </div>

      <div className="recycle-meta">
        <span>{isFiltering ? filteredItems.length + ' coincidencias en la papelera' : 'Página ' + (currentPageIndex + 1) + ' · ' + deletedItems.length + ' elementos visibles'}</span>
        <span>Solo datos guardados en este dispositivo</span>
      </div>

      {isLoading && allDeletedItems.length === 0 ? (
        <div className="recycle-empty" role="status">
          <Archive size={24} aria-hidden="true" />
          <strong>Cargando elementos eliminados...</strong>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="recycle-empty">
          <Archive size={28} aria-hidden="true" />
          <strong>{totalItems === 0 ? 'La papelera está vacía' : 'No hay coincidencias'}</strong>
          <p>{totalItems === 0 ? 'Los elementos eliminados aparecerán aquí.' : 'Prueba otra búsqueda o cambia el filtro.'}</p>
        </div>
      ) : (
        <div className="recycle-list" aria-label="Elementos eliminados">
          {visibleItems.map((item) => {
            const saleRestricted = item.type === 'Pedido' && !canManageSaleRefunds;
            return (
              <article className="recycle-row" key={item.type + ':' + (item.uniqueId || item.id || item.timestamp)}>
                <div className="recycle-row-main">
                  <div className="recycle-row-info">
                    <strong>{getDeletedName(item)}</strong>
                    <span>{getTypeLabel(item.type)} · Eliminado: {formatDate(item.deletedTimestamp || item.deletedAt)}</span>
                    {item.code && <span>Código: {item.code}</span>}
                    {item.type === 'Pedido' && (
                      <span>Importe original: {formatCurrencyMXN(item.total, 'Importe no disponible')}</span>
                    )}
                    {saleRestricted && <span className="recycle-permission-note">Para gestionar esta venta necesitas permiso de devoluciones.</span>}
                  </div>
                </div>
                <div className="recycle-row-actions">
                  <button
                    type="button"
                    className="recycle-action"
                    onClick={() => handleRestore(item)}
                    disabled={isLoading || saleRestricted}
                    title={saleRestricted ? 'Requiere permiso de devoluciones' : 'Restaurar elemento'}
                  >
                    <RotateCcw size={16} aria-hidden="true" /> Restaurar
                  </button>
                  <button
                    type="button"
                    className="recycle-action recycle-action--danger"
                    onClick={() => handleDeleteForever(item)}
                    disabled={isLoading || saleRestricted}
                    title={saleRestricted ? 'Requiere permiso de devoluciones' : 'Eliminar sin posibilidad de restauración'}
                  >
                    <Trash2 size={16} aria-hidden="true" /> Eliminar definitivamente
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {isFiltering ? (
        visibleFiltered < filteredItems.length && (
          <div className="recycle-pagination">
            <button
              type="button"
              className="recycle-action"
              onClick={() => setVisibleFiltered((count) => count + 30)}
            >
              Mostrar más ({filteredItems.length - visibleFiltered})
            </button>
          </div>
        )
      ) : totalItems > 0 ? (
        <div className="recycle-pagination">
          <button type="button" className="recycle-action" onClick={() => fetchRecycleBinPage('prev')} disabled={isLoading || !hasPrev}>
            Anterior
          </button>
          <span>Página {currentPageIndex + 1}</span>
          <button type="button" className="recycle-action" onClick={() => fetchRecycleBinPage('next')} disabled={isLoading || !hasMore}>
            Siguiente
          </button>
        </div>
      ) : null}

      {totalItems > 0 && (
        <footer className="recycle-danger-footer">
          <p><ShieldAlert size={16} aria-hidden="true" /> Eliminar definitivamente no se puede deshacer.</p>
          <button type="button" className="recycle-danger-link" onClick={handleEmptyBin} disabled={isLoading}>
            Vaciar papelera...
          </button>
        </footer>
      )}
    </section>
  );
};

export default RecycleBin;
