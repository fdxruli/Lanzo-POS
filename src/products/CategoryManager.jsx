// src/components/products/CategoryManager.jsx
import React, { useState } from 'react';
import './CategoryManager.css'; // Usaremos un CSS simple o reutilizamos estilos

export default function CategoryManager({ categories, onSave, onDelete }) {
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    onSave({ 
      id: editingId || `cat-${Date.now()}`, 
      name: name.trim() 
    });
    
    resetForm();
  };

  const handleEdit = (cat) => {
    setName(cat.name);
    setEditingId(cat.id);
  };

  const handleDelete = (id) => {
    if (window.confirm('¿Seguro que quieres eliminar esta categoría?')) {
      onDelete(id);
    }
  };

  const resetForm = () => {
    setName('');
    setEditingId(null);
  };

  return (
    <div className="category-manager-container">
      
      {/* Columna 1: Formulario */}
      <div className="category-form-section">
        <h3 className="subtitle">{editingId ? 'Editar Categoría' : 'Nueva Categoría'}</h3>
        <form onSubmit={handleSubmit} className="category-inline-form">
            <div className="form-group" style={{ marginBottom: '10px' }}>
                <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Nombre (ej: Bebidas, Postres)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                />
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
                <button type="submit" className="btn btn-save" style={{ flex: 1 }}>
                    {editingId ? 'Actualizar' : 'Guardar'}
                </button>
                {editingId && (
                    <button type="button" className="btn btn-cancel" onClick={resetForm}>
                        Cancelar
                    </button>
                )}
            </div>
        </form>
      </div>

      {/* Columna 2: Lista */}
      <div className="category-list-section">
        <h3 className="subtitle">Categorías Existentes ({categories.length})</h3>
        <div className="category-list-grid">
            {categories.length === 0 ? (
                <p className="empty-message">No hay categorías registradas.</p>
            ) : (
                categories.map(cat => (
                    <div key={cat.id} className="category-card-item">
                        <span className="category-name">{cat.name}</span>
                        <div className="category-actions">
                            <button className="btn-icon edit" onClick={() => handleEdit(cat)} title="Editar">✏️</button>
                            <button className="btn-icon delete" onClick={() => handleDelete(cat.id)} title="Eliminar">🗑️</button>
                        </div>
                    </div>
                ))
            )}
        </div>
      </div>
    </div>
  );
}