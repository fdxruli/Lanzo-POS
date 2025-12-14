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

  // NOTA: Hemos eliminado la calculadora de precios redundante.
  // Ahora el cálculo de margen se hace directamente en ProductForm.jsx

  return (
    <div className="abarrotes-fields-container" style={{ animation: 'fadeIn 0.3s' }}>

      {/* 1. UBICACIÓN Y PROVEEDOR */}
      <div className="form-group" style={{ backgroundColor: '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '15px' }}>
        <label className="form-label">📍 Ubicación en Bodega / Pasillo</label>
        <input type="text" className="form-input" placeholder="Ej: Pasillo 4, Estante B" value={location || ''} onChange={(e) => setLocation(e.target.value)} />
      </div>

      {showSuppliers && (
        <div className="form-group">
          <label className="form-label">Proveedor Principal</label>
          <input type="text" className="form-input" placeholder="Ej: Coca-Cola, Bimbo..." value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </div>
      )}

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

      {/* 3. CONVERSIÓN DE COMPRA */}
      {showBulk && saleType === 'bulk' && (
        <div style={{
          marginTop: '15px',
          padding: '15px',
          backgroundColor: '#eff6ff',
          borderRadius: '8px',
          border: '1px solid #bfdbfe'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#1e40af' }}>🔄 Conversión de Compra</h4>

              <button
                type="button"
                onClick={() => setShowConversionHelp(!showConversionHelp)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: showConversionHelp ? 'var(--primary-color)' : '#60a5fa',
                  display: 'flex', alignItems: 'center'
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
              <label htmlFor="enable-conversion" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>Activar</label>
            </div>
          </div>

          {showConversionHelp && (
            <div style={{
              backgroundColor: 'white',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '15px',
              border: '1px solid #dbeafe',
              fontSize: '0.85rem',
              color: '#1e3a8a',
              animation: 'fadeIn 0.2s ease-out'
            }}>
              <p style={{ marginBottom: '10px', lineHeight: '1.4' }}>
                <strong>¿Cuándo usar esto?</strong><br />
                Solo si compras en una unidad (Cajas/Bultos) y vendes en otra (Piezas/Kilos) y <u>no quieres contar al recibir</u>.
              </p>

              <div style={{ display: 'grid', gap: '10px' }}>
                <div style={{ backgroundColor: '#f0fdf4', padding: '10px', borderRadius: '6px', borderLeft: '4px solid #16a34a' }}>
                  <strong style={{ color: '#166534', display: 'block', marginBottom: '2px' }}>✅ SÍ: Ejemplo "Clavos a Granel"</strong>
                  <span style={{ color: '#15803d' }}>
                    Compras una caja de 25kg, pero vendes piezas sueltas. <br />
                    El sistema traduce: <strong>1 Kg = 200 Clavos</strong>.
                  </span>
                </div>
                <div style={{ backgroundColor: '#fff7ed', padding: '10px', borderRadius: '6px', borderLeft: '4px solid #ea580c' }}>
                  <strong style={{ color: '#c2410c', display: 'block', marginBottom: '2px' }}>❌ NO: Ejemplo "Cemento"</strong>
                  <span style={{ color: '#9a3412' }}>
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
                  placeholder="Ej: Caja, Bulto, Rollo"
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

              {/* --- NUEVO: PREVISUALIZACIÓN DINÁMICA --- */}
              <div style={{
                gridColumn: '1 / -1',
                marginTop: '5px',
                padding: '10px',
                backgroundColor: '#ffffff',
                border: '1px dashed #3b82f6',
                borderRadius: '6px',
                fontSize: '0.85rem',
                color: '#1e3a8a',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span style={{ fontSize: '1.2rem' }}>📦</span>
                <div>
                  <strong>Ejemplo:</strong> Si ingresas 1 <span style={{ fontWeight: 'bold', textDecoration: 'underline' }}>{conversionFactor.purchaseUnit || '(Unidad de Compra)'}</span>,
                  el sistema sumará <span style={{ fontWeight: '800', color: 'var(--success-color)', fontSize: '1em' }}>{conversionFactor.factor || 0} {unit}</span> a tu inventario.
                </div>
              </div>
              {/* -------------------------------------- */}

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
