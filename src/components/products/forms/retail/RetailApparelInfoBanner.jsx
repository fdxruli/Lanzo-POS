import React from 'react';

export default function RetailApparelInfoBanner({ isVisible }) {
  if (!isVisible) return null;

  return (
    <div className="product-form-alert product-form-alert--info">
      <div className="product-form-alert__content">
        <strong className="product-form-alert__title">Modo boutique activo</strong>
        <p>
          Define el <u>Estilo General</u> arriba y usa la tabla inferior para desglosar{' '}
          <strong>tallas y colores</strong>.
        </p>
      </div>
    </div>
  );
}
