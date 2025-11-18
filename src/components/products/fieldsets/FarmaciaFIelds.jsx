// src/components/products/fieldsets/FarmaciaFields.jsx
import React from 'react';

export default function FarmaciaFields({ sustancia, setSustancia, laboratorio, setLaboratorio }) {
  return (
    <div className="specific-data-container">
      <h4 className="subtitle" style={{ fontSize: '1rem', color: 'var(--text-light)', marginBottom: 'var(--spacing-md)' }}>
          Información (Farmacia)
      </h4>
      <div className="form-group">
          <label className="form-label" htmlFor="product-sustancia">Sustancia Activa</label>
          <input className="form-input" id="product-sustancia" type="text"
              value={sustancia} onChange={(e) => setSustancia(e.target.value)} />
      </div>
      <div className="form-group">
          <label className="form-label" htmlFor="product-laboratorio">Laboratorio</label>
          <input className="form-input" id="product-laboratorio" type="text"
              value={laboratorio} onChange={(e) => setLaboratorio(e.target.value)} />
      </div>
    </div>
  );
}