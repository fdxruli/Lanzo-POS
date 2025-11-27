import React from 'react';
import { 
  // RotateCcw, // <-- Lo quitamos porque estaba fallando
  Trash2, 
  ShoppingBag, 
  User, 
  Package, 
  Tag 
} from 'lucide-react';
import './RecycleBin.css';

export default function RecycleBin({ items, onRestoreItem }) {
  
  // Helper para icono según tipo
  const getIcon = (type) => {
    switch(type) {
      case 'Cliente': return <User size={18} className="icon-blue" />;
      case 'Pedido': return <ShoppingBag size={18} className="icon-green" />;
      case 'Producto': return <Package size={18} className="icon-orange" />;
      case 'Categoría': return <Tag size={18} className="icon-purple" />;
      default: return <Trash2 size={18} />;
    }
  };

  return (
    <div className="movement-history-container">
      <div className="bin-header">
        <h3 className="subtitle" style={{margin:0, border: 'none'}}>🗑️ Papelera de Reciclaje</h3>
        <span className="bin-count">{items.length} items</span>
      </div>
      
      {items.length === 0 ? (
        <div className="recycle-empty-message">
            Papelera vacía. Todo está limpio.
        </div>
      ) : (
        <div className="movement-history-list">
          {items.map((item) => (
            <div key={item.uniqueId} className="movement-item">
              
              {/* Icono y Datos */}
              <div className="movement-content">
                <div className="item-icon-circle">
                  {getIcon(item.type)}
                </div>
                <div className="movement-item-info">
                  <p className="item-main-text">{item.mainLabel}</p>
                  <div className="item-sub-text">
                    <span className="item-badge">{item.type}</span>
                    <span>• Eliminado: {new Date(item.deletedTimestamp).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              {/* Botón Restaurar CORREGIDO */}
              <button 
                className="btn-restore-icon" 
                onClick={() => onRestoreItem(item)}
                title="Restaurar este elemento"
                // Usamos un símbolo unicode directo para asegurar que se vea siempre
                style={{ fontSize: '1.2rem', fontWeight: 'bold' }} 
              >
                ⟲
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}