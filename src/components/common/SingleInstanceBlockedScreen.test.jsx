import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SingleInstanceBlockedScreen from './SingleInstanceBlockedScreen';

afterEach(cleanup);

describe('SingleInstanceBlockedScreen', () => {
  it('explica cómo liberar la ventana sin ofrecer acciones destructivas', () => {
    render(<SingleInstanceBlockedScreen onRetry={() => {}} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Aplicación ya abierta' })).toBeTruthy();
    expect(screen.getByText(/Cierra la otra pestaña o ventana/)).toBeTruthy();
    expect(screen.getByText(/no cierra otras ventanas ni borra datos/)).toBeTruthy();
  });

  it('reintenta únicamente cuando el usuario pulsa el botón', () => {
    const onRetry = vi.fn();
    render(<SingleInstanceBlockedScreen onRetry={onRetry} />);

    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar acceso' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
