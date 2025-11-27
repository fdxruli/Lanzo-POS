// src/components/products/fieldsets/AbarrotesFields.jsx
import React, { useEffect } from 'react';

const COMMON_UNITS = [
  { val: 'kg', label: 'Kilogramos (kg)' },
  { val: 'lt', label: 'Litros (L)' },
  { val: 'mt', label: 'Metros (m)' }, // Vital para Ferretería
  { val: 'pza', label: 'Pieza (pza)' },
  { val: 'gal', label: 'Galón (gal)' }, // Pintura/Líquidos
  { val: 'cm', label: 'Centímetros (cm)' },
  { val: 'ft', label: 'Pies (ft)' }, // Madera/Tubos
  { val: 'in', label: 'Pulgadas (in)' },
  { val: 'gr', label: 'Gramos (gr)' }, // Para cosas muy finas (semillas)
  { val: 'ml', label: 'Mililitros (ml)' }
];

export default function AbarrotesFields({
  saleType, setSaleType,
  unit, setUnit,
  onManageWholesale,
  minStock, setMinStock,
  maxStock, setMaxStock,
  features,
  supplier, setSupplier,
  taxType, setTaxType,
  cost, setCost, // Necesitamos acceso al costo y precio para la calculadora
  price, setPrice
}) {

  // Calculadora de Margen automática
  const handleMarginChange = (e) => {
    const margin = parseFloat(e.target.value);
    const numericCost = parseFloat(cost);

    if (!isNaN(margin) && !isNaN(numericCost) && numericCost > 0) {
      // Fórmula simple: Precio = Costo * (1 + %/100)
      const newPrice = numericCost * (1 + (margin / 100));
      setPrice(newPrice.toFixed(2));
    }
  };

  // Calcular margen inverso para mostrarlo visualmente
  const currentMargin = (cost > 0 && price > 0)
    ? (((price - cost) / cost) * 100).toFixed(1)
    : '';

  return (
    <div className="abarrotes-fields-container" style={{ animation: 'fadeIn 0.3s' }}>

      {/* 1. CALCULADORA DE PRECIOS (Lo más importante para la tiendita) */}
      <div style={{
        backgroundColor: '#f0fdf4', // Verde muy suave
        padding: '15px',
        borderRadius: '8px',
        border: '1px solid #bbf7d0',
        marginBottom: '15px'
      }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#166534', fontSize: '0.95rem' }}>💰 Calculadora de Ganancia</h4>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
            <label className="form-label">Costo Compra ($)</label>
            <input
              type="number"
              className="form-input"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0.00"
              step="0.50"
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0, width: '80px' }}>
            <label className="form-label">Ganancia %</label>
            <input
              type="number"
              className="form-input"
              placeholder="%"
              onChange={handleMarginChange}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
            <label className="form-label">Precio Final ($)</label>
            <input
              type="number"
              className="form-input"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              style={{ fontWeight: 'bold', color: 'var(--success-color)' }}
            />
          </div>
        </div>
        {currentMargin && (
          <small style={{ display: 'block', marginTop: '5px', color: '#166534', textAlign: 'right' }}>
            Margen actual: <strong>{currentMargin}%</strong>
          </small>
        )}
      </div>

      {/* 2. DATOS ADMINISTRATIVOS (Proveedor) */}
      {features.hasSuppliers && (
        <div className="form-group">
          <label className="form-label">Proveedor Principal</label>
          <input
            type="text"
            className="form-input"
            placeholder="Ej: Coca-Cola, Bimbo, El Zorro..."
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          />
        </div>
      )}

      {/* 3. FORMA DE VENTA Y MAYOREO */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '15px' }}>
        {features.hasBulk && (
          <div className="form-group">
            <label className="form-label">Forma de Venta</label>
            <select
              className="form-input"
              value={saleType}
              onChange={(e) => {
                setSaleType(e.target.value);
                // Si cambia a unitario, forzamos 'pza'
                if(e.target.value === 'unit') setUnit('pza');
                // Si cambia a granel y estaba en pza, sugerimos kg o mt
                else if(unit === 'pza') setUnit('kg');
              }}
            >
              <option value="unit">Por Pieza/Unidad</option>
              <option value="bulk">A Granel / Fraccionado</option>
            </select>
          </div>
        )}

        {saleType === 'bulk' && (
          <div className="form-group">
            <label className="form-label">Unidad de Medida</label>
            <select
              className="form-input"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              style={{ border: '2px solid var(--primary-color)' }} // Resaltar para que lo vean
            >
              {COMMON_UNITS.map(u => (
                <option key={u.val} value={u.val}>{u.label}</option>
              ))}
            </select>
          </div>
        )}

        {features.hasWholesale && saleType !== 'bulk' && (
          <div className="form-group">
            <label className="form-label">Precios Especiales</label>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%' }}
              onClick={onManageWholesale}
            >
              Configurar Mayoreo
            </button>
          </div>
        )}
      </div>

      <small style={{display:'block', marginBottom:'15px', color:'#666'}}>
        {saleType === 'bulk' 
          ? `El precio y costo que ingreses arriba será por cada 1 ${unit.toUpperCase()}.` 
          : `El precio es por cada pieza unitaria.`}
      </small>

      {/* 4. ALERTAS DE INVENTARIO */}
      {features.hasMinMax && (
        <div style={{
          marginTop: '10px',
          padding: '15px',
          backgroundColor: 'var(--light-background)',
          borderRadius: '8px',
          borderLeft: '4px solid var(--warning-color)'
        }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: 'var(--text-dark)' }}>🔔 Alertas de Stock</h4>
          <div style={{ display: 'flex', gap: '15px' }}>
            <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
              <label className="form-label" style={{ fontSize: '0.85rem' }}>Mínimo (Reordenar)</label>
              <input type="number" className="form-input" placeholder="Ej: 5" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
              <label className="form-label" style={{ fontSize: '0.85rem' }}>Máximo (Tope)</label>
              <input type="number" className="form-input" placeholder="Ej: 50" value={maxStock} onChange={(e) => setMaxStock(e.target.value)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}