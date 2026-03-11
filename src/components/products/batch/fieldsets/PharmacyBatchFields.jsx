import React from 'react';

export default function PharmacyBatchFields({ formValues, setFieldValue, firstInputRef, idPrefix }) {
  return (
    <>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-location`}>Lote / Ubicacion</label>
        <input
          id={`${idPrefix}-location`}
          ref={firstInputRef}
          type="text"
          placeholder="Ej: Pasillo B, Gabeta 4"
          value={formValues.location}
          onChange={(event) => setFieldValue('location', event.target.value)}
          className="form-input"
        />
      </div>

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
    </>
  );
}
