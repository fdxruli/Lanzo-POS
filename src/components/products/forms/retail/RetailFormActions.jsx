import React from 'react';

export default function RetailFormActions({ isSaving, onCancel }) {
  return (
    <div className="form-actions-bar" style={{ marginTop: '25px' }}>
      <button type="submit" className="btn btn-save" disabled={isSaving}>
        {isSaving ? 'Guardando...' : 'Guardar Producto'}
      </button>
      <button type="button" className="btn btn-cancel" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}

