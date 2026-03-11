// src/components/products/CategoryManagerModal.jsx
import React, { useState } from 'react';
import CategoryForm from './CategoryForm';
import './CategoryManagerModal.css';

export default function CategoryManagerModal({ show, onClose, categories, onRefresh, onDelete }) {
  const [editingCategory, setEditingCategory] = useState(null);

  if (!show) return null;

  const handleSaveSuccess = () => {
    setEditingCategory(null);
    if (onRefresh) onRefresh(); // Sincroniza el estado global después de guardar
  };

  const handleClose = () => {
    setEditingCategory(null);
    onClose();
  };

  return (
    <div id="category-modal" className="modal" style={{ display: 'flex' }}>
      <div className="modal-content">
        <h2 className="modal-title">Gestionar Categorías</h2>
        
        {/* Inyectamos el formulario centralizado */}
        <div style={{ marginBottom: '20px' }}>
          <CategoryForm 
            initialData={editingCategory}
            onSaveSuccess={handleSaveSuccess}
            onCancel={editingCategory ? () => setEditingCategory(null) : null}
          />
        </div>
        
        <h3 className="subtitle">Categorías Existentes</h3>
        <div className="category-list" id="category-list">
          {categories.length === 0 ? (
            <p>No hay categorías creadas.</p>
          ) : (
            categories.map(cat => (
              <div 
                key={cat.id} 
                className="category-item-managed" 
                style={{ borderLeft: `4px solid ${cat.color || '#ccc'}`, paddingLeft: '10px' }}
              >
                <span>{cat.name} <small>(Orden: {cat.sortOrder || 0})</small></span>
                <div className="category-item-controls">
                  <button className="edit-category-btn" onClick={() => setEditingCategory(cat)} title="Editar">✏️</button>
                  <button className="delete-category-btn" onClick={() => onDelete(cat.id)} title="Eliminar">🗑️</button>
                </div>
              </div>
            ))
          )}
        </div>
        
        <button id="close-category-modal-btn" className="btn btn-cancel" onClick={handleClose} style={{ marginTop: '20px' }}>
          Cerrar
        </button>
      </div>
    </div>
  );
}