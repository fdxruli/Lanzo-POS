import React, { useState } from 'react';
import { Info, X } from 'lucide-react';

const COMMON_UNITS = [
  { val: 'kg', label: 'Kilogramos (kg)' },
  { val: 'lt', label: 'Litros (L)' },
  { val: 'mt', label: 'Metros (m)' },
  { val: 'pza', label: 'Pieza (pza)' },
  { val: 'gal', label: 'Galón (gal)' },
  { val: 'cm', label: 'Centímetros (cm)' },
  { val: 'ft', label: 'Pies (ft)' },
  { val: 'in', label: 'Pulgadas (in)' },
  { val: 'gr', label: 'Gramos (gr)' },
  { val: 'ml', label: 'Mililitros (ml)' }
];

export default function AbarrotesFields({
  saleType, setSaleType,
  unit, setUnit,
  onManageWholesale,
  minStock, setMinStock,
  maxStock, setMaxStock,
  supplier, setSupplier,
  location, setLocation,
  conversionFactor, setConversionFactor,
  showSuppliers = false,
  showBulk = false,
  showWholesale = false,
  showStockAlerts = false
}) {

  const [showConversionHelp, setShowConversionHelp] = useState(false);

  return (
    <div className="abarrotes-fields-container" style={{ animation: 'fadeIn 0.3s' }}>

      {/* 1. UBICACIÓN Y PROVEEDOR (Usando clase theme-group-container) */}
      <div className="theme-group-container">
        <div className="form-group">
          <label className="form-label">📍 Ubicación en Bodega / Pasillo</label>
          <input 
            type="text" 
            className="form-input" 
            placeholder="Ej: Pasillo 4, Estante B" 
            value={location || ''} 
            onChange={(e) => setLocation(e.target.value)} 
          />
        </div>

        {showSuppliers && (
            <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Proveedor Principal</label>
            <input 
                type="text" 
                className="form-input" 
                placeholder="Ej: Coca-Cola, Bimbo..." 
                value={supplier} 
                onChange={(e) => setSupplier(e.target.value)} 
            />
            </div>
        )}
      </div>

      {/* 2. FORMA DE VENTA */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '15px' }}>
        {showBulk && (
          <div className="form-group">
            <label className="form-label">Forma de Venta</label>
            <select
              className="form-input"
              value={saleType}
              onChange={(e) => {
                setSaleType(e.target.value);
                if (e.target.value === 'unit') setUnit('pza');
                else if (unit === 'pza') setUnit('kg');
              }}
            >
              <option value="unit">Por Pieza/Unidad</option>
              <option value="bulk">A Granel / Fraccionado</option>
            </select>
          </div>
        )}

        {saleType === 'bulk' && (
          <div className="form-group">
            <label className="form-label">Unidad de Venta</label>
            <select
              className="form-input"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              style={{ border: '2px solid var(--primary-color)' }}
            >
              {COMMON_UNITS.map(u => (
                <option key={u.val} value={u.val}>{u.label}</option>
              ))}
            </select>
          </div>
        )}

        {showWholesale && saleType !== 'bulk' && (
          <div className="form-group">
            <label className="form-label">Precios Especiales</label>
            <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={onManageWholesale}>
              Configurar Mayoreo
            </button>
          </div>
        )}
      </div>

      {/* 3. CONVERSIÓN DE COMPRA (Estilos corregidos con clases CSS) */}
      {showBulk && saleType === 'bulk' && (
        <div className="conversion-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div className="conversion-header">
              <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'inherit' }}>🔄 Conversión de Compra</h4>

              <button
                type="button"
                onClick={() => setShowConversionHelp(!showConversionHelp)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: showConversionHelp ? 'var(--primary-color)' : 'var(--text-light)',
                  display: 'flex', alignItems: 'center', marginLeft: '5px'
                }}
                title="¿Cuándo activar esto?"
              >
                {showConversionHelp ? <X size={18} /> : <Info size={18} />}
              </button>
            </div>

            <div className="form-group-checkbox" style={{ margin: 0 }}>
              <input
                type="checkbox"
                id="enable-conversion"
                checked={conversionFactor?.enabled || false}
                onChange={(e) => setConversionFactor({
                  ...conversionFactor,
                  enabled: e.target.checked
                })}
              />
              <label htmlFor="enable-conversion" style={{ fontSize: '0.85rem', cursor: 'pointer', marginLeft: '5px' }}>Activar</label>
            </div>
          </div>

          {showConversionHelp && (
            <div className="help-box-content">
              <p style={{ marginBottom: '10px', lineHeight: '1.4' }}>
                <strong>¿Cuándo usar esto?</strong><br />
                Solo si compras en una unidad (Cajas/Bultos) y vendes en otra (Piezas/Kilos) y <u>no quieres contar al recibir</u>.
              </p>

              <div style={{ display: 'grid', gap: '10px' }}>
                <div className="example-box success">
                  <strong style={{ display: 'block', marginBottom: '2px' }}>✅ SÍ: Ejemplo "Clavos a Granel"</strong>
                  <span>
                    Compras una caja de 25kg, pero vendes piezas sueltas. <br />
                    El sistema traduce: <strong>1 Kg = 200 Clavos</strong>.
                  </span>
                </div>
                <div className="example-box warning">
                  <strong style={{ display: 'block', marginBottom: '2px' }}>❌ NO: Ejemplo "Cemento"</strong>
                  <span>
                    Compras 10 bultos de 50kg y vendes kilos.<br />
                    <strong>Mejor ingresa "500" directo al stock.</strong> Es más claro ver "Quedan 450 kilos" que "Quedan 9.0 bultos".
                  </span>
                </div>
              </div>
            </div>
          )}

          {conversionFactor?.enabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.8rem' }}>Unidad de Compra</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ej: Caja, Bulto"
                  value={conversionFactor.purchaseUnit || ''}
                  onChange={(e) => setConversionFactor({ ...conversionFactor, purchaseUnit: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.8rem' }}>Contenido por unidad ({unit})</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder={`Ej: 50`}
                  value={conversionFactor.factor || ''}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setConversionFactor({
                      ...conversionFactor,
                      factor: isNaN(val) ? '' : val
                    });
                  }}
                />
              </div>

              {/* --- PREVISUALIZACIÓN DINÁMICA --- */}
              <div className="dynamic-preview-box">
                <span style={{ fontSize: '1.2rem' }}>📦</span>
                <div>
                  <strong>Ejemplo:</strong> Si ingresas 1 <span style={{ fontWeight: 'bold', textDecoration: 'underline' }}>{conversionFactor.purchaseUnit || '(Unidad)'}</span>,
                  el sistema sumará <span style={{ fontWeight: '800', color: 'var(--success-color)', fontSize: '1em' }}>{conversionFactor.factor || 0} {unit}</span> a tu inventario.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showStockAlerts && (
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