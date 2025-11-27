// src/components/dashboard/RecycleBin.jsx
import React from 'react';
import './RecycleBin.css'

export default function RecycleBin({ items, onRestoreItem }) {
  return (
    <div className="movement-history-container">
      <h3 className="subtitle">Papelera de Reciclaje</h3>
      {items.length === 0 ? (
        /* CAMBIO AQUÍ: Usamos una clase específica */
        <div className="recycle-empty-message">
            No hay elementos eliminados recientemente.
        </div>
      ) : (
        <div id="movement-history-list" className="movement-history-list">
          {items.map((item) => (
            <div key={item.uniqueId} className="movement-item">
              <div className="movement-item-info">
                <p>{item.name}</p>
                <p>
                  <span className="item-type">{item.type}</span> 
                  Eliminado el: {new Date(item.deletedTimestamp).toLocaleString()}
                </p>
              </div>
              <div className="movement-item-actions">
                <button 
                  className="btn-restore" 
                  onClick={() => onRestoreItem(item)}
                >
                  Restaurar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}