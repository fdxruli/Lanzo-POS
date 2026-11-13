// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CategorySelect from '../forms/CategorySelect';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../../services/db/dexie', () => ({
  db: { table: () => ({ get: mocks.get }) },
  STORES: { CATEGORIES: 'categories' }
}));

afterEach(() => cleanup());

beforeEach(() => {
  mocks.get.mockReset();
  mocks.get.mockResolvedValue(undefined);
});

describe('CategorySelect', () => {
  it('keeps a temporarily missing category ID and labels it without clearing the product', async () => {
    const onChange = vi.fn();
    render(<CategorySelect value="not-synced-yet" onChange={onChange} />);

    await waitFor(() => expect(screen.getByRole('option', { name: 'Categoría no disponible' })).toBeInTheDocument());
    expect(screen.getByRole('combobox')).toHaveValue('not-synced-yet');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps and names an inactive category reference', async () => {
    mocks.get.mockResolvedValue({ id: 'inactive-cat', name: 'Temporada', isActive: false });
    render(<CategorySelect value="inactive-cat" onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('option', { name: 'Temporada (Inactiva)' })).toBeInTheDocument());
    expect(screen.getByRole('combobox')).toHaveValue('inactive-cat');
  });

  it('clears the selected ID only after the user chooses Sin categoría', async () => {
    const onChange = vi.fn();
    render(<CategorySelect value="legacy-cat" onChange={onChange} />);

    await screen.findByRole('option', { name: 'Categoría no disponible' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('shows active category names from the current catalog without looking them up again', () => {
    render(<CategorySelect
      value="drinks"
      onChange={vi.fn()}
      activeCategories={[{ id: 'drinks', name: 'Bebidas', isActive: true }]}
    />);

    expect(screen.getByRole('option', { name: 'Bebidas' })).toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
