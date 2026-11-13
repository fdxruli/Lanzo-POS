import { useState } from 'react';
import { Layers3, Pencil, Plus } from 'lucide-react';
import CategoryForm from './CategoryForm';
import CategoryList from './CategoryList';
import './CategoryManager.css';

const EMPTY_CATEGORIES = [];

export default function CategoryManager({ categories = EMPTY_CATEGORIES, onSave, onRefresh, onDelete }) {
  const [editingCategory, setEditingCategory] = useState(null);
  const categoryCount = Array.isArray(categories) ? categories.length : 0;

  const handleSaveSuccess = () => {
    setEditingCategory(null);
    onRefresh?.();
  };

  return (
    <section className="category-manager-container" aria-label="Gestión de categorías">
      <header className="category-manager-header">
        <div className="category-title-group">
          <span className="category-kicker">
            <Layers3 size={15} aria-hidden="true" />
            Productos
          </span>
          <div>
            <h2>Categorías</h2>
            <p>Organiza tus productos para encontrarlos más rápido.</p>
          </div>
        </div>
        <div className="category-status-pill" aria-label={`${categoryCount} ${categoryCount === 1 ? 'categoría' : 'categorías'}`}>
          {categoryCount} {categoryCount === 1 ? 'categoría' : 'categorías'}
        </div>
      </header>

      <div className="category-manager-layout">
        <aside className="category-form-section">
          <div className="category-section-heading">
            <span className="category-section-icon" aria-hidden="true">
              {editingCategory ? <Pencil size={17} /> : <Plus size={17} />}
            </span>
            <div>
              <h3>{editingCategory ? 'Editar categoría' : 'Nueva categoría'}</h3>
              {editingCategory && <p>{editingCategory.name}</p>}
            </div>
          </div>

          <CategoryForm
            initialData={editingCategory}
            onSave={onSave}
            onSaveSuccess={handleSaveSuccess}
            onCancel={editingCategory ? () => setEditingCategory(null) : null}
          />
        </aside>

        <section className="category-list-section" aria-labelledby="category-list-heading">
          <div className="category-list-header">
            <div>
              <h3 id="category-list-heading">Categorías existentes</h3>
            </div>
            <span className="category-list-count" aria-hidden="true">{categoryCount}</span>
          </div>
          <div className="category-list-body">
            <CategoryList
              categories={categories}
              onEdit={setEditingCategory}
              onDelete={onDelete}
            />
          </div>
        </section>
      </div>
    </section>
  );
}
