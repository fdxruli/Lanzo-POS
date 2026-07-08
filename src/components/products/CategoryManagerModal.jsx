// src/components/products/CategoryManagerModal.jsx
import { useCallback, useState } from 'react';
import { Layers3, Pencil, Trash2 } from 'lucide-react';
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
    if (onRefresh) onRefresh();
  };

  const sortedCategories = categories.toSorted((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));

  return (
    <div id="category-modal" className="ui-modal category-modal" role="dialog" aria-modal="true" aria-label="Gestionar categorias">
      <div className="ui-modal__content category-modal__content">
        <div className="category-modal__header">
          <span className="category-modal__icon" aria-hidden="true">
            <Layers3 size={18} />
          </span>
          <div>
            <h2 className="modal-title">Gestionar categorias</h2>
            <p>{editingCategory ? `Editando ${editingCategory.name}` : 'Crea y ordena grupos del catalogo.'}</p>
          </div>
        </div>

        <div className="category-modal__form">
          <CategoryForm
            initialData={editingCategory}
            onSave={onSave}
            onSaveSuccess={handleSaveSuccess}
            onCancel={editingCategory ? () => setEditingCategory(null) : null}
          />
        </div>

        <div className="category-modal__list-header">
          <h3>Categorias existentes</h3>
          <span>{sortedCategories.length}</span>
        </div>

        <div className="category-list" id="category-list">
          {sortedCategories.length === 0 ? (
            <p className="category-modal__empty">No hay categorias creadas.</p>
          ) : (
            sortedCategories.map((cat) => (
              <article key={cat.id} className="category-item-managed">
                <span
                  className="category-modal__swatch"
                  style={{ backgroundColor: cat.color || 'var(--ui-color-primary)' }}
                  aria-hidden="true"
                />
                <div className="category-modal__copy">
                  <strong>{cat.name}</strong>
                  <small>Orden {Number(cat.sortOrder) || 0}</small>
                </div>
                <div className="category-item-controls">
                  <button type="button" className="edit-category-btn" onClick={() => setEditingCategory(cat)} title="Editar" aria-label={`Editar ${cat.name}`}>
                    <Pencil size={15} />
                  </button>
                  <button type="button" className="delete-category-btn" onClick={() => onDelete(cat.id)} title="Eliminar" aria-label={`Eliminar ${cat.name}`}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
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
