import { useEffect, useMemo, useState } from 'react';
import { useAvailableIngredients } from '../../hooks/products/useAvailableIngredients';
import { getIngredientDefaultUnit, getRecipeIngredientId } from '../../utils/ingredientConfiguration';
import { roundCurrency, showMessageModal } from '../../services/utils';
import './RecipeBuilderModal.css';

const toMoney = (value) => Number(value || 0).toFixed(2);

export default function RecipeBuilderModal({ show, onClose, existingRecipe, onSave, productName }) {
  const { ingredients, isLoading, error, refresh } = useAvailableIngredients({ enabled: show });
  const ingredientsById = useMemo(() => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])), [ingredients]);
  const [recipeItems, setRecipeItems] = useState([]);
  const [selectedIngredientId, setSelectedIngredientId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [useSmallUnit, setUseSmallUnit] = useState(false);

  const resetInput = () => {
    setSelectedIngredientId('');
    setQuantity('');
    setUnit('');
    setUseSmallUnit(false);
  };

  useEffect(() => {
    if (!show) return;
    setRecipeItems(existingRecipe || []);
    resetInput();
  }, [show, existingRecipe]);

  const handleIngredientSelect = (event) => {
    const id = event.target.value;
    setSelectedIngredientId(id);
    setUseSmallUnit(false);
    setUnit(id ? getIngredientDefaultUnit(ingredientsById.get(id)) : '');
  };

  const handleAdd = () => {
    if (!selectedIngredientId || Number(quantity) <= 0) {
      showMessageModal('Selecciona un ingrediente y una cantidad válida.', null, { type: 'warning' });
      return;
    }
    const ingredient = ingredientsById.get(selectedIngredientId);
    if (!ingredient) return;
    if (recipeItems.some((item) => getRecipeIngredientId(item) === selectedIngredientId)) {
      showMessageModal('Este ingrediente ya está en la receta. Elimínalo para editarlo.', null, { type: 'warning' });
      return;
    }
    const enteredQuantity = Number(quantity);
    const finalQuantity = useSmallUnit ? enteredQuantity / 1000 : enteredQuantity;
    setRecipeItems((items) => [...items, {
      ingredientId: ingredient.id,
      name: ingredient.name,
      quantity: finalQuantity,
      unit,
      estimatedCost: roundCurrency(Number(ingredient.cost || 0) * finalQuantity)
    }]);
    resetInput();
  };

  const totalEstimatedCost = recipeItems.reduce((sum, item) => {
    const ingredient = ingredientsById.get(getRecipeIngredientId(item));
    return sum + (ingredient
      ? roundCurrency(Number(ingredient.cost || 0) * Number(item.quantity || 0))
      : Number(item.estimatedCost || 0));
  }, 0);

  if (!show) return null;

  return <div className="modal" style={{ display: 'flex', zIndex: 'var(--z-modal-overlay)' }}>
    <div className="modal-content recipe-modal">
      <h2 className="modal-title">Construir receta</h2>
      <p className="modal-subtitle">Producto: <strong>{productName || 'Nuevo producto'}</strong></p>

      {isLoading ? <div className="warning-box">Cargando insumos...</div> : error ? <div className="warning-box">No se pudieron cargar los insumos. Intenta nuevamente. <button type="button" className="btn btn-secondary" onClick={refresh}>Reintentar</button></div> : ingredients.length === 0 ? <div className="warning-box">No hay insumos activos disponibles. Crea un insumo para comenzar una receta.</div> : <div className="recipe-input-group">
        <div className="form-group" style={{ flex: 2 }}>
          <label>Ingrediente</label>
          <select className="form-input" value={selectedIngredientId} onChange={handleIngredientSelect}>
            <option value="">-- Seleccionar --</option>
            {ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name} — Stock: {ingredient.stock ?? 0} — Costo: ${toMoney(ingredient.cost)}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>Cantidad {useSmallUnit && <small className="recipe-unit-helper">(en {unit === 'kg' ? 'gramos' : 'mililitros'})</small>}</label>
          <input type="number" className="form-input" placeholder="0.00" min="0" step={useSmallUnit ? '1' : '0.001'} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 0.8, display: 'flex', flexDirection: 'column' }}>
          <label>Unidad</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <input type="text" className="form-input recipe-unit-input" value={unit} disabled />
            {(unit === 'kg' || unit === 'lt') && <label className="toggle-switch recipe-small-unit-toggle"><input type="checkbox" checked={useSmallUnit} onChange={(event) => setUseSmallUnit(event.target.checked)} style={{ marginRight: '4px' }} /><span>Usar {unit === 'kg' ? 'gr' : 'ml'}</span></label>}
          </div>
        </div>
        <button type="button" className="btn btn-add-ing" onClick={handleAdd}>+</button>
      </div>}

      <div className="recipe-list-container"><table className="recipe-table"><thead><tr><th>Ingrediente</th><th>Cantidad</th><th>Costo Est.</th><th>Acción</th></tr></thead><tbody>
        {recipeItems.length === 0 ? <tr><td colSpan="4" className="recipe-empty-cell">Sin ingredientes asignados</td></tr> : recipeItems.map((item, index) => {
          const ingredientId = getRecipeIngredientId(item);
          const ingredient = ingredientsById.get(ingredientId);
          const isMissing = !ingredient;
          const estimatedCost = ingredient ? Number(ingredient.cost || 0) * Number(item.quantity || 0) : Number(item.estimatedCost || 0);
          return <tr key={ingredientId || index} className={isMissing ? 'recipe-row-missing' : ''}><td>{item.name}{isMissing && <span className="recipe-missing-label">Insumo eliminado</span>}</td><td>{item.quantity} {item.unit}</td><td>${toMoney(estimatedCost)}</td><td><button type="button" className="btn-icon-remove" onClick={() => setRecipeItems((items) => items.filter((candidate) => getRecipeIngredientId(candidate) !== ingredientId))} aria-label="Eliminar ingrediente">×</button></td></tr>;
        })}
      </tbody></table></div>
      <div className="recipe-footer"><div className="recipe-total">Costo teórico total: <span>${toMoney(totalEstimatedCost)}</span></div><div className="recipe-actions"><button type="button" className="btn btn-cancel" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-save" onClick={() => { onSave(recipeItems); onClose(); }}>Guardar receta</button></div></div>
    </div>
  </div>;
}
