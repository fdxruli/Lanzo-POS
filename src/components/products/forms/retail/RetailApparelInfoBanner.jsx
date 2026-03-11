import React from 'react';

export default function RetailApparelInfoBanner({ isVisible }) {
  if (!isVisible) return null;

  return (
    <div
      className="info-box-purple"
      style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}
    >
      <span style={{ fontSize: '1.5rem' }}>Moda</span>
      <div>
        <strong>Modo Boutique Activo:</strong>
        <br />
        Define el <u>Estilo General</u> arriba y usa la tabla inferior para desglosar{' '}
        <strong>Tallas y Colores</strong>.
      </div>
    </div>
  );
}

