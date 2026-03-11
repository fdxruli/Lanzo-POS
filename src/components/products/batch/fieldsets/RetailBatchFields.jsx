import React from 'react';

export default function RetailBatchFields({
  formValues,
  setFieldValue,
  features,
  idPrefix,
  firstInputRef,
  tallaInputRef
}) {
  return (
    <>
      {features.hasVariants && (
        <>
          <div className="form-group">
            <label htmlFor={`${idPrefix}-attribute2`}>Color / Marca / Material</label>
            <input
              id={`${idPrefix}-attribute2`}
              ref={firstInputRef}
              type="text"
              placeholder="Ej: Rojo, Nike, Acero"
              value={formValues.attribute2}
              onChange={(event) => setFieldValue('attribute2', event.target.value)}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor={`${idPrefix}-attribute1`}>Talla / Modelo / Dimensiones</label>
            <input
              id={`${idPrefix}-attribute1`}
              ref={tallaInputRef}
              type="text"
              placeholder="Ej: M, 28 mx, 10cm"
              value={formValues.attribute1}
              onChange={(event) => setFieldValue('attribute1', event.target.value)}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor={`${idPrefix}-sku`}>SKU (Auto-generado si se deja vacio)</label>
            <input
              id={`${idPrefix}-sku`}
              type="text"
              placeholder="Generar automatico..."
              value={formValues.sku}
              onChange={(event) => setFieldValue('sku', event.target.value)}
              className="form-input"
            />
          </div>
        </>
      )}

      <div className="form-group">
        <label htmlFor={`${idPrefix}-location`}>Ubicacion en bodega</label>
        <input
          id={`${idPrefix}-location`}
          type="text"
          placeholder="Ej: Estante A-3"
          value={formValues.location}
          onChange={(event) => setFieldValue('location', event.target.value)}
          className="form-input"
        />
      </div>

      {features.hasLots && (
        <div className="form-group">
          <label htmlFor={`${idPrefix}-expiryDate`}>Fecha caducidad (Opcional)</label>
          <input
            id={`${idPrefix}-expiryDate`}
            type="date"
            value={formValues.expiryDate}
            onChange={(event) => setFieldValue('expiryDate', event.target.value)}
            className="form-input"
          />
        </div>
      )}
    </>
  );
}
