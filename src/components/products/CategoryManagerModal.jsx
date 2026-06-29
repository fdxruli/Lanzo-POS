// src/components/products/CategoryManagerModal.jsx
import { useCallback, useState } from 'react';
import CategoryForm from './CategoryForm';
import { useDismissibleHistoryLayer } from '../../hooks/useDismissibleHistoryLayer';
import './CategoryManagerModal.css';

export default function CategoryManagerModal({ show, onClose, categories, onSave, onRefresh, onDelete }) {
  const [editingCategory, setEditingCategory] = useState(null);

  const handleDismiss = useCallback(() => {
    setEditingCategory(null);
    onClose();
  }, [onClose]);

  const dismissModal = useDismissibleHistoryLayer({
    isOpen: show,
    onDismiss: handleDismiss,
    layerId: 'category-manager-modal'
  });

  if (!show) return null;

  const handleSaveSuccess = () => {
    setEditingCategory(null);
    if (onRefresh) onRefresh(); // Sincroniza el estado global después de guardar
  };

  return (
    <div id="category-modal" className="ui-modal category-modal" role="dialog" aria-modal="true" aria-label="Gestionar categorias">
      <div className="ui-modal__content category-modal__content">
        <h2 className="modal-title">Gestionar Categorías</h2>
        
        {/* Inyectamos el formulario centralizado */}
        <div className="category-modal__form">
          <CategoryForm 
            initialData={editingCategory}
            onSave={onSave}
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
        
        <footer className="ui-modal__actions category-modal__actions">
          <button id="close-category-modal-btn" type="button" className="ui-button ui-button--ghost btn btn-cancel" onClick={dismissModal}>
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  );
}
