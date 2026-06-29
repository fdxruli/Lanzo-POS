import React from 'react';
import RestauranteFields from '../../fieldsets/RestauranteFields';
import { showConfirmModal } from '../../../../services/utils';

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
    <section className="product-form-section">
      <div className="product-form-section__header">
        <div className="product-form-section__heading">
          <h4 className="product-form-section__title">Configuración de restaurante</h4>
          <p className="product-form-section__subtitle">
            Ajusta receta, comanda, tiempos y modificadores con el mismo patrón visual.
          </p>
        </div>
      </div>

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
        <section className="product-form-section product-form-section--nested">
          <div className="product-form-section__header">
            <div className="product-form-section__heading">
              <h4 className="product-form-section__title">Modo de caducidad</h4>
              <p className="product-form-section__subtitle">
                Define si los lotes requieren fecha o vida útil al recibir inventario.
              </p>
            </div>
          </div>

          <select
            className="form-input"
            value={common.expirationMode}
            onChange={async (e) => {
              const newValue = e.target.value;
              if ((common.expirationMode === 'STRICT' || common.expirationMode === 'SHELF_LIFE') && newValue === 'NONE') {
                const confirmPurge = await showConfirmModal(
                  "Existen lotes activos con fechas de caducidad. ¿Deseas purgar estas fechas o cancelar el cambio?",
                  {
                    title: 'Purgar caducidades',
                    confirmButtonText: 'Sí, purgar',
                    cancelButtonText: 'Cancelar'
                  }
                );
                if (!confirmPurge) return;
                common.setPendingBatchPurge(true);
              }
              common.setExpirationMode(newValue);
            }}
          >
            <option value="NONE">No controlar caducidad</option>
            <option value="STRICT">Estricto (requerir fecha al recibir)</option>
            <option value="SHELF_LIFE">Vida útil (días/meses desde recepción)</option>
          </select>

          {common.expirationMode === 'SHELF_LIFE' && (
            <div className="product-form-grid product-form-grid--2" style={{ marginTop: '10px' }}>
              <div className="form-group product-form-no-margin">
                <label className="form-label">Vida útil</label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  value={common.shelfLifeValue}
                  onChange={(e) => common.setShelfLifeValue(e.target.value)}
                  placeholder="Ej. 5"
                />
              </div>
              <div className="form-group product-form-no-margin">
                <label className="form-label">Unidad de tiempo</label>
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
        </section>
      )}
    </section>
  );
}
