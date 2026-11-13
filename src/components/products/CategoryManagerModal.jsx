import { useCallback, useState } from 'react';
import { Layers3 } from 'lucide-react';
import CategoryForm from './CategoryForm';
import CategoryList from './CategoryList';
import { useDismissibleHistoryLayer } from '../../hooks/useDismissibleHistoryLayer';
import './CategoryManagerModal.css';

const EMPTY_CATEGORIES = [];

export default function CategoryManagerModal({ show, onClose, categories = EMPTY_CATEGORIES, onSave, onRefresh, onDelete }) {
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
    onRefresh?.();
  };

  const categoryCount = Array.isArray(categories) ? categories.length : 0;

  return (
    <div id="category-modal" className="ui-modal category-modal" role="dialog" aria-modal="true" aria-labelledby="category-modal-title">
      <div className="ui-modal__content category-modal__content">
        <header className="category-modal__header">
          <span className="category-modal__icon" aria-hidden="true">
            <Layers3 size={18} />
          </span>
          <div>
            <h2 id="category-modal-title" className="modal-title">Gestionar categorías</h2>
            <p>{editingCategory ? `Editando ${editingCategory.name}` : 'Crea y edita categorías para tus productos.'}</p>
          </div>
        </header>

        <div className="category-modal__form">
          <CategoryForm
            initialData={editingCategory}
            onSave={onSave}
            onSaveSuccess={handleSaveSuccess}
            onCancel={editingCategory ? () => setEditingCategory(null) : null}
          />
        </div>

        <section className="category-modal__list-section" aria-labelledby="category-modal-list-heading">
          <div className="category-modal__list-header">
            <h3 id="category-modal-list-heading">Categorías existentes</h3>
            <span aria-label={`${categoryCount} ${categoryCount === 1 ? 'categoría' : 'categorías'}`}>{categoryCount}</span>
          </div>
          <CategoryList
            categories={categories}
            onEdit={setEditingCategory}
            onDelete={onDelete}
          />
        </section>

        <footer className="ui-modal__actions category-modal__actions">
          <button id="close-category-modal-btn" type="button" className="ui-button ui-button--ghost btn btn-cancel" onClick={dismissModal}>
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  );
}
