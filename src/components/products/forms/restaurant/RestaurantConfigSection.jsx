import React from 'react';
import RestauranteFields from '../../fieldsets/RestauranteFields';

export default function RestaurantConfigSection({
  common,
  productType,
  setProductType,
  onManageRecipe,
  printStation,
  setPrintStation,
  prepTime,
  setPrepTime,
  modifiers,
  setModifiers,
  recipeCount,
  currentCost
}) {
  return (
    <div
      className="module-section"
      style={{ borderTop: '2px solid #fdba74', marginTop: '25px', paddingTop: '20px', position: 'relative' }}
    >
      <span
        style={{
          position: 'absolute',
          top: '-14px',
          left: '15px',
          background: '#fff7ed',
          padding: '0 8px',
          borderRadius: '4px',
          fontSize: '0.85rem',
          color: '#ea580c',
          fontWeight: 'bold',
          border: '1px solid #fdba74'
        }}
      >
        Configuracion de Restaurante
      </span>

      <RestauranteFields
        productType={productType}
        setProductType={setProductType}
        onManageRecipe={onManageRecipe}
        printStation={printStation}
        setPrintStation={setPrintStation}
        prepTime={prepTime}
        setPrepTime={setPrepTime}
        modifiers={modifiers}
        setModifiers={setModifiers}
        recipeCount={recipeCount}
        currentCost={currentCost}
      />

      {/* CONFIGURACIÓN DE CADUCIDAD (DESACOPLADA) */}
      {common?.doesTrackStock && (
        <div className="form-group" style={{ marginTop: '15px', padding: '10px', backgroundColor: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
          <label className="form-label" style={{ fontWeight: 'bold', color: '#334155' }}>Modo de Caducidad</label>
          <select
            className="form-input"
            value={common.expirationMode}
            onChange={(e) => {
              const newValue = e.target.value;
              if ((common.expirationMode === 'STRICT' || common.expirationMode === 'SHELF_LIFE') && newValue === 'NONE') {
                const confirmPurge = window.confirm(
                  "⚠️ Existen lotes activos con fechas de caducidad. ¿Deseas purgar estas fechas o cancelar el cambio?"
                );
                if (!confirmPurge) return;
                common.setPendingBatchPurge(true);
              }
              common.setExpirationMode(newValue);
            }}
          >
            <option value="NONE">No Controlar Caducidad</option>
            <option value="STRICT">Estricto (Requerir fecha al recibir)</option>
            <option value="SHELF_LIFE">Vida Útil (Días/Meses desde recepción)</option>
          </select>

          {common.expirationMode === 'SHELF_LIFE' && (
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <div style={{ flex: 1 }}>
                <label className="form-label" style={{ fontSize: '0.85rem' }}>Vida Útil</label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  value={common.shelfLifeValue}
                  onChange={(e) => common.setShelfLifeValue(e.target.value)}
                  placeholder="Ej. 5"
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label" style={{ fontSize: '0.85rem' }}>Unidad de Tiempo</label>
                <select
                  className="form-input"
                  value={common.shelfLifeUnit}
                  onChange={(e) => common.setShelfLifeUnit(e.target.value)}
                >
                  <option value="days">Días</option>
                  <option value="months">Meses</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

