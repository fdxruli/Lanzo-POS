// src/components/products/fieldsets/RestauranteFields.jsx
import React from 'react';

export default function RestauranteFields({ productType, setProductType, onManageRecipe }) {
  return (
    <>
      {/* Selector de Tipo (Vendible / Ingrediente) */}
      <div className="form-group product-type-toggle">
        <label className="form-label">Tipo de Producto</label>
        <div className="theme-toggle-container"> {/* Reutilizamos estilos */}
          <label className="theme-radio-label">
            <input 
              type="radio" 
              name="productType" 
              value="sellable"
              checked={productType === 'sellable'}
              onChange={() => setProductType('sellable')} 
            />
            <span className="theme-radio-text">Producto para Vender</span>
          </label>
          <label className="theme-radio-label">
            <input 
              type="radio" 
              name="productType" 
              value="ingredient"
              checked={productType === 'ingredient'}
              onChange={() => setProductType('ingredient')} 
            />
            <span className="theme-radio-text">Ingrediente (Insumo)</span>
          </label>
        </div>
        <small className="form-help-text">
          Los 'Ingredientes' se usan para crear 'Recetas'.
        </small>
      </div>

      {/* Botón de Receta (solo para productos vendibles) */}
      {productType === 'sellable' && (
        <div className="form-group">
          <label className="form-label">Receta (Ingredientes)</label>
          <button 
            type="button" 
            className="btn btn-help" 
            onClick={onManageRecipe}
          >
            Administrar Receta
          </button>
        </div>
      )}
    </>
  );
}