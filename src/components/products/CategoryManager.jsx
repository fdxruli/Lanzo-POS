import React, { useState } from 'react';
import CategoryForm from './CategoryForm';

export default function CategoryManager({ categories, onRefresh, onDelete }) {
  const [editingCategory, setEditingCategory] = useState(null);

  const handleSaveSuccess = () => {
    setEditingCategory(null);
    onRefresh(); // Llama a refreshCategories() del store
  };

  return (
    <div className="category-manager-container" style={{ display: 'flex', gap: '20px' }}>
      <div className="form-section" style={{ width: '30%' }}>
        <h3>{editingCategory ? 'Editar' : 'Nueva'} Categoría</h3>
        <CategoryForm 
          initialData={editingCategory} 
          onSaveSuccess={handleSaveSuccess}
          onCancel={editingCategory ? () => setEditingCategory(null) : null}
        />
      </div>

      <div className="list-section" style={{ width: '70%' }}>
        <h3>Categorías Existentes</h3>
        <div className="category-grid">
          {categories.map(cat => (
            <div key={cat.id} style={{ borderLeft: `5px solid ${cat.color || '#ccc'}`, padding: '10px' }}>
              <span>{cat.name} (Orden: {cat.sortOrder})</span>
              <button onClick={() => setEditingCategory(cat)}>✏️</button>
              <button onClick={() => onDelete(cat.id)}>🗑️</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}