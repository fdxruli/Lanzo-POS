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
    <div className="abarrotes-fields-container">
      <div className="theme-group-container">
        <div className="form-group">
          <label className="form-label">Ubicación en bodega / pasillo</label>
          <input
            type="text"
            className="form-input"
            placeholder="Ej: Pasillo 4, Estante B"
            value={location || ''}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        {showSuppliers && (
          <div className="form-group product-form-no-margin">
            <label className="form-label">Proveedor principal</label>
            <input
              type="text"
              className="form-input"
              placeholder="Ej: Proveedor local"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="product-form-grid product-form-grid--2">
        {showBulk && (
          <div className="form-group">
            <label className="form-label">Forma de venta</label>
            <select
              className="form-input"
              value={saleType}
              onChange={(e) => {
                setSaleType(e.target.value);
                if (e.target.value === 'unit') setUnit('pza');
                else if (unit === 'pza') setUnit('kg');
              }}
            >
              <option value="unit">Por pieza/unidad</option>
              <option value="bulk">A granel / fraccionado</option>
            </select>
          </div>
        )}

        {saleType === 'bulk' && (
          <div className="form-group">
            <label className="form-label">Unidad de venta</label>
            <select
              className="form-input product-form-emphasis-input"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              {COMMON_UNITS.map(u => (
                <option key={u.val} value={u.val}>{u.label}</option>
              ))}
            </select>
          </div>
        )}

        {showWholesale && saleType !== 'bulk' && (
          <div className="form-group">
            <label className="form-label">Precios especiales</label>
            <button type="button" className="btn btn-secondary" onClick={onManageWholesale}>
              Configurar mayoreo
            </button>
          </div>
        )}
      </div>

      {showBulk && saleType === 'bulk' && (
        <div className="conversion-section">
          <div className="product-form-section__header">
            <div className="conversion-header">
              <h4 className="product-form-section__title">Conversión de compra</h4>

              <button
                type="button"
                onClick={() => setShowConversionHelp(!showConversionHelp)}
                className="product-form-icon-button"
                title="¿Cuándo activar esto?"
                aria-label={showConversionHelp ? 'Ocultar ayuda de conversión' : 'Mostrar ayuda de conversión'}
              >
                {showConversionHelp ? <X size={18} /> : <Info size={18} />}
              </button>
            </div>

            <div className="form-group-checkbox product-form-no-margin">
              <input
                type="checkbox"
                id="enable-conversion"
                checked={conversionFactor?.enabled || false}
                onChange={(e) => setConversionFactor({
                  ...conversionFactor,
                  enabled: e.target.checked
                })}
              />
              <label htmlFor="enable-conversion">Activar</label>
            </div>
          </div>

          {showConversionHelp && (
            <div className="help-box-content">
              <p>
                <strong>¿Cuándo usar esto?</strong><br />
                Solo si compras en una unidad mayor y vendes en otra unidad menor sin contar pieza por pieza al recibir.
              </p>

              <div className="product-form-grid">
                <div className="example-box success">
                  <strong className="product-form-alert__title">SÍ: conversión útil</strong>
                  <span>
                    Compras una caja con varias unidades internas y vendes esas unidades por separado.
                  </span>
                </div>
                <div className="example-box warning">
                  <strong className="product-form-alert__title">NO: mejor capturar stock directo</strong>
                  <span>
                    Si ya conoces la cantidad final que venderás, registra directamente ese total en inventario.
                  </span>
                </div>
              </div>
            </div>
          )}

          {conversionFactor?.enabled && (
            <div className="product-form-grid product-form-grid--2">
              <div className="form-group product-form-no-margin">
                <label className="form-label">Unidad de compra</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ej: Caja, Bulto"
                  value={conversionFactor.purchaseUnit || ''}
                  onChange={(e) => setConversionFactor({ ...conversionFactor, purchaseUnit: e.target.value })}
                />
              </div>
              <div className="form-group product-form-no-margin">
                <label className="form-label">Contenido por unidad ({unit})</label>
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

              <div className="dynamic-preview-box">
                <span className="product-form-preview-marker" aria-hidden="true" />
                <div>
                  <strong>Ejemplo:</strong> Si ingresas 1 <span style={{ fontWeight: 'bold', textDecoration: 'underline' }}>{conversionFactor.purchaseUnit || '(Unidad)'}</span>,
                  el sistema sumará <span className="product-form-success-text">{conversionFactor.factor || 0} {unit}</span> a tu inventario.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showStockAlerts && (
        <div className="product-form-alert product-form-alert--warning product-form-risk-card">
          <h4 className="product-form-section__title">Alertas de stock</h4>
          <div className="product-form-grid product-form-grid--2" style={{ marginTop: '10px' }}>
            <div className="form-group product-form-no-margin">
              <label className="form-label">Mínimo (reordenar)</label>
              <input type="number" className="form-input" placeholder="Ej: 5" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
            </div>
            <div className="form-group product-form-no-margin">
              <label className="form-label">Máximo (tope)</label>
              <input type="number" className="form-input" placeholder="Ej: 50" value={maxStock} onChange={(e) => setMaxStock(e.target.value)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
