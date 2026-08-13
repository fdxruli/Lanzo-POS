// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ingredients: [],
  setModifiers: vi.fn()
}));

vi.mock('../../../../hooks/products/useAvailableIngredients', () => ({
  useAvailableIngredients: () => ({ ingredients: mocks.ingredients, isLoading: false, error: null, refresh: vi.fn() })
}));
vi.mock('../../../../hooks/restaurant/usePreparationStations', () => ({
  usePreparationStations: () => ({ activeStations: [], isLoading: false, error: null })
}));

import RestauranteFields from '../RestauranteFields';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ingredients = [{ id: 'ingredient-1', name: 'Tocino', stock: 0, saleType: 'bulk', unit: 'kg' }];
});

afterEach(() => {
  cleanup();
});

describe('RestauranteFields ingredient extras', () => {
  it('renders the recipe action and delegates to onManageRecipe in the V2 visual variant', () => {
    const onManageRecipe = vi.fn();
    render(<RestauranteFields productType="sellable" setProductType={vi.fn()} visualVariant="product-form-v2" onManageRecipe={onManageRecipe} printStation="kitchen" setPrintStation={vi.fn()} prepTime="" setPrepTime={vi.fn()} modifiers={[]} setModifiers={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Configurar receta' }));
    expect(onManageRecipe).toHaveBeenCalledTimes(1);
  });

  it('offers ingredients from the independent source even at zero stock', () => {
    const Harness = () => {
      const [modifiers, setModifiers] = useState([]);
      return <RestauranteFields productType="sellable" setProductType={vi.fn()} onManageRecipe={vi.fn()} printStation="kitchen" setPrintStation={vi.fn()} prepTime="" setPrepTime={vi.fn()} modifiers={modifiers} setModifiers={setModifiers} />;
    };
    render(<Harness />);
    fireEvent.change(screen.getByPlaceholderText('Nuevo grupo (Ej: Extras)'), { target: { value: 'Extras' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(screen.getByRole('option', { name: /Tocino \(Stock: 0\)/ })).toBeInTheDocument();
  });
});
