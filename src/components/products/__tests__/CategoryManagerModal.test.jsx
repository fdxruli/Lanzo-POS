// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CategoryManagerModal from '../CategoryManagerModal';

vi.mock('../../../services/products/productRepository', () => ({
  productRepository: { getCategoryProductCounts: vi.fn(async () => ({ complete: true, counts: {} })) }
}));

afterEach(() => cleanup());

describe('CategoryManagerModal product form callback', () => {
  it('returns a successfully created local pending category for automatic selection', async () => {
    const onCategoryCreated = vi.fn();
    const onSave = vi.fn(async (category) => ({
      ...category,
      id: 'new-category',
      success: true,
      pending: true,
      saveStatus: 'pending'
    }));
    render(<CategoryManagerModal
      show
      categories={[]}
      onSave={onSave}
      onRefresh={vi.fn()}
      onCategoryCreated={onCategoryCreated}
      selectNewCategoryOnCreate
    />);

    fireEvent.change(screen.getByRole('textbox', { name: /Nombre de la categoria/i }), {
      target: { value: 'QA Bebidas' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() => expect(onCategoryCreated).toHaveBeenCalledWith(expect.objectContaining({
      id: 'new-category',
      name: 'QA Bebidas',
      pending: true
    })));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'QA Bebidas' }));
  });

  it('does not select an edited category or a rejected create', async () => {
    const onCategoryCreated = vi.fn();
    const category = { id: 'existing-category', name: 'Temporada', sortOrder: 0 };
    const onSave = vi.fn(async (draft) => ({ ...draft, success: true }));
    const { rerender } = render(<CategoryManagerModal
      show
      categories={[category]}
      onSave={onSave}
      onCategoryCreated={onCategoryCreated}
      selectNewCategoryOnCreate
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Editar Temporada' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Nombre de la categoria/i }), {
      target: { value: 'Temporada actualizada' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Actualizar/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onCategoryCreated).not.toHaveBeenCalled();

    onSave.mockRejectedValueOnce(new Error('No se pudo guardar.'));
    rerender(<CategoryManagerModal
      show
      categories={[]}
      onSave={onSave}
      onCategoryCreated={onCategoryCreated}
      selectNewCategoryOnCreate
    />);
    fireEvent.change(screen.getByRole('textbox', { name: /Nombre de la categoria/i }), {
      target: { value: 'No guardar' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar.'));
    expect(onCategoryCreated).not.toHaveBeenCalled();
  });
});
