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

    expect(screen.getByRole('heading', { name: 'No pudimos restaurar la tienda' }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    expect(listener).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'No pudimos restaurar la tienda' }))
      .toBeInTheDocument();
  });

  it('keeps a manual full refresh as the last action', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    render(
      <PublicStoreErrorBoundary reload={reload}>
        <BrokenStore />
      </PublicStoreErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar tienda' }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
