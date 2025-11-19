import React from 'react';

export default function RestauranteFields({ 
  productType, setProductType, 
  onManageRecipe,
  printStation, setPrintStation 
}) {
  return (
    <>
      {/* Selector de Tipo (Vendible / Ingrediente) */}
      <div className="form-group product-type-toggle">
        <label className="form-label">Configuración de Restaurante</label>
        
        <div className="theme-toggle-container" style={{ width: '100%', marginBottom: '10px' }}>
          <label className="theme-radio-label" style={{ flex: 1, textAlign: 'center' }}>
            <input 
              type="radio" 
              name="productType" 
              value="sellable"
              checked={productType === 'sellable'}
              onChange={() => setProductType('sellable')} 
            />
            <span className="theme-radio-text">Platillo (Venta)</span>
          </label>
          <label className="theme-radio-label" style={{ flex: 1, textAlign: 'center' }}>
            <input 
              type="radio" 
              name="productType" 
              value="ingredient"
              checked={productType === 'ingredient'}
              onChange={() => setProductType('ingredient')} 
            />
            <span className="theme-radio-text">Insumo (Inventario)</span>
          </label>
        </div>
      </div>

      {/* Opciones para Platillos */}
      {productType === 'sellable' && (
        <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
            <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Receta</label>
                <button 
                    type="button" 
                    className="btn btn-help" 
                    style={{ margin: 0, height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={onManageRecipe}
                >
                    🥘 Definir Ingredientes
                </button>
            </div>

            <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Enviar Comanda a:</label>
                <select 
                    className="form-input"
                    value={printStation}
                    onChange={(e) => setPrintStation(e.target.value)}
                >
                    <option value="kitchen">🍳 Cocina</option>
                    <option value="bar">🍹 Barra / Bebidas</option>
                    <option value="none">🚫 No Imprimir</option>
                </select>
            </div>
        </div>
      )}
      
      {productType === 'ingredient' && (
          <div style={{ padding: '10px', backgroundColor: '#e0f2fe', borderRadius: '8px', color: '#0369a1', fontSize: '0.9rem' }}>
              ℹ️ Los insumos no aparecen en el menú de ventas. Se usan solo para descontar inventario dentro de las recetas de tus platillos.
          </div>
      )}
    </>
  );
}