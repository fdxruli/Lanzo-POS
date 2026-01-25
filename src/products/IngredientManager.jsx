// src/components/products/IngredientManager.jsx
import React, { useState } from 'react';
import './IngredientManager.css';

export default function IngredientManager({ ingredients, onSave, onDelete }) {
  // Estados del formulario
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [stock, setStock] = useState('');
  const [unit, setUnit] = useState('kg'); // Default: Kilogramos
  
  const [editingId, setEditingId] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    // Preparamos el objeto del producto (Insumo)
    const ingredientData = {
      id: editingId, // Si es null, ProductsPage creará uno nuevo
      name: name.trim(),
      productType: 'ingredient', // ¡Crucial!
      
      // Lógica de unidad
      saleType: unit === 'pza' ? 'unit' : 'bulk', 
      bulkData: { purchase: { unit: unit } }, // Guardamos la unidad preferida

      // Datos para el lote inicial (solo si es nuevo)
      cost: parseFloat(cost) || 0,
      stock: parseFloat(stock) || 0,
      price: 0 // Los insumos no suelen tener precio de venta al público
    };
    
    onSave(ingredientData, editingId ? { id: editingId } : null);
    resetForm();
  };

  const handleEdit = (ing) => {
    setEditingId(ing.id);
    setName(ing.name);
    // Al editar, NO cargamos stock/costo para no sobreescribir lotes complejos.
    // Solo permitimos editar nombre y unidad visualmente.
    // Para inventario real, se usa "Gestionar Lotes".
    setCost(''); 
    setStock('');
    
    // Recuperar unidad guardada o inferir
    const savedUnit = ing.bulkData?.purchase?.unit || (ing.saleType === 'unit' ? 'pza' : 'kg');
    setUnit(savedUnit);
  };

  const handleDelete = (id) => {
    if (window.confirm('¿Seguro que quieres eliminar este insumo?')) {
      onDelete({ id, name: 'Insumo' }); // Pasamos objeto mínimo compatible
    }
  };

  const resetForm = () => {
    setName('');
    setCost('');
    setStock('');
    setUnit('kg');
    setEditingId(null);
  };

  return (
    <div className="ingredient-manager-container">
      
      {/* SECCIÓN 1: FORMULARIO (Panel Izquierdo/Superior) */}
      <div className="ingredient-form-section">
        <h3 className="subtitle">
            {editingId ? 'Editar Insumo' : 'Nuevo Insumo Rápido'}
        </h3>
        
        <form onSubmit={handleSubmit} className="ingredient-inline-form">
            <div className="form-group">
                <label>Nombre del Insumo</label>
                <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Ej: Harina, Tomate, Carne"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoFocus
                />
            </div>

            <div className="form-row">
                <div className="form-group">
                    <label>Unidad</label>
                    <select 
                        className="form-input" 
                        value={unit} 
                        onChange={(e) => setUnit(e.target.value)}
                    >
                        <option value="kg">Kilogramos (kg)</option>
                        <option value="lt">Litros (L)</option>
                        <option value="gr">Gramos (gr)</option>
                        <option value="ml">Mililitros (ml)</option>
                        <option value="pza">Pieza / Unidad</option>
                    </select>
                </div>
            </div>

            {/* Costo y Stock solo visibles al CREAR (para no romper lógica de lotes al editar) */}
            {!editingId && (
                <div className="form-row">
                    <div className="form-group">
                        <label>Costo Compra ($)</label>
                        <input 
                            type="number" 
                            className="form-input" 
                            placeholder="0.00"
                            step="0.01"
                            value={cost}
                            onChange={(e) => setCost(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label>Stock Inicial</label>
                        <input 
                            type="number" 
                            className="form-input" 
                            placeholder="0"
                            step="0.01"
                            value={stock}
                            onChange={(e) => setStock(e.target.value)}
                        />
                    </div>
                </div>
            )}

            <div className="form-actions">
                <button type="submit" className="btn btn-save">
                    {editingId ? 'Actualizar Datos' : 'Guardar Insumo'}
                </button>
                {editingId && (
                    <button type="button" className="btn btn-cancel" onClick={resetForm}>
                        Cancelar
                    </button>
                )}
            </div>
        </form>
      </div>

      {/* SECCIÓN 2: LISTA (Panel Derecho/Inferior) */}
      <div className="ingredient-list-section">
        <div className="ingredient-list-header">
            <h3 className="subtitle">Inventario de Insumos</h3>
            <span className="ingredient-count-badge">{ingredients.length} items</span>
        </div>
        
        <div className="ingredient-list-grid">
            {ingredients.length === 0 ? (
                <p className="empty-message">No hay insumos registrados.</p>
            ) : (
                ingredients.map(ing => (
                    <div key={ing.id} className="ingredient-card-item">
                        <div className="ing-info">
                            <span className="ing-name">{ing.name}</span>
                            <div className="ing-details">
                                <span className="ing-stock">
                                    Stock: <strong>{ing.stock || 0} {ing.bulkData?.purchase?.unit || (ing.saleType==='unit'?'pza':'kg')}</strong>
                                </span>
                                <span className="ing-cost">
                                    Costo: ${ing.cost?.toFixed(2) || '0.00'}
                                </span>
                            </div>
                        </div>
                        <div className="ing-actions">
                            <button className="btn-icon edit" onClick={() => handleEdit(ing)} title="Editar Nombre/Unidad">✏️</button>
                            <button className="btn-icon delete" onClick={() => handleDelete(ing.id)} title="Eliminar">🗑️</button>
                        </div>
                    </div>
                ))
            )}
        </div>
      </div>
    </div>
  );
}