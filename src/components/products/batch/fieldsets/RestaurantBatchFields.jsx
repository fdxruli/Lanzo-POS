import React from 'react';

export default function RestaurantBatchFields({
  formValues,
  setFieldValue,
  firstInputRef,
  features,
  idPrefix
}) {
  return (
    <>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-location`}>Ubicacion en bodega</label>
        <input
          id={`${idPrefix}-location`}
          ref={firstInputRef}
          type="text"
          placeholder="Ej: Almacen seco, repisa 1"
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
