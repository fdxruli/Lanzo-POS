import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useAvailableIngredients } from '../../hooks/products/useAvailableIngredients';
import { getIngredientDefaultUnit, getRecipeIngredientId } from '../../utils/ingredientConfiguration';
import { roundCurrency, showMessageModal } from '../../services/utils';
import './RecipeBuilderModal.css';

const toMoney = (value) => Number(value || 0).toFixed(2);
const normalizeSearch = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('es')
  .trim();
const INITIAL_VISIBLE = 30;

export default function RecipeBuilderModal({
  show, onClose, existingRecipe, onSave, productName, categories = []
}) {
  const { ingredients, isLoading, error, refresh } = useAvailableIngredients({ enabled: show });
  const ingredientsById = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
    [ingredients]
  );
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [String(category.id), category.name])),
    [categories]
  );
  const availableCategories = useMemo(() => {
    const ids = new Set(ingredients.map((ingredient) => String(ingredient.categoryId || ingredient.category_id || '')).filter(Boolean));
    return categories.filter((category) => ids.has(String(category.id)) && category.isActive !== false)
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'es'));
  }, [categories, ingredients]);
  const hasUncategorized = ingredients.some((ingredient) => !ingredient.categoryId && !ingredient.category_id);

  const dialogRef = useRef(null);
  const [recipeItems, setRecipeItems] = useState([]);
  const [selectedIngredientId, setSelectedIngredientId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [useSmallUnit, setUseSmallUnit] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!show) return;
    setRecipeItems(existingRecipe || []);
    setSelectedIngredientId('');
    setQuantity('');
    setUseSmallUnit(false);
    setSearch('');
    setCategoryFilter('all');
    setVisibleCount(INITIAL_VISIBLE);
    setNotice('');
  }, [show, existingRecipe]);

  useEffect(() => {
    if (!show) return undefined;
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector('.recipe-close')?.focus();
    return () => { previousFocus?.focus?.(); };
  }, [show]);

  const selectedIngredient = ingredientsById.get(selectedIngredientId);
  const selectedItem = recipeItems.find((item) => getRecipeIngredientId(item) === selectedIngredientId);
  const unit = selectedIngredient ? getIngredientDefaultUnit(selectedIngredient) : '';

  const selectIngredient = (id) => {
    const ingredient = ingredientsById.get(id);
    if (!ingredient) return;
    const existing = recipeItems.find((item) => getRecipeIngredientId(item) === id);
    setSelectedIngredientId(id);
    setQuantity(existing ? String(existing.quantity) : '');
    setUseSmallUnit(false);
    setNotice('');
  };

  const handleSmallUnitChange = (nextSmallUnit) => {
    if (quantity !== '' && Number.isFinite(Number(quantity))) {
      const nextQuantity = nextSmallUnit ? Number(quantity) * 1000 : Number(quantity) / 1000;
      setQuantity(String(Number(nextQuantity.toPrecision(12))));
    }
    setUseSmallUnit(nextSmallUnit);
  };

  const handleAdd = () => {
    const parsedQuantity = Number(quantity);
    if (!selectedIngredient || !quantity.trim() || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      showMessageModal('Selecciona un insumo e indica una cantidad mayor que cero.', null, { type: 'warning' });
      return;
    }
    const finalQuantity = useSmallUnit ? parsedQuantity / 1000 : parsedQuantity;
    if (!Number.isFinite(finalQuantity) || finalQuantity <= 0) return;
    const nextItem = {
      ingredientId: selectedIngredient.id,
      name: selectedIngredient.name,
      quantity: finalQuantity,
      unit,
      estimatedCost: roundCurrency(Number(selectedIngredient.cost || 0) * finalQuantity)
    };
    setRecipeItems((items) => {
      const index = items.findIndex((item) => getRecipeIngredientId(item) === selectedIngredient.id);
      if (index < 0) return [...items, nextItem];
      return items.map((item, position) => position === index ? nextItem : item);
    });
    setNotice((selectedItem ? 'Actualizado: ' : 'Agregado: ') + selectedIngredient.name);
    setSelectedIngredientId('');
    setQuantity('');
    setUseSmallUnit(false);
  };

  const invalidItems = recipeItems.filter((item) => {
    const ingredient = ingredientsById.get(getRecipeIngredientId(item));
    return !ingredient || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0
      || (item.unit && getIngredientDefaultUnit(ingredient) !== item.unit);
  });

  const totalEstimatedCost = recipeItems.reduce((sum, item) => {
    const ingredient = ingredientsById.get(getRecipeIngredientId(item));
    return sum + (ingredient
      ? roundCurrency(Number(ingredient.cost || 0) * Number(item.quantity || 0))
      : Number(item.estimatedCost || 0));
  }, 0);

  const filteredIngredients = useMemo(() => {
    const words = normalizeSearch(search).split(/\s+/).filter(Boolean);
    return ingredients.filter((ingredient) => {
      const id = String(ingredient.categoryId || ingredient.category_id || '');
      if (categoryFilter === 'uncategorized' && id) return false;
      if (categoryFilter !== 'all' && categoryFilter !== 'uncategorized' && categoryFilter !== id) return false;
      const categoryName = categoriesById.get(id) || '';
      const haystack = normalizeSearch([
        ingredient.name, ingredient.barcode, ingredient.sku, categoryName
      ].filter(Boolean).join(' '));
      return words.every((word) => haystack.includes(word));
    });
  }, [ingredients, search, categoryFilter, categoriesById]);

  const updateSearch = (next) => {
    setSearch(next);
    setVisibleCount(INITIAL_VISIBLE);
  };
  const updateCategory = (next) => {
    setCategoryFilter(next);
    setVisibleCount(INITIAL_VISIBLE);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Tab' && dialogRef.current) {
      const focusable = Array.from(dialogRef.current.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled)'
      ));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
    // The recipe builder is nested in the product form: Enter must not submit the product.
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') {
      event.preventDefault();
      if (event.target.id === 'recipe-quantity') handleAdd();
    }
  };

  if (!show) return null;

  return <div className="modal recipe-modal-overlay" style={{ display: 'flex', zIndex: 'var(--z-modal-overlay)' }}>
    <section ref={dialogRef} className="modal-content recipe-modal" role="dialog" aria-modal="true" aria-labelledby="recipe-modal-title" onKeyDown={handleKeyDown}>
      <header className="recipe-header">
        <div>
          <h2 id="recipe-modal-title">Construir receta</h2>
          <p>Producto: <strong>{productName || 'Nuevo producto'}</strong></p>
        </div>
        <button type="button" className="recipe-close" onClick={onClose} aria-label="Cerrar constructor de recetas"><X size={20} aria-hidden="true" /></button>
      </header>

      <div className="recipe-workspace">
        <section className="recipe-browser" aria-labelledby="recipe-browser-title">
          <div className="recipe-section-heading">
            <h3 id="recipe-browser-title">Explorar insumos</h3>
            <span>{ingredients.length} disponibles</span>
          </div>
          <div className="recipe-discovery">
            <label htmlFor="recipe-search">Buscar insumo</label>
            <div className="recipe-search-field">
              <Search size={18} aria-hidden="true" />
              <input id="recipe-search" type="search" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Nombre, parte del nombre o código" autoComplete="off" />
            </div>
            <label htmlFor="recipe-category">Explorar por categoría</label>
            <select id="recipe-category" value={categoryFilter} onChange={(event) => updateCategory(event.target.value)}>
              <option value="all">Todas las categorías</option>
              {availableCategories.map((category) => <option key={category.id} value={String(category.id)}>{category.name}</option>)}
              {hasUncategorized && <option value="uncategorized">Sin categoría</option>}
            </select>
          </div>
          {isLoading ? <div className="recipe-feedback" role="status">Cargando insumos...</div>
            : error ? <div className="recipe-feedback" role="alert">No se pudieron cargar los insumos. Intenta nuevamente. <button type="button" onClick={refresh}>Reintentar</button></div>
              : ingredients.length === 0 ? <div className="recipe-feedback">No hay insumos activos disponibles. Crea un insumo para comenzar una receta.</div>
                : <>
                  <p className="recipe-results-count" aria-live="polite">{filteredIngredients.length} {filteredIngredients.length === 1 ? 'resultado' : 'resultados'} · Orden alfabético</p>
                  <div className="recipe-results" aria-label="Lista de insumos">
                    {filteredIngredients.length === 0 ? <p className="recipe-no-results">No hay coincidencias. Prueba otra palabra o selecciona todas las categorías.</p> : <>
                      {filteredIngredients.slice(0, visibleCount).map((ingredient) => {
                        const ingredientUnit = getIngredientDefaultUnit(ingredient);
                        const inRecipe = recipeItems.some((item) => getRecipeIngredientId(item) === ingredient.id);
                        return <button key={ingredient.id} type="button" className={'recipe-result' + (selectedIngredientId === ingredient.id ? ' is-selected' : '')} aria-pressed={selectedIngredientId === ingredient.id} onClick={() => selectIngredient(ingredient.id)}>
                          <span className="recipe-result-main"><strong>{ingredient.name}</strong>{inRecipe && <span className="recipe-included"><Check size={13} aria-hidden="true" /> En receta</span>}</span>
                          <span className="recipe-result-meta">Stock: {ingredient.stock ?? 0} {ingredientUnit} · Costo: {'$' + toMoney(ingredient.cost)}/{ingredientUnit}</span>
                          {categoriesById.get(String(ingredient.categoryId || ingredient.category_id || '')) && <span className="recipe-result-category">{categoriesById.get(String(ingredient.categoryId || ingredient.category_id || ''))}</span>}
                        </button>;
                      })}
                      {filteredIngredients.length > visibleCount && <button type="button" className="recipe-load-more" onClick={() => setVisibleCount((count) => count + INITIAL_VISIBLE)}>Ver más insumos ({filteredIngredients.length - visibleCount} restantes)</button>}
                    </>}
                  </div>
                </>}
        </section>

        <div className="recipe-details">
          <section className="recipe-editor" aria-labelledby="recipe-editor-title">
            <div className="recipe-section-heading"><h3 id="recipe-editor-title">{selectedItem ? 'Editar cantidad' : 'Agregar a la receta'}</h3></div>
            {selectedIngredient ? <p className="recipe-selected-name">{selectedIngredient.name}</p> : <p className="recipe-select-hint">Selecciona un insumo de la lista para indicar su cantidad.</p>}
            <div className="recipe-quantity-grid">
              <div className="recipe-field">
                <label htmlFor="recipe-quantity">Cantidad{useSmallUnit ? (unit === 'kg' ? ' (gramos)' : ' (mililitros)') : ''}</label>
                <input id="recipe-quantity" type="number" inputMode="decimal" min="0" step={useSmallUnit ? '1' : '0.001'} placeholder="0.00" value={quantity} disabled={!selectedIngredient} onChange={(event) => setQuantity(event.target.value)} />
              </div>
              <div className="recipe-field">
                <label htmlFor="recipe-unit">Unidad</label>
                <input id="recipe-unit" type="text" value={useSmallUnit ? (unit === 'kg' ? 'g' : 'ml') : unit} disabled readOnly />
              </div>
            </div>
            {selectedIngredient && (unit === 'kg' || unit === 'lt') && <label className="recipe-small-unit"><input type="checkbox" checked={useSmallUnit} onChange={(event) => handleSmallUnitChange(event.target.checked)} /> Capturar en {unit === 'kg' ? 'gramos (g)' : 'mililitros (ml)'}</label>}
            <button type="button" className="recipe-add-button" disabled={!selectedIngredient || isLoading || Boolean(error)} onClick={handleAdd}><Plus size={18} aria-hidden="true" />{selectedItem ? 'Actualizar ingrediente' : 'Agregar ingrediente'}</button>
            <p className="recipe-action-notice" role="status" aria-live="polite">{notice}</p>
          </section>

          <section className="recipe-current" aria-labelledby="recipe-current-title">
            <div className="recipe-section-heading"><h3 id="recipe-current-title">Receta actual</h3><span>{recipeItems.length} {recipeItems.length === 1 ? 'ingrediente' : 'ingredientes'}</span></div>
            {recipeItems.length === 0 ? <p className="recipe-empty">Todavía no agregas ingredientes.</p> : <ul className="recipe-items">
              {recipeItems.map((item, index) => {
                const ingredientId = getRecipeIngredientId(item);
                const ingredient = ingredientsById.get(ingredientId);
                const isMissing = !ingredient;
                const estimatedCost = ingredient ? Number(ingredient.cost || 0) * Number(item.quantity || 0) : Number(item.estimatedCost || 0);
                return <li className={'recipe-item' + (isMissing ? ' recipe-item--invalid' : '')} key={ingredientId || index}>
                  <div className="recipe-item-main">
                    <strong>{item.name || ingredient?.name || 'Insumo desconocido'}</strong>
                    {isMissing && <span className="recipe-missing-label">Insumo eliminado o no disponible</span>}
                    <span>{item.quantity} {item.unit} · {'$' + toMoney(estimatedCost)}</span>
                  </div>
                  <div className="recipe-item-actions">
                    {!isMissing && <button type="button" onClick={() => selectIngredient(ingredientId)} aria-label={'Editar ' + (item.name || ingredient.name)}><Pencil size={17} aria-hidden="true" /></button>}
                    <button type="button" className="recipe-remove" onClick={() => {
                      setRecipeItems((items) => items.filter((candidate) => getRecipeIngredientId(candidate) !== ingredientId));
                      if (selectedIngredientId === ingredientId) {
                        setSelectedIngredientId('');
                        setQuantity('');
                        setUseSmallUnit(false);
                      }
                    }} aria-label={'Eliminar ' + (item.name || ingredient?.name || 'ingrediente')}><Trash2 size={17} aria-hidden="true" /></button>
                  </div>
                </li>;
              })}
            </ul>}
          </section>
        </div>
      </div>

      <footer className="recipe-footer">
        <div className="recipe-total"><span>Costo teórico total</span><strong>{'$' + toMoney(totalEstimatedCost)}</strong></div>
        <div className="recipe-actions">
          <button type="button" className="recipe-cancel" onClick={onClose}>Cancelar</button>
          <button type="button" className="recipe-save" disabled={isLoading || Boolean(error) || invalidItems.length > 0} onClick={() => { onSave(recipeItems); onClose(); }}>Guardar receta</button>
        </div>
        <p className="recipe-save-hint">Guarda también el producto para conservar la receta.</p>
      </footer>
    </section>
  </div>;
}
