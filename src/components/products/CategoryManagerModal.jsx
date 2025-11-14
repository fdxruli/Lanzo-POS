// src/components/products/CategoryManagerModal.jsx
import React, { useState, useEffect } from 'react';
import './CategoryManagerModal.css'

export default function CategoryManagerModal({ show, onClose, categories, onSave, onDelete }) {
  const [name, setName] = useState('');
  const [id, setId] = useState(null);

  // Lógica de 'resetCategoryForm'
  const resetForm = () => {
    setName('');
    setId(null);
  };

  // Lógica de 'editCategory'
  const handleEdit = (category) => {
    setName(category.name);
    setId(category.id);
  };

  // Lógica de 'saveCategory'
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name) return;
    onSave({ id: id || `cat-${Date.now()}`, name });
    resetForm();
  };

  const handleDelete = (categoryId) => {
    if (window.confirm('¿Seguro que quieres eliminar esta categoría?')) {
      onDelete(categoryId);
    }
  };
  
  const handleClose = () => {
    resetForm();
    onClose();
  };

  if (!show) return null;

  // HTML de 'category-modal'
  return (
    <div id="category-modal" className="modal" style={{ display: 'flex' }}>
      <div className="modal-content">
        <h2 className="modal-title">Gestionar Categorías</h2>
        <form id="category-form-container" onSubmit={handleSubmit}>
          <input type="hidden" id="category-id" value={id || ''} />
          <div className="form-group">
            <label htmlFor="category-name" className="form-label">Nombre de la Categoría</label>
            <input type="text" id="category-name" className="form-input" placeholder="Ej: Bebidas"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button typef="submit" id="save-category-btn" className="btn btn-save">
            {id ? 'Actualizar Categoría' : 'Guardar Categoría'}
          </button>
          {id && (
            <button type="button" className="btn btn-cancel" onClick={resetForm}>
              Cancelar Edición
            </button>
          )}
        </form>
        
        <h3 className="subtitle">Categorías Existentes</h3>
        <div className="category-list" id="category-list">
          {categories.length === 0 ? (
            <p>No hay categorías creadas.</p>
          ) : (
            categories.map(cat => (
              <div key={cat.id} className="category-item-managed">
                <span>{cat.name}</span>
                <div className="category-item-controls">
                  <button className="edit-category-btn" onClick={() => handleEdit(cat)}>✏️</button>
                  <button className="delete-category-btn" onClick={() => handleDelete(cat.id)}>🗑️</button>
                </div>
              </div>
            ))
          )}
        </div>
        
        <button id="close-category-modal-btn" className="btn btn-cancel" onClick={handleClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}