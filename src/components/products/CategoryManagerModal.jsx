import { useCallback, useEffect, useRef, useState } from 'react';
import { Layers3, Plus } from 'lucide-react';
import CategoryForm from './CategoryForm';
import CategoryList from './CategoryList';
import { useDismissibleHistoryLayer } from '../../hooks/useDismissibleHistoryLayer';
import './CategoryManager.css';
import './CategoryManagerModal.css';

const EMPTY_CATEGORIES = [];

export default function CategoryManagerModal({
  show,
  onClose,
  categories = EMPTY_CATEGORIES,
  onSave,
  onRefresh,
  onDelete,
  selectNewCategoryOnCreate = false,
  onCategoryCreated
}) {
  const [editingCategory, setEditingCategory] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const formRef = useRef(null);
  const dialogRef = useRef(null);
  const createButtonRef = useRef(null);
  const returnFocusRef = useRef(null);

  const openForm = (category = null) => {
    returnFocusRef.current = document.activeElement;
    setEditingCategory(category);
    setFormOpen(true);
    requestAnimationFrame(() => formRef.current?.querySelector('input')?.focus());
  };

  const closeForm = () => {
    setEditingCategory(null);
    setFormOpen(false);
    const target = returnFocusRef.current;
    if (target?.isConnected && target.getClientRects().length > 0) target.focus();
    else createButtonRef.current?.focus();
  };

  const handleDismiss = useCallback(() => {
    setEditingCategory(null);
    setFormOpen(false);
    onClose();
  }, [onClose]);

  const dismissModal = useDismissibleHistoryLayer({
    isOpen: show,
    onDismiss: handleDismiss,
    layerId: 'category-manager-modal'
  });

  useEffect(() => {
    if (!show) return;
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        dismissModal();
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button, input, [tabindex="0"]')]
        .filter((element) => !element.disabled && element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog?.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog?.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [show, dismissModal]);

  if (!show) return null;

  const handleSaveSuccess = (savedCategory) => {
    const isNewCategory = !editingCategory;
    setEditingCategory(null);
    onRefresh?.();
    if (
      selectNewCategoryOnCreate
      && isNewCategory
      && savedCategory?.id
      && savedCategory.success !== false
    ) {
      onCategoryCreated?.(savedCategory);
    }
  };

  const categoryCount = Array.isArray(categories) ? categories.length : 0;

  return (
    <div id="category-modal" className="ui-modal category-modal" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="category-modal-title">
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

        <div className="category-modal__toolbar">
          <span>{categoryCount} {categoryCount === 1 ? 'categoría' : 'categorías'}</span>
          <button type="button" className="category-create-button" ref={createButtonRef}
            aria-expanded={formOpen} aria-controls="category-modal-form" onClick={() => openForm()}>
            <Plus size={17} aria-hidden="true" /> Nueva categoría
          </button>
        </div>
        <div className="category-modal__layout">
          <div id="category-modal-form" ref={formRef} className={`category-modal__form${formOpen ? ' category-modal__form--open' : ''}`}>
            <h3>{editingCategory ? 'Editar categoría' : 'Nueva categoría'}</h3>
            <CategoryForm
              initialData={editingCategory}
              onSave={onSave}
              onSaveSuccess={handleSaveSuccess}
              onCancel={closeForm}
            />
          </div>

          <section className="category-modal__list-section" aria-labelledby="category-modal-list-heading">
            <div className="category-modal__list-header">
              <h3 id="category-modal-list-heading">Categorías existentes</h3>
            </div>
            <CategoryList
              categories={categories}
              onEdit={openForm}
              onDelete={onDelete}
            />
          </section>
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
