// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CategoryForm from '../CategoryForm';

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('CategoryForm reliable saving', () => {
  afterEach(() => cleanup());

  it('accepts a Free category object without a success flag and clears after confirmation', async () => {
    const onSave = vi.fn().mockResolvedValue({
      id: 'category-1',
      name: 'Bebidas',
      color: '#12ab34',
      sortOrder: 4
    });
    const onSaveSuccess = vi.fn();

    render(<CategoryForm onSave={onSave} onSaveSuccess={onSaveSuccess} />);
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'Bebidas' } });
    fireEvent.change(screen.getByLabelText('Color de la categoria'), { target: { value: '#12ab34' } });
    fireEvent.change(screen.getByLabelText('Orden de visualizacion'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(onSaveSuccess).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: '',
      name: 'Bebidas',
      color: '#12ab34',
      sortOrder: 4
    }));
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Categoría guardada.');
  });

  it('keeps edit values and the original ID after an error, then allows a retry', async () => {
    const onSave = vi.fn()
      .mockRejectedValueOnce(new Error('Ya existe una categoria activa con este nombre.'))
      .mockResolvedValueOnce({ id: 'category-7', name: 'Jugos', color: '#123abc', sortOrder: 6 });
    const onSaveSuccess = vi.fn();

    render(<CategoryForm
      initialData={{ id: 'category-7', name: 'Bebidas', color: '#123abc', sortOrder: 6, serverVersion: 3 }}
      onSave={onSave}
      onSaveSuccess={onSaveSuccess}
    />);
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'Duplicada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una categoria activa');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('Duplicada');
    expect(screen.getByLabelText('Color de la categoria')).toHaveValue('#123abc');
    expect(screen.getByLabelText('Orden de visualizacion')).toHaveValue(6);
    expect(onSaveSuccess).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'Jugos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(onSaveSuccess).toHaveBeenCalledOnce());

    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'category-7',
      serverVersion: 3,
      name: 'Jugos',
      color: '#123abc',
      sortOrder: 6
    }));
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('');
  });

  it('locks the stale edit after VERSION_CONFLICT and preserves its values for reopen', async () => {
    const onSave = vi.fn().mockResolvedValue({
      success: false,
      code: 'VERSION_CONFLICT',
      message: 'La categoría cambió en otro dispositivo. Cancela esta edición y vuelve a abrirla para revisar los cambios actuales.'
    });
    const onSaveSuccess = vi.fn();

    render(<CategoryForm
      initialData={{ id: 'category-9', name: 'Bebidas', color: '#3b82f6', sortOrder: 2, serverVersion: 7 }}
      onSave={onSave}
      onSaveSuccess={onSaveSuccess}
    />);
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'Fríos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('vuelve a abrirla para revisar los cambios actuales');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('Fríos');
    expect(screen.getByLabelText('Color de la categoria')).toHaveValue('#3b82f6');
    expect(screen.getByLabelText('Orden de visualizacion')).toHaveValue(2);
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeDisabled();
    expect(screen.getByLabelText('Nombre de la categoria')).toBeDisabled();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'category-9', serverVersion: 7, name: 'Fríos' }));
    expect(onSaveSuccess).not.toHaveBeenCalled();

    fireEvent.submit(screen.getByLabelText('Nombre de la categoria').closest('form'));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSaveSuccess).not.toHaveBeenCalled();
  });

  it('blocks simultaneous submissions and labels an offline save as pending', async () => {
    const save = deferred();
    const onSave = vi.fn(() => save.promise);
    const onSaveSuccess = vi.fn();

    render(<CategoryForm onSave={onSave} onSaveSuccess={onSaveSuccess} />);
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'QA Bebidas' } });
    const form = screen.getByLabelText('Nombre de la categoria').closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    expect(screen.getByLabelText('Nombre de la categoria')).toBeDisabled();

    save.resolve({ id: 'category-10', name: 'QA Bebidas', success: true, pending: true });
    await waitFor(() => expect(onSaveSuccess).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('guardada en este dispositivo');
    expect(screen.getByRole('status')).toHaveTextContent('sincronización está pendiente');
  });
});
