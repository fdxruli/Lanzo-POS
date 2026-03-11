import React from 'react';

export default function RestaurantFormActions({
  isSaving,
  productType,
  onCancel
}) {
  return (
    <div
      style={{
        marginTop: '25px',
        display: 'flex',
        gap: '15px',
        paddingTop: '15px',
        borderTop: '1px solid #eee'
      }}
    >
      <button
        type="submit"
        className="btn btn-save"
        style={{ flex: 2, padding: '12px', fontSize: '1.1rem' }}
        disabled={isSaving}
      >
        {isSaving ? 'Guardando...' : (productType === 'sellable' ? 'Guardar Platillo' : 'Guardar Insumo')}
      </button>
      <button type="button" className="btn btn-cancel" style={{ flex: 1 }} onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}

