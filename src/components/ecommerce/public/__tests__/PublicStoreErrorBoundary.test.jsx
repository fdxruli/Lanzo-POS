// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicStoreErrorBoundary from '../PublicStoreErrorBoundary';

const BrokenStore = () => {
  throw new Error('ordinary render failure');
};

describe('PublicStoreErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps a functional fallback and offers controlled recovery', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const listener = vi.fn();
    window.addEventListener('lanzo:public-store-recover', listener, { once: true });
    render(
      <PublicStoreErrorBoundary>
        <BrokenStore />
      </PublicStoreErrorBoundary>
    );

    expect(screen.getByRole('heading', { name: 'No pudimos cargar esta tienda' }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar tienda' }));
    expect(listener).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'No pudimos cargar esta tienda' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintento utilizado' })).toBeDisabled();
  });

  it('does not expose a general reload action that could interrupt the cart', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    render(
      <PublicStoreErrorBoundary reload={reload}>
        <BrokenStore />
      </PublicStoreErrorBoundary>
    );
    expect(screen.queryByRole('button', { name: 'Actualizar tienda' })).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});
