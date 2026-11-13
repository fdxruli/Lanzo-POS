// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CategoryManager from '../CategoryManager';
import CategoryManagerModal from '../CategoryManagerModal';

const category = { id: 'category-1', name: 'Bebidas', color: '#123abc', sortOrder: 3, serverVersion: 4 };

const renderManager = (kind, onSave, onRefresh) => {
  if (kind === 'section') {
    return render(<CategoryManager
      categories={[category]}
      onSave={onSave}
      onRefresh={onRefresh}
      onDelete={vi.fn()}
    />);
  }

  return render(
    <MemoryRouter>
      <CategoryManagerModal
        show
        onClose={vi.fn()}
        categories={[category]}
        onSave={onSave}
        onRefresh={onRefresh}
        onDelete={vi.fn()}
      />
    </MemoryRouter>
  );
};

describe('category manager save failure consistency', () => {
  afterEach(() => cleanup());

  it.each(['section', 'modal'])('%s keeps the edit form when the repository rejects a save', async (kind) => {
    const onSave = vi.fn().mockResolvedValue({
      success: false,
      code: 'VERSION_CONFLICT',
      message: 'La categoria fue modificada en otro dispositivo.'
    });
    const onRefresh = vi.fn();

    renderManager(kind, onSave, onRefresh);
    fireEvent.click(screen.getByRole('button', { name: 'Editar Bebidas' }));
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'Bebidas frías' } });
    fireEvent.change(screen.getByLabelText('Color de la categoria'), { target: { value: '#456def' } });
    fireEvent.change(screen.getByLabelText('Orden de visualizacion'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('modificada en otro dispositivo');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('Bebidas frías');
    expect(screen.getByLabelText('Color de la categoria')).toHaveValue('#456def');
    expect(screen.getByLabelText('Orden de visualizacion')).toHaveValue(9);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'category-1', serverVersion: 4 }));
    expect(onRefresh).not.toHaveBeenCalled();

    if (kind === 'modal') {
      expect(screen.getByRole('dialog', { name: 'Gestionar categorias' })).toBeInTheDocument();
    }
  });
});
