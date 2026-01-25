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
  const [useSmallUnit, setUseSmallUnit] = useState(false);

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
    setUseSmallUnit(false);

    const ingredient = availableIngredients.find(i => i.id === id);
    if (ingredient) {
      const baseUnit = ingredient.unit || 'bulk'
        ? (ingredient.bulkData?.purchase?.unit || 'kg')
        : 'pza';
      setUnit(baseUnit);
    } else {
      setUnit('');
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

    let finalQuantity = parseFloat(quantity);
    let finalUnit = unit;
    let contMultiplier = finalQuantity;

    if (useSmallUnit) {
      // Convertir a unidad pequeña según bulkData
      finalQuantity = finalQuantity / 1000;
    }

    const newItem = {
      ingredientId: ingredient.id,
      name: ingredient.name,
      quantity: finalQuantity,
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
              <label>
                Cantidad
                {/* Label dinámico para guiar al usuario */}
                {useSmallUnit ? <small style={{ color: 'green' }}> (en {unit === 'kg' ? 'gramos' : 'mililitros'})</small> : ''}
              </label>
              <input
                type="number"
                className="form-input"
                placeholder="0.00"
                step={useSmallUnit ? "1" : "0.001"} // Pasos enteros para gramos, decimales para kilos
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ flex: 0.8, display: 'flex', flexDirection: 'column' }}>
              <label>Unidad</label>

              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <input
                  type="text"
                  className="form-input"
                  value={unit}
                  disabled // BLOQUEADO: No dejar editar manualmente para evitar errores
                  style={{ backgroundColor: '#f3f4f6', color: '#666', width: '60px' }}
                />

                {/* Solo mostramos el convertidor si es KG o LT */}
                {(unit === 'kg' || unit === 'lt') && (
                  <label className="toggle-switch" style={{ cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={useSmallUnit}
                      onChange={(e) => setUseSmallUnit(e.target.checked)}
                      style={{ marginRight: '4px' }}
                    />
                    <span>Usar {unit === 'kg' ? 'gr' : 'ml'}</span>
                  </label>
                )}
              </div>
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
                recipeItems.map((item, idx) => {
                  // VERIFICACIÓN: ¿Existe el ingrediente en el menú actual?
                  const originalIngredient = menu.find(p => p.id === item.ingredientId);
                  const isMissing = !originalIngredient;

                  return (
                    <tr key={idx} style={{ backgroundColor: isMissing ? '#fff0f0' : 'transparent' }}>
                      <td>
                        {item.name}
                        {isMissing && <span style={{ color: 'red', fontSize: '0.8em', display: 'block' }}>⚠️ (Insumo eliminado)</span>}
                      </td>
                      <td>{item.quantity} {item.unit}</td>
                      <td>
                        {/* Si falta el insumo, el costo estimado no se puede calcular con precisión actualizada */}
                        ${(isMissing ? (item.estimatedCost || 0) : (originalIngredient.cost * item.quantity)).toFixed(2)}
                      </td>
                      <td>
                        <button className="btn-icon-remove" onClick={() => handleRemove(item.ingredientId)}>🗑️</button>
                      </td>
                    </tr>
                  );
                })
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