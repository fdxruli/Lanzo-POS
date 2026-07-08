import { useState } from 'react';
import { Layers3, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import CategoryForm from './CategoryForm';
import './CategoryManager.css';

export default function CategoryManager({ categories, onSave, onRefresh, onDelete }) {
  const [editingCategory, setEditingCategory] = useState(null);
  const sortedCategories = categories.toSorted((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));

  const handleSaveSuccess = () => {
    setEditingCategory(null);
    onRefresh();
  };

  return (
    <section className="category-manager-container" aria-label="Gestion de categorias">
      <div className="category-manager-header">
        <div className="category-title-group">
          <span className="category-kicker">
            <Layers3 size={15} />
            Categorias
          </span>
          <div>
            <h2>Organizacion del catalogo</h2>
            <p>Ordena la produccion y el punto de venta por grupos claros.</p>
          </div>
        </div>

        <div className="category-status-pill">
          {categories.length} categoria{categories.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="category-manager-layout">
        <aside className="category-form-section">
          <div className="category-section-heading">
            <span className="category-section-icon" aria-hidden="true">
              {editingCategory ? <Pencil size={17} /> : <Plus size={17} />}
            </span>
            <div>
              <h3>{editingCategory ? 'Editar categoria' : 'Nueva categoria'}</h3>
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

        <div className="category-list-section">
          <div className="category-list-header">
            <div>
              <h3>Categorias existentes</h3>
              <p>{sortedCategories.length > 0 ? 'Ordenadas por prioridad visual.' : 'Crea la primera categoria para organizar tus productos.'}</p>
            </div>
          </div>

          {sortedCategories.length === 0 ? (
            <div className="category-empty-state">
              <Tag size={42} />
              <strong>Sin categorias creadas</strong>
              <span>Agrega una categoria para empezar a clasificar productos.</span>
            </div>
          ) : (
            <div className="category-list-grid">
              {sortedCategories.map((cat) => (
                <article key={cat.id} className="category-card-item">
                  <span
                    className="category-color-swatch"
                    style={{ backgroundColor: cat.color || 'var(--ui-color-primary)' }}
                    aria-hidden="true"
                  />

                  <div className="category-card-copy">
                    <h4 className="category-name">{cat.name}</h4>
                    <span className="category-sort-order">Orden {Number(cat.sortOrder) || 0}</span>
                  </div>

                  <div className="category-actions">
                    <button
                      type="button"
                      className="category-icon-button edit"
                      onClick={() => setEditingCategory(cat)}
                      title="Editar"
                      aria-label={`Editar ${cat.name}`}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="category-icon-button delete"
                      onClick={() => onDelete(cat.id)}
                      title="Eliminar"
                      aria-label={`Eliminar ${cat.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
