// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CategoryManager from '../CategoryManager';
import CategoryManagerModal from '../CategoryManagerModal';

const repository = vi.hoisted(() => ({ getCategoryProductCounts: vi.fn() }));

vi.mock('../../../services/products/productRepository', () => ({ productRepository: repository }));

const category = { id: 'category-1', name: 'Bebidas', color: '#123abc', sortOrder: 3, serverVersion: 4 };

const createManager = (kind, onSave, onRefresh, categories = [category], onDelete = vi.fn()) => {
  if (kind === 'section') {
    return <CategoryManager
      categories={categories}
      onSave={onSave}
      onRefresh={onRefresh}
      onDelete={onDelete}
    />;
  }

  return (
    <MemoryRouter>
      <CategoryManagerModal
        show
        onClose={vi.fn()}
        categories={categories}
        onSave={onSave}
        onRefresh={onRefresh}
        onDelete={onDelete}
      />
    </MemoryRouter>
  );
};

const renderManager = (kind, onSave, onRefresh, categories, onDelete) => render(createManager(kind, onSave, onRefresh, categories, onDelete));

describe('category manager save failure consistency', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    repository.getCategoryProductCounts.mockResolvedValue({ complete: false, counts: {} });
  });

  it.each(['section', 'modal'])('%s keeps the edit form when the repository rejects a save', async (kind) => {
    const onSave = vi.fn().mockResolvedValue({
      success: false,
      code: 'VERSION_CONFLICT',
      message: 'La categoría cambió en otro dispositivo. Cancela esta edición y vuelve a abrirla para revisar los datos actuales.'
    });
    const onRefresh = vi.fn();

    renderManager(kind, onSave, onRefresh);
    fireEvent.click(screen.getByRole('button', { name: 'Editar Bebidas' }));
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'Bebidas frías' } });
    fireEvent.change(screen.getByLabelText('Color de la categoria'), { target: { value: '#456def' } });
    fireEvent.change(screen.getByLabelText('Orden de visualizacion'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('vuelve a abrirla para revisar los datos actuales');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('Bebidas frías');
    expect(screen.getByLabelText('Color de la categoria')).toHaveValue('#456def');
    expect(screen.getByLabelText('Orden de visualizacion')).toHaveValue(9);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'category-1', serverVersion: 4 }));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeDisabled();

    if (kind === 'modal') {
      expect(screen.getByRole('dialog', { name: 'Gestionar categorías' })).toBeInTheDocument();
    }
  });

  it.each(['section', 'modal'])('%s requires cancel and reopen before a refreshed category can be saved', async (kind) => {
    const currentCategory = {
      ...category,
      name: 'Bebidas Cloud',
      color: '#abcdef',
      sortOrder: 8,
      serverVersion: 9
    };
    const onSave = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        code: 'VERSION_CONFLICT',
        message: 'La categoría cambió en otro dispositivo. Cancela esta edición y vuelve a abrirla para revisar los datos actuales.'
      })
      .mockResolvedValueOnce({ success: true, id: currentCategory.id, ...currentCategory });
    const onRefresh = vi.fn();
    const view = renderManager(kind, onSave, onRefresh);

    fireEvent.click(screen.getByRole('button', { name: 'Editar Bebidas' }));
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'Cambios del usuario' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('Cambios del usuario');

    view.rerender(createManager(kind, onSave, onRefresh, [currentCategory]));
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('Cambios del usuario');
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Editar Bebidas Cloud' }));
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('Bebidas Cloud');
    expect(screen.getByLabelText('Color de la categoria')).toHaveValue('#abcdef');
    expect(screen.getByLabelText('Orden de visualizacion')).toHaveValue(8);
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'category-1',
      serverVersion: 9,
      name: 'Bebidas Cloud',
      color: '#abcdef',
      sortOrder: 8
    }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it.each(['section', 'modal'])('%s searches category names without case or accents and can clear the search', async (kind) => {
    const categories = [
      { ...category, name: 'Café de olla' },
      { id: 'category-2', name: 'Té verde', color: '#00aa44', sortOrder: 4 }
    ];
    renderManager(kind, vi.fn(), vi.fn(), categories);

    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar categoría' }), { target: { value: 'CAFE' } });
    expect(screen.getByText('Café de olla')).toBeInTheDocument();
    expect(screen.queryByText('Té verde')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    expect(screen.getByText('Té verde')).toBeInTheDocument();
  });

  it.each(['section', 'modal'])('%s shows clear empty states and keeps long names and actions available', async (kind) => {
    const longName = 'Categoría de productos de temporada con un nombre largo para una pantalla pequeña';
    const onDelete = vi.fn();
    const view = renderManager(kind, vi.fn(), vi.fn(), [
      { ...category, name: longName }
    ], onDelete);

    expect(screen.getByText(longName)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Editar ${longName}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Eliminar ${longName}` })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar categoría' }), { target: { value: 'no existe' } });
    expect(screen.getByRole('status')).toHaveTextContent('No hay resultados');

    view.rerender(createManager(kind, vi.fn(), vi.fn(), []));
    expect(screen.getByRole('status')).toHaveTextContent('No hay categorías creadas');
  });

  it.each(['section', 'modal'])('%s shows only complete counts and forwards a reliable delete count', async (kind) => {
    repository.getCategoryProductCounts.mockResolvedValue({ complete: true, counts: { 'category-1': 4 } });
    const onDelete = vi.fn();
    renderManager(kind, vi.fn(), vi.fn(), [category], onDelete);

    expect(await screen.findByText('4 productos')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Bebidas' }));
    expect(onDelete).toHaveBeenCalledWith(category, 4);
  });

  it.each(['section', 'modal'])('%s omits product counts when the license catalog snapshot is incomplete', async (kind) => {
    repository.getCategoryProductCounts.mockResolvedValue({ complete: false, counts: {} });
    renderManager(kind, vi.fn(), vi.fn(), [category]);

    await waitFor(() => expect(repository.getCategoryProductCounts).toHaveBeenCalledWith(['category-1']));
    expect(screen.queryByText('Sin productos')).not.toBeInTheDocument();
    expect(screen.queryByText('1 producto')).not.toBeInTheDocument();
  });
});
