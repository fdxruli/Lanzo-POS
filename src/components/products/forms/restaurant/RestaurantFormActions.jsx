import React from 'react';

export default function RestaurantFormActions({
  isSaving,
  productType,
  onCancel
}) {
  return (
    <div className="form-actions-bar">
      <button
        type="submit"
        className="btn btn-save"
        disabled={isSaving}
      >
        {isSaving ? 'Guardando...' : (productType === 'sellable' ? 'Guardar platillo' : 'Guardar insumo')}
      </button>
      <button type="button" className="btn btn-cancel" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}
