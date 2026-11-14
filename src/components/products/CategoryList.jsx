import { useEffect, useId, useMemo, useState } from 'react';
import { Pencil, Search, Tag, Trash2, X } from 'lucide-react';
import { productRepository } from '../../services/products/productRepository';
import { useAppStore } from '../../store/useAppStore';
import './CategoryList.css';

const EMPTY_CATEGORIES = [];

const normalizeCategorySearch = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const getProductCountLabel = (count, localOnly) => {
  if (localOnly) return count === 0 ? 'Sin productos registrados aquí' : `${count} ${count === 1 ? 'producto' : 'productos'} en este dispositivo`;
  if (count === 0) return 'Sin productos';
  return `${count} ${count === 1 ? 'producto' : 'productos'}`;
};

export default function CategoryList({ categories, onEdit, onDelete }) {
  const searchId = useId();
  const [searchQuery, setSearchQuery] = useState('');
  const [productCounts, setProductCounts] = useState(null);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const safeCategories = Array.isArray(categories) ? categories : EMPTY_CATEGORIES;
  const categoryIds = useMemo(() => safeCategories.map((category) => category.id).filter(Boolean), [safeCategories]);

  useEffect(() => {
    let isCurrent = true;

    if (categoryIds.length === 0) {
      setProductCounts({});
      return () => { isCurrent = false; };
    }

    setProductCounts(null);
    productRepository.getCategoryProductCounts(categoryIds)
      .then((result) => {
        if (!isCurrent) return;
        setProductCounts(result?.counts && (result.complete === true || result.source === 'local')
          ? { ...result, categoryIds, licenseDetails } : null);
      })
      .catch(() => {
        if (isCurrent) setProductCounts(null);
      });

    return () => { isCurrent = false; };
  }, [categoryIds, licenseDetails]);

  const sortedCategories = useMemo(() => [...safeCategories].sort((left, right) => (
    (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0)
  )), [safeCategories]);

  const filteredCategories = useMemo(() => {
    const normalizedQuery = normalizeCategorySearch(searchQuery);
    if (!normalizedQuery) return sortedCategories;
    return sortedCategories.filter((category) => (
      normalizeCategorySearch(category.name).includes(normalizedQuery)
    ));
  }, [searchQuery, sortedCategories]);

  const getCount = (categoryId) => {
    const currentCounts = productCounts?.categoryIds === categoryIds && productCounts?.licenseDetails === licenseDetails
      ? productCounts.counts : null;
    const count = currentCounts?.[categoryId];
    return Number.isInteger(count) && count >= 0 ? count : null;
  };

  return (
    <div className="category-admin-list">
      <div className="category-search-control">
        <label className="category-search-field" htmlFor={searchId}>
          <Search size={17} aria-hidden="true" />
          <input
            id={searchId}
            type="text"
            value={searchQuery}
            placeholder="Buscar categoría..."
            aria-label="Buscar categoría"
            autoComplete="off"
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        {searchQuery && (
          <button
            type="button"
            className="category-search-clear"
            onClick={() => setSearchQuery('')}
            aria-label="Limpiar búsqueda"
            title="Limpiar búsqueda"
          >
            <X size={17} />
          </button>
        )}
      </div>

      {safeCategories.length === 0 ? (
        <div className="category-list-empty" role="status">
          <Tag size={21} aria-hidden="true" />
          <strong>No hay categorías creadas.</strong>
          <span>Crea una categoría para organizar tus productos.</span>
        </div>
      ) : filteredCategories.length === 0 ? (
        <p className="category-list-no-results" role="status">
          No hay resultados para «{searchQuery.trim()}».
        </p>
      ) : (
        <div className="category-admin-rows" role="list" aria-label="Categorías">
          {filteredCategories.map((category) => {
            const productCount = getCount(category.id);
            return (
              <article className="category-admin-row" key={category.id} role="listitem">
                <span
                  className="category-admin-color"
                  style={{ backgroundColor: category.color || 'var(--ui-color-primary)' }}
                  aria-hidden="true"
                />
                <div className="category-admin-copy">
                  <h4>{category.name}</h4>
                  {productCount !== null && (
                    <span className="category-admin-product-count">{getProductCountLabel(productCount, productCounts?.complete !== true)}</span>
                  )}
                </div>
                <div className="category-admin-actions">
                  <button
                    type="button"
                    className="category-admin-action category-admin-action--edit"
                    onClick={() => onEdit?.(category)}
                    aria-label={`Editar ${category.name}`}
                    title="Editar"
                  >
                    <Pencil size={17} />
                  </button>
                  <button
                    type="button"
                    className="category-admin-action category-admin-action--delete"
                    onClick={() => onDelete?.(category, productCounts?.complete === true ? productCount : null)}
                    aria-label={`Eliminar ${category.name}`}
                    title="Eliminar"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
