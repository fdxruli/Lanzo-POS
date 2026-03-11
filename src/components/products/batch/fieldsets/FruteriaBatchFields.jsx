import React from 'react';

export default function FruteriaBatchFields({ formValues, setFieldValue, firstInputRef, idPrefix }) {
  return (
    <>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-location`}>Zona / Ubicacion</label>
        <input
          id={`${idPrefix}-location`}
          ref={firstInputRef}
          type="text"
          placeholder="Ej: Camara fria, Anaquel 2"
          value={formValues.location}
          onChange={(event) => setFieldValue('location', event.target.value)}
          className="form-input"
        />
      </div>

      <div className="form-group">
        <label htmlFor={`${idPrefix}-expiryDate`}>Caducidad o fecha de merma esperada</label>
        <input
          id={`${idPrefix}-expiryDate`}
          type="date"
          value={formValues.expiryDate}
          onChange={(event) => setFieldValue('expiryDate', event.target.value)}
          className="form-input"
        />
      </div>
    </>
  );
}
