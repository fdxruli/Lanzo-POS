import React from 'react';

export default function RetailFormActions({ isSaving, onCancel }) {
  return (
    <div className="form-actions-bar">
      <button type="submit" className="btn btn-save" disabled={isSaving}>
        {isSaving ? 'Guardando...' : 'Guardar producto'}
      </button>
      <button type="button" className="btn btn-cancel" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}
