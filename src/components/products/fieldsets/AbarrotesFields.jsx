import React from 'react';

export default function AbarrotesFields({ 
  saleType, setSaleType, 
  onManageWholesale,
  minStock, setMinStock,
  maxStock, setMaxStock,
  features 
}) {
  return (
    <>
      {/* --- Sección de Ventas --- */}
      {features.hasBulk && (
        <div className="form-group">
          <label className="form-label" htmlFor="sale-type">Forma de Venta *</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <select
              className="form-input"
              id="sale-type"
              value={saleType}
              onChange={(e) => setSaleType(e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="unit">Por Unidad/Pieza</option>
              <option value="bulk">A Granel (Peso/Volumen)</option>
            </select>
            
            {/* Botón de Mayoreo integrado al lado */}
            {features.hasWholesale && (
              <button 
                type="button" 
                className="btn btn-help"
                style={{ margin: 0, whiteSpace: 'nowrap' }}
                onClick={onManageWholesale}
              >
                💲 Precios Mayoreo
              </button>
            )}
          </div>
          {saleType === 'bulk' && (
             <small className="form-help-text">El sistema permitirá vender fracciones (ej: 0.5 kg)</small>
          )}
        </div>
      )}
      
      {/* --- Sección de Inventario (Puntos de Reorden) --- */}
      {features.hasMinMax && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: '15px', 
          marginTop: '1rem',
          padding: '15px',
          backgroundColor: 'var(--light-background)',
          borderRadius: '8px',
          borderLeft: '4px solid var(--secondary-color)'
        }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.9rem' }}>Stock Mínimo (Alerta)</label>
            <input 
              type="number" 
              className="form-input" 
              placeholder="Ej: 5"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
            />
            <small className="form-help-text">Avisar cuando quede poco</small>
          </div>
          
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.9rem' }}>Stock Máximo (Ideal)</label>
            <input 
              type="number" 
              className="form-input" 
              placeholder="Ej: 100"
              value={maxStock}
              onChange={(e) => setMaxStock(e.target.value)}
            />
            <small className="form-help-text">Para no sobre-comprar</small>
          </div>
        </div>
      )}
    </>
  );
}