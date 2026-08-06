// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hookResult: {},
  message: vi.fn()
}));

vi.mock('../../../hooks/products/useAvailableIngredients', () => ({
  useAvailableIngredients: () => mocks.hookResult
}));
vi.mock('../../../services/utils', () => ({
  roundCurrency: (value) => Math.round(value * 100) / 100,
  showMessageModal: mocks.message
}));

import RecipeBuilderModal from '../RecipeBuilderModal';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hookResult = {
    ingredients: [{ id: 'ingredient-1', name: 'Queso', stock: 0, cost: 12, saleType: 'unit' }],
    isLoading: false,
    error: null,
    refresh: vi.fn()
  };
});

describe('RecipeBuilderModal ingredient source', () => {
  it('shows zero-stock ingredients, resolves piece units, and recognizes legacy recipe identifiers', () => {
    render(<RecipeBuilderModal show onClose={vi.fn()} onSave={vi.fn()} productName="Pizza" existingRecipe={[{ productId: 'ingredient-1', name: 'Queso', quantity: 1, unit: 'pza', estimatedCost: 12 }]} />);

    expect(screen.getByText(/Queso.*Stock: 0.*Costo: \$12.00/)).toBeInTheDocument();
    expect(screen.queryByText('Insumo eliminado')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ingredient-1' } });
    expect(screen.getByDisplayValue('pza')).toBeInTheDocument();
  });

  it.each([
    [{ ingredients: [], isLoading: true, error: null }, 'Cargando insumos...'],
    [{ ingredients: [], isLoading: false, error: new Error('offline') }, 'No se pudieron cargar los insumos. Intenta nuevamente.'],
    [{ ingredients: [], isLoading: false, error: null }, 'No hay insumos activos disponibles. Crea un insumo para comenzar una receta.']
  ])('renders ingredient source state %s', (state, expected) => {
    mocks.hookResult = { ...mocks.hookResult, ...state };
    render(<RecipeBuilderModal show onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
