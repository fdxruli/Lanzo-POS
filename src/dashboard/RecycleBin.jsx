import React, { useState, useEffect } from 'react';
import { useRecycleBinStore } from '../../store/useRecycleBinStore';
import { 
  Trash2, 
  RotateCcw, 
  Search, 
  Recycle, 
  AlertTriangle,
  Archive
} from 'lucide-react';
import './RecycleBin.css';

const RecycleBin = () => {
  const { 
    deletedItems, 
    loadRecycleBin, 
    restoreItem, 
    permanentlyDelete, 
    emptyBin, 
    isLoading 
  } = useRecycleBinStore();
  
  const [searchTerm, setSearchTerm] = useState('');

  // Cargar datos al entrar a la pantalla
  useEffect(() => {
    loadRecycleBin();
  }, []);

  // Filtrar items
  const filteredItems = deletedItems.filter(item => 
    (item.name || item.mainLabel || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.type || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleRestore = async (item) => {
    if (confirm(`¿Restaurar "${item.mainLabel || item.name}" a su lugar original?`)) {
      await restoreItem(item);
    }
  };

  const handleDeleteForever = async (item) => {
    if (confirm('¿Estás seguro? Esta acción liberará espacio y no se puede deshacer.')) {
      await permanentlyDelete(item);
    }
  };

  const handleEmptyBin = async () => {
    if (confirm('¿Vaciar toda la papelera? Se eliminarán permanentemente todos los elementos.')) {
      await emptyBin();
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('es-MX', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  };

  const getTypeBadge = (type) => {
    switch (type) {
      case 'Producto': return <span className="badge badge-product">Producto</span>;
      case 'Cliente': return <span className="badge badge-customer">Cliente</span>;
      case 'Pedido': return <span className="badge badge-sale">Venta</span>;
      default: return <span className="badge badge-default">{type}</span>;
    }
  };

  return (
    <div className="recycle-bin-container">
      {/* Header */}
      <div className="recycle-header">
        <h2>
          <Recycle className="text-blue-500" size={24} />
          Papelera de Reciclaje 
          <span className="text-gray-400 text-sm ml-2">({deletedItems.length})</span>
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
            <button className="btn-empty-bin" onClick={handleEmptyBin} disabled={isLoading}>
              <Trash2 size={16} />
              {isLoading ? 'Procesando...' : 'Vaciar Todo'}
            </button>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div className="recycle-table-wrapper">
        {isLoading && deletedItems.length === 0 ? (
          <div className="empty-state">
             <p>Cargando elementos eliminados...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="empty-state">
            <Archive className="empty-state-icon" size={64} style={{ opacity: 0.2 }} />
            <p>La papelera está vacía o no hay resultados.</p>
          </div>
        ) : (
          <table className="recycle-table">
            <thead>
              <tr>
                <th style={{ width: '40%' }}>Elemento</th>
                <th style={{ width: '15%' }}>Tipo</th>
                <th style={{ width: '25%' }}>Fecha Eliminación</th>
                <th style={{ width: '20%' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item, index) => (
                <tr key={`${item.uniqueId}-${index}`}>
                  <td>
                    <strong>{item.mainLabel || item.name}</strong>
                    {item.code && (
                      <div style={{ fontSize: '0.8em', color: '#94a3b8' }}>
                        Código: {item.code}
                      </div>
                    )}
                  </td>
                  <td>{getTypeBadge(item.type)}</td>
                  <td>{formatDate(item.deletedTimestamp || item.deletedAt)}</td>
                  <td>
                    <div className="action-group">
                      <button 
                        className="btn-icon btn-restore" 
                        onClick={() => handleRestore(item)}
                        title="Restaurar"
                        disabled={isLoading}
                      >
                        <RotateCcw size={16} />
                      </button>
                      <button 
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
    </div>
  );
};

export default RecycleBin;