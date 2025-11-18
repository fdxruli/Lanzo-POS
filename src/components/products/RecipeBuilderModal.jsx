// src/components/products/RecipeBuilderModal.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useDashboardStore } from '../../store/useDashboardStore';
import './RecipeBuilderModal.css';

export default function RecipeBuilderModal({ show, onClose, existingRecipe, onSave, productName }) {
  
  // 1. Conectamos al store para obtener los INGREDIENTES reales
  const rawProducts = useDashboardStore((state) => state.rawProducts);
  
  // 2. Filtramos solo los que son 'insumos/ingredientes'
  // (Estos son los que creaste en ProductForm con el tipo 'ingredient')
  const availableIngredients = useMemo(() => {
    return rawProducts.filter(p => p.productType === 'ingredient' && p.isActive !== false);
  }, [rawProducts]);

  // Estado local de la receta
  const [recipeItems, setRecipeItems] = useState([]);
  
  // Estado del formulario de ingreso
  const [selectedIngredientId, setSelectedIngredientId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState(''); // Ej: kg, gr, ml, pza

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

  // Seleccionar un ingrediente rellena la unidad por defecto si existe
  const handleIngredientSelect = (e) => {
    const id = e.target.value;
    setSelectedIngredientId(id);
    
    const ingredient = availableIngredients.find(i => i.id === id);
    if (ingredient && ingredient.saleType === 'bulk') {
       // Intentamos adivinar la unidad basada en el ingrediente
       // (Si guardaste 'unit' en bulkData, úsalo. Si no, default 'kg')
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

    // Verificar si ya está en la receta
    if (recipeItems.some(item => item.ingredientId === selectedIngredientId)) {
      alert('Este ingrediente ya está en la receta. Elimínalo para editarlo.');
      return;
    }

    // Añadir a la lista
    const newItem = {
      ingredientId: ingredient.id,
      name: ingredient.name,
      quantity: parseFloat(quantity),
      unit: unit,
      // Guardamos un "costo estimado" solo como referencia visual
      // El costo real se calculará al momento de la venta (FIFO)
      estimatedCost: (ingredient.batchManagement?.lastCost || 0) * parseFloat(quantity)
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

  // Calcular costo teórico total
  const totalEstimatedCost = recipeItems.reduce((sum, item) => {
    // Buscamos el costo más actual del ingrediente
    const ing = rawProducts.find(p => p.id === item.ingredientId);
    // Nota: Esto asume que tienes un campo 'cost' o usas el de batchManagement
    // Si usas el sistema de lotes puro, podrías necesitar una lógica para obtener el "costo promedio"
    const unitCost = ing?.cost || 0; 
    return sum + (unitCost * item.quantity);
  }, 0);

  if (!show) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 2200 }}>
      <div className="modal-content recipe-modal">
        <h2 className="modal-title">Construir Receta</h2>
        <p className="modal-subtitle">Producto: <strong>{productName || 'Nuevo Producto'}</strong></p>
        
        {availableIngredients.length === 0 ? (
          <div className="warning-box">
            ⚠️ No tienes productos marcados como "Ingrediente". <br/>
            Ve a "Añadir Producto", crea uno (ej. Harina) y selecciona "Ingrediente (Insumo)".
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
                    {ing.name} (Stock: {ing.stock || 0})
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

            <button 
              type="button" 
              className="btn btn-add-ing" 
              onClick={handleAdd}
            >
              +
            </button>
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
                  <td colSpan="4" style={{textAlign: 'center', color: '#999'}}>
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
                      <button className="btn-icon-remove" onClick={() => handleRemove(item.ingredientId)}>
                        🗑️
                      </button>
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