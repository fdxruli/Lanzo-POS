// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
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

const makeIngredient = (id, name, details = {}) => ({
  id, name, productType: 'ingredient', cost: 12, stock: 0, unit: 'pza', ...details
});
const findResult = (name) => within(screen.getByLabelText('Lista de insumos')).getByText(name).closest('button');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hookResult = {
    ingredients: [makeIngredient('ingredient-1', 'Queso')],
    isLoading: false,
    error: null,
    refresh: vi.fn()
  };
});

describe('RecipeBuilderModal - explorador de insumos', () => {
  it('shows zero-stock ingredients, preserves legacy references, and allows direct editing', () => {
    const onSave = vi.fn();
    render(<RecipeBuilderModal show onClose={vi.fn()} onSave={onSave} productName="Pizza" existingRecipe={[{
      productId: 'ingredient-1', name: 'Queso', quantity: 1, unit: 'pza', estimatedCost: 12
    }]} />);

    expect(findResult('Queso')).toHaveTextContent('Stock: 0 pza');
    expect(findResult('Queso')).toHaveTextContent('En receta');
    expect(screen.queryByText('Insumo eliminado o no disponible')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Queso' }));
    expect(screen.getByLabelText('Cantidad')).toHaveValue(1);
    expect(screen.getByLabelText('Unidad')).toHaveValue('pza');
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar ingrediente' }));
    expect(screen.getByText('1 ingrediente')).toBeInTheDocument();
    expect(screen.getByText('2 pza · $24.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar receta' }));
    expect(onSave).toHaveBeenCalledWith([expect.objectContaining({ ingredientId: 'ingredient-1', quantity: 2, unit: 'pza' })]);
  });

  it('supports accent-insensitive partial tokens, barcode, and category browsing', () => {
    mocks.hookResult.ingredients = [
      makeIngredient('q1', 'Queso Mozzarella', { categoryId: 'dairy', barcode: '750123' }),
      makeIngredient('q2', 'Jalapeño en rodajas', { categoryId: 'vegetable', barcode: '750777' }),
      makeIngredient('q3', 'Harina de trigo', { categoryId: 'dry' })
    ];
    render(<RecipeBuilderModal show onClose={vi.fn()} onSave={vi.fn()} categories={[
      { id: 'dairy', name: 'Lácteos' },
      { id: 'vegetable', name: 'Verduras' },
      { id: 'dry', name: 'Secos' }
    ]} />);

    fireEvent.change(screen.getByLabelText('Buscar insumo'), { target: { value: 'mozz ques' } });
    expect(findResult('Queso Mozzarella')).toBeInTheDocument();
    expect(screen.queryByText('Harina de trigo')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar insumo'), { target: { value: 'jalapeno' } });
    expect(findResult('Jalapeño en rodajas')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar insumo'), { target: { value: '750123' } });
    expect(findResult('Queso Mozzarella')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar insumo'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Explorar por categoría'), { target: { value: 'vegetable' } });
    expect(findResult('Jalapeño en rodajas')).toBeInTheDocument();
    expect(screen.queryByText('Queso Mozzarella')).not.toBeInTheDocument();
  });

  it('keeps the full alphabetic catalog reachable without searching an exact name', () => {
    mocks.hookResult.ingredients = Array.from({ length: 65 }, (_, index) => (
      makeIngredient('ing-' + index, 'Insumo ' + String(index + 1).padStart(2, '0'))
    ));
    render(<RecipeBuilderModal show onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText('30 insumos')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver más insumos (35 restantes)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver más insumos (35 restantes)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver más insumos (5 restantes)' }));
    expect(findResult('Insumo 65')).toBeInTheDocument();
  });

  it('converts grams to the inventory unit and does not multiply quantities when toggled', () => {
    mocks.hookResult.ingredients = [makeIngredient('f1', 'Harina', { cost: 40, stock: 4, unit: 'kg' })];
    const onSave = vi.fn();
    render(<RecipeBuilderModal show onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(findResult('Harina'));
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '0.25' } });
    fireEvent.click(screen.getByLabelText('Capturar en gramos (g)'));
    expect(screen.getByLabelText('Cantidad (gramos)')).toHaveValue(250);
    expect(screen.getByLabelText('Unidad')).toHaveValue('g');
    fireEvent.click(screen.getByRole('button', { name: 'Agregar ingrediente' }));
    expect(screen.getByText('0.25 kg · $10.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar receta' }));
    expect(onSave).toHaveBeenCalledWith([expect.objectContaining({ ingredientId: 'f1', quantity: 0.25, unit: 'kg', estimatedCost: 10 })]);
  });

  it('does not submit the outer product form when pressing Enter in search or quantity', () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={submit}><RecipeBuilderModal show onClose={vi.fn()} onSave={vi.fn()} /></form>);
    fireEvent.keyDown(screen.getByLabelText('Buscar insumo'), { key: 'Enter', code: 'Enter' });
    fireEvent.click(findResult('Queso'));
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '1' } });
    fireEvent.keyDown(screen.getByLabelText('Cantidad'), { key: 'Enter', code: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText('1 pza · $12.00')).toBeInTheDocument();
  });

  it('blocks saving a recipe with an ingredient missing from the available catalog', () => {
    render(<RecipeBuilderModal show onClose={vi.fn()} onSave={vi.fn()} existingRecipe={[{
      productId: 'deleted', name: 'Ingrediente antiguo', quantity: 2, unit: 'pza'
    }]} />);
    expect(screen.getByText('Insumo eliminado o no disponible')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar receta' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Ingrediente antiguo' }));
    expect(screen.getByRole('button', { name: 'Guardar receta' })).toBeEnabled();
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
