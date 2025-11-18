// src/components/products/fieldsets/AbarrotesFields.jsx
import React from 'react';

export default function AbarrotesFields({ saleType, setSaleType, onManageWholesale }) {
  return (
    <>
      {/* Venta a Granel */}
      <div className="form-group">
        <label className="form-label" htmlFor="sale-type">Tipo de Venta *</label>
        <select
          className="form-input"
          id="sale-type"
          value={saleType}
          onChange={(e) => setSaleType(e.target.value)}
        >
          <option value="unit">Por Unidad/Pieza</option>
          <option value="bulk">A Granel (Peso/Volumen)</option>
        </select>
      </div>
      
      {/* Precios de Mayoreo (Fase 6) */}
      <div className="form-group">
        <label className="form-label">Precios de Mayoreo</label>
        <button 
          type="button" 
          className="btn btn-help"
          onClick={onManageWholesale}
        >
          Definir Precios por Volumen
        </button>
      </div>
    </>
  );
}