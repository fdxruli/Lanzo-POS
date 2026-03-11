import React from 'react';
import RestauranteFields from '../../fieldsets/RestauranteFields';

export default function RestaurantConfigSection({
  productType,
  setProductType,
  onManageRecipe,
  printStation,
  setPrintStation,
  prepTime,
  setPrepTime,
  modifiers,
  setModifiers,
  recipeCount,
  currentCost
}) {
  return (
    <div
      className="module-section"
      style={{ borderTop: '2px solid #fdba74', marginTop: '25px', paddingTop: '20px', position: 'relative' }}
    >
      <span
        style={{
          position: 'absolute',
          top: '-14px',
          left: '15px',
          background: '#fff7ed',
          padding: '0 8px',
          borderRadius: '4px',
          fontSize: '0.85rem',
          color: '#ea580c',
          fontWeight: 'bold',
          border: '1px solid #fdba74'
        }}
      >
        Configuracion de Restaurante
      </span>

      <RestauranteFields
        productType={productType}
        setProductType={setProductType}
        onManageRecipe={onManageRecipe}
        printStation={printStation}
        setPrintStation={setPrintStation}
        prepTime={prepTime}
        setPrepTime={setPrepTime}
        modifiers={modifiers}
        setModifiers={setModifiers}
        recipeCount={recipeCount}
        currentCost={currentCost}
      />
    </div>
  );
}

