import React, { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import CategoryForm from './CategoryForm';
import './CategoryManager.css';

export default function CategoryManager({ categories, onRefresh, onDelete }) {
  const [editingCategory, setEditingCategory] = useState(null);

  const handleSaveSuccess = () => {
    setEditingCategory(null);
    onRefresh(); 
  };

  return (
    <div className="category-manager-container">
      <div className="category-form-section">
        <h3>{editingCategory ? 'Editar' : 'Nueva'} Categoría</h3>
        <CategoryForm 
          initialData={editingCategory} 
          onSaveSuccess={handleSaveSuccess}
          onCancel={editingCategory ? () => setEditingCategory(null) : null}
        />
      </div>

      <div className="category-list-section">
        <div className="category-list-header">
          <h3>Categorías Existentes</h3>
          <span className="category-count-badge">{categories.length}</span>
        </div>
        
        <div className="category-list-grid">
          {categories.map(cat => (
            <div 
              key={cat.id} 
              className="category-card-item"
              style={{ borderLeftColor: cat.color || 'var(--primary-color)' }}
            >
              <span className="category-name">
                {cat.name} <small style={{ opacity: 0.7, fontSize: '0.85em', marginLeft: '4px' }}>(Ord: {cat.sortOrder})</small>
              </span>
              
              <div className="category-actions">
                <button 
                  className="btn-icon edit" 
                  onClick={() => setEditingCategory(cat)}
                  title="Editar"
                >
                  <Pencil size={18} />
                </button>
                <button 
                  className="btn-icon delete" 
                  onClick={() => onDelete(cat.id)}
                  title="Eliminar"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}