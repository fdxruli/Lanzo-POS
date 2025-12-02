import React, { useState, useEffect, useMemo } from 'react';
// --- CAMBIO: Usamos useProductStore en lugar de useDashboardStore ---
import { useProductStore } from '../../store/useProductStore';
import { roundCurrency } from '../../services/utils';
import './RecipeBuilderModal.css';

export default function RecipeBuilderModal({ show, onClose, existingRecipe, onSave, productName }) {

  // 1. OBTENER MENÚ DEL STORE CORRECTO
  // 'menu' contiene los productos con el Stock y Costo ya calculados.
  const menu = useProductStore((state) => state.menu);

  // 2. FILTRAR INGREDIENTES
  // Filtramos sobre 'menu' para obtener solo los insumos activos
  const availableIngredients = useMemo(() => {
    return menu.filter(p => p.productType === 'ingredient' && p.isActive !== false);
  }, [menu]); 

  // Estado local de la receta
  const [recipeItems, setRecipeItems] = useState([]);

  // Estado del formulario de ingreso
  const [selectedIngredientId, setSelectedIngredientId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');

  // Cargar receta existente al abrir
  useEffect(() => {
    if (show) {
      setRecipeItems(existingRecipe || []);
      resetInput();
    }
  }, [show, existingRecipe]);

  const resetInput = () => {
    setSelectedIngredientId('');
    setQuantity('');
    setUnit('');
  };

  const handleIngredientSelect = (e) => {
    const id = e.target.value;
    setSelectedIngredientId(id);

    const ingredient = availableIngredients.find(i => i.id === id);
    if (ingredient && ingredient.saleType === 'bulk') {
      setUnit(ingredient.bulkData?.purchase?.unit || 'kg');
    } else {
      setUnit('pza');
    }
  };

  const handleAdd = () => {
    if (!selectedIngredientId || !quantity || parseFloat(quantity) <= 0) {
      alert('Selecciona un ingrediente y una cantidad válida.');
      return;
    }

    const ingredient = availableIngredients.find(i => i.id === selectedIngredientId);
    if (!ingredient) return;

    if (recipeItems.some(item => item.ingredientId === selectedIngredientId)) {
      alert('Este ingrediente ya está en la receta. Elimínalo para editarlo.');
      return;
    }

    // Usamos el costo actual del ingrediente (que viene del lote activo en 'menu')
    const currentCost = ingredient.cost || 0;

    const newItem = {
      ingredientId: ingredient.id,
      name: ingredient.name,
      quantity: parseFloat(quantity),
      unit: unit,
      estimatedCost: roundCurrency(currentCost * parseFloat(quantity))
    };

    setRecipeItems([...recipeItems, newItem]);
    resetInput();
  };

  const handleRemove = (id) => {
    setRecipeItems(recipeItems.filter(item => item.ingredientId !== id));
  };

  const handleSave = () => {
    onSave(recipeItems);
    onClose();
  };

  // Calcular costo teórico total visual
  const totalEstimatedCost = recipeItems.reduce((sum, item) => {
    // Buscamos en 'menu' para tener el costo actualizado al momento
    const ing = menu.find(p => p.id === item.ingredientId);
    const unitCost = ing?.cost || 0;
    return sum + roundCurrency(unitCost * item.quantity);
  }, 0);

  if (!show) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 2200 }}>
      <div className="modal-content recipe-modal">
        <h2 className="modal-title">Construir Receta</h2>
        <p className="modal-subtitle">Producto: <strong>{productName || 'Nuevo Producto'}</strong></p>

        {availableIngredients.length === 0 ? (
          <div className="warning-box">
            ⚠️ No tienes productos marcados como "Ingrediente" o no se han cargado los lotes. <br />
            Asegúrate de haber creado Insumos y haber registrado su stock inicial.
          </div>
        ) : (
          <div className="recipe-input-group">
            <div className="form-group" style={{ flex: 2 }}>
              <label>Ingrediente</label>
              <select
                className="form-input"
                value={selectedIngredientId}
                onChange={handleIngredientSelect}
              >
                <option value="">-- Seleccionar --</option>
                {availableIngredients.map(ing => (
                  <option key={ing.id} value={ing.id}>
                    {ing.name} (Stock: {ing.stock || 0} | ${ing.cost?.toFixed(2)})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ flex: 1 }}>
              <label>Cantidad</label>
              <input
                type="number"
                className="form-input"
                placeholder="0.00"
                step="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ flex: 0.8 }}>
              <label>Unidad</label>
              <input
                type="text"
                className="form-input"
                placeholder="kg/lt"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>

            <button type="button" className="btn btn-add-ing" onClick={handleAdd}>+</button>
          </div>
        )}

        <div className="recipe-list-container">
          <table className="recipe-table">
            <thead>
              <tr>
                <th>Ingrediente</th>
                <th>Cantidad</th>
                <th>Costo Est.</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {recipeItems.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', color: '#999' }}>
                    Sin ingredientes asignados
                  </td>
                </tr>
              ) : (
                recipeItems.map((item, idx) => (
                  <tr key={idx}>
                    <td>{item.name}</td>
                    <td>{item.quantity} {item.unit}</td>
                    <td>${(item.estimatedCost || 0).toFixed(2)}</td>
                    <td>
                      <button className="btn-icon-remove" onClick={() => handleRemove(item.ingredientId)}>🗑️</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="recipe-footer">
          <div className="recipe-total">
            Costo Teórico Total: <span>${totalEstimatedCost.toFixed(2)}</span>
          </div>
          <div className="recipe-actions">
            <button className="btn btn-cancel" onClick={onClose}>Cancelar</button>
            <button className="btn btn-save" onClick={handleSave}>Guardar Receta</button>
          </div>
        </div>

      </div>
    </div>
  );
}