// src/components/products/CostCalculatorModal.jsx
import React, { useState, useMemo } from 'react';
import { roundCurrency} from '../../services/utils';
import './CostCalculatorModal.css'

export default function CostCalculatorModal({ show, onClose, onAssignCost }) {
  const [ingredients, setIngredients] = useState([]);
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [quantity, setQuantity] = useState(1);

  // Lógica de 'addIngredient'
  const addIngredient = () => {
    const nCost = parseFloat(cost);
    const nQty = parseInt(quantity, 10);
    if (!name || isNaN(nCost) || nCost <= 0) {
      alert('Por favor, ingresa un nombre y costo válidos.');
      return;
    }
    setIngredients([
      ...ingredients,
      { id: Date.now(), name, cost: nCost, quantity: nQty }
    ]);
    // Limpiar formulario
    setName(''); setCost(''); setQuantity(1);
  };

  const removeIngredient = (id) => {
    setIngredients(ingredients.filter(ing => ing.id !== id));
  };

  // Calcula el total
  const totalCost = useMemo(() => {
    return ingredients.reduce((sum, ing) => sum + roundCurrency(ing.cost * ing.quantity), 0);
  }, [ingredients]);

  const handleAssign = () => {
    onAssignCost(totalCost); // Envía el total al padre
    onClose(); // Cierra el modal
  };
  
  const handleClose = () => {
    setIngredients([]); // Limpia la lista al cerrar
    onClose();
  };

  if (!show) return null;

  // HTML de 'cost-calculation-modal'
  return (
    <div id="cost-calculation-modal" className="modal" style={{ display: 'flex' }}>
      <div className="modal-content">
        <h2 className="modal-title">Calculadora de Costos</h2>
        <p>Agrega los ingredientes y sus costos para calcular el precio unitario.</p>
        <div className="ingredient-form">
          <input type="text" placeholder="Nombre ingrediente" className="form-input"
            value={name} onChange={(e) => setName(e.target.value)} />
          <input type="number" placeholder="Costo ($)" className="form-input"
            value={cost} onChange={(e) => setCost(e.target.value)} />
          <input type="number" value={quantity} min="1" step="1" className="form-input"
            onChange={(e) => setQuantity(e.target.value)} />
          <button type="button" className="btn btn-save" onClick={addIngredient}>
            Agregar
          </button>
        </div>
        <div className="ingredient-list" id="ingredient-list">
          {ingredients.length === 0 ? (
            <p>No hay ingredientes agregados.</p>
          ) : (
            ingredients.map(ing => (
              <div key={ing.id} className="ingredient-item">
                <span>{ing.name} x{ing.quantity}</span>
                <span>
                  ${(ing.cost * ing.quantity).toFixed(2)}
                  <button className="btn-remove" onClick={() => removeIngredient(ing.id)}>X</button>
                </span>
              </div>
            ))
          )}
        </div>
        <div className="ingredient-total" id="ingredient-total">
          Total: ${totalCost.toFixed(2)}
        </div>
        <div className="btn-calcular">
          <button id="assign-cost" className="btn btn-assign" onClick={handleAssign}>
            Asignar a Costo
          </button>
          <button id="close-cost-modal" className="btn btn-cancel" onClick={handleClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}