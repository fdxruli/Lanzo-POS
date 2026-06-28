import { useState, useEffect } from 'react';
import { useRecycleBinStore } from '../../store/useRecycleBinStore';
import { 
  Trash2, 
  RotateCcw, 
  Search, 
  Recycle, 
  Archive
} from 'lucide-react';
import './RecycleBin.css';
import { useSalesStore } from '../../store/useSalesStore';
import { showConfirmModal, showMessageModal } from '../../services/utils';

const formatDate = (dateString) => {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
};

const getTypeBadge = (type) => {
  switch (type) {
    case 'Producto': return <span className="ui-badge ui-badge--info badge badge-product">Producto</span>;
    case 'Cliente': return <span className="ui-badge ui-badge--success badge badge-customer">Cliente</span>;
    case 'Pedido': return <span className="ui-badge ui-badge--warning badge badge-sale">Venta</span>;
    case 'Categoria': return <span className="ui-badge ui-badge--neutral badge badge-default">Categoria</span>;
    default: return <span className="ui-badge ui-badge--neutral badge badge-default">{type}</span>;
  }
};

const RecycleBin = () => {
  const { 
    deletedItems, 
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
  const loadRecentSales = useSalesStore((state) => state.loadRecentSales);

  // Cargar datos al entrar a la pantalla
  useEffect(() => {
    loadRecycleBin();
  }, [loadRecycleBin]);

  // Filtrar items
  const filteredItems = deletedItems.filter(item => 
    (item.name || item.mainLabel || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.type || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleRestore = async (item) => {
    if (await showConfirmModal(`¿Restaurar "${item.mainLabel || item.name}" a su lugar original?`, {
      title: 'Restaurar elemento',
      confirmButtonText: 'Si, restaurar',
      cancelButtonText: 'Cancelar'
    })) {
      const result = await restoreItem(item);
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
    if (await showConfirmModal('¿Estás seguro? Esta acción liberará espacio y no se puede deshacer.', {
      title: 'Eliminar permanentemente',
      confirmButtonText: 'Si, eliminar',
      cancelButtonText: 'Cancelar'
    })) {
      await permanentlyDelete(item);
    }
  };

  const handleEmptyBin = async () => {
    if (await showConfirmModal('¿Vaciar toda la papelera? Se eliminarán permanentemente todos los elementos.', {
      title: 'Vaciar papelera',
      confirmButtonText: 'Si, vaciar',
      cancelButtonText: 'Cancelar'
    })) {
      await emptyBin();
    }
  };

  return (
    <div className="recycle-bin-container">
      {/* Header */}
      <div className="recycle-header">
        <h2>
          <Recycle className="text-blue-500" size={24} />
          Papelera de Reciclaje 
          <span className="text-gray-400 text-sm ml-2">({deletedItems.length}/{totalItems})</span>
        </h2>
        
        <div className="recycle-actions">
          <div className="recycle-search">
            <Search className="search-icon" size={16} />
            <input 
              type="text" 
              placeholder="Buscar archivo eliminado..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          {deletedItems.length > 0 && (
            <button type="button" className="ui-button ui-button--danger btn-empty-bin" onClick={handleEmptyBin} disabled={isLoading}>
              <Trash2 size={16} />
              {isLoading ? 'Procesando...' : 'Vaciar Todo'}
            </button>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div className="recycle-table-wrapper">
        {isLoading && deletedItems.length === 0 ? (
          <div className="ui-loading-state empty-state">
             <p>Cargando elementos eliminados...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="ui-empty-state empty-state">
            <Archive className="empty-state-icon recycle-empty-icon" size={64} />
            <p>La papelera está vacía o no hay resultados.</p>
          </div>
        ) : (
          <table className="recycle-table">
            <thead>
              <tr>
                <th className="recycle-col-element">Elemento</th>
                <th className="recycle-col-type">Tipo</th>
                <th className="recycle-col-date">Fecha Eliminación</th>
                <th className="recycle-col-actions">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.uniqueId || item.id || item.timestamp}>
                  <td>
                    <strong>{item.mainLabel || item.name}</strong>
                    {item.code && (
                      <div className="recycle-item-code">
                        Código: {item.code}
                      </div>
                    )}
                  </td>
                  <td>{getTypeBadge(item.type)}</td>
                  <td>{formatDate(item.deletedTimestamp || item.deletedAt)}</td>
                  <td>
                    <div className="action-group">
                      <button 
                        type="button"
                        className="btn-icon btn-restore" 
                        onClick={() => handleRestore(item)}
                        title="Restaurar"
                        disabled={isLoading}
                      >
                        <RotateCcw size={16} />
                      </button>
                      <button 
                        type="button"
                        className="btn-icon btn-delete-forever" 
                        onClick={() => handleDeleteForever(item)}
                        title="Eliminar permanentemente"
                        disabled={isLoading}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="recycle-pagination">
        <button
          type="button"
          className="ui-button ui-button--ghost ui-button--sm btn-recycle-page"
          onClick={() => fetchRecycleBinPage('prev')}
          disabled={isLoading || !hasPrev}
        >
          Anterior
        </button>
        <span>Pagina {currentPageIndex + 1}</span>
        <button
          type="button"
          className="ui-button ui-button--ghost ui-button--sm btn-recycle-page"
          onClick={() => fetchRecycleBinPage('next')}
          disabled={isLoading || !hasMore}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
};

export default RecycleBin;
