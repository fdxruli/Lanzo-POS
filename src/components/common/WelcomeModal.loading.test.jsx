// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import WelcomeModal from './WelcomeModal';

describe('WelcomeModal loading feedback', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true
    });
    useAppStore.setState({
      handleLogin: vi.fn(),
      handleFreeTrial: vi.fn()
    });
  });

  afterEach(() => cleanup());

  it('shows free-license progress on the free CTA without changing the license-login label', async () => {
    let resolveTrial;
    const handleFreeTrial = vi.fn(() => new Promise((resolve) => {
      resolveTrial = resolve;
    }));
    useAppStore.setState({ handleFreeTrial });

    render(<WelcomeModal />);
    fireEvent.click(screen.getByRole('button', { name: /ya tengo una licencia/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear mi licencia gratuita' }));

    fireEvent.click(screen.getByRole('button', { name: 'Creando licencia...' }));
    expect(handleFreeTrial).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Creando licencia...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Acceder con licencia/ })).toHaveTextContent('Acceder con licencia');
    expect(screen.queryByText('Verificando...')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Creando licencia LANZO Local...');

    resolveTrial({ success: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crear mi licencia gratuita' })).toBeEnabled());
  });

  it('shows an uncertain creation safely and releases the button', async () => {
    const handleFreeTrial = vi.fn().mockResolvedValue({ success: false, error: 'TypeError: Failed to fetch', outcome: 'unknown' });
    useAppStore.setState({ handleFreeTrial });
    render(<WelcomeModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Crear mi licencia gratuita' }));
    await screen.findByText('No pudimos confirmar la creación');
    expect(screen.queryByText(/TypeError|Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear mi licencia gratuita' })).toBeEnabled();
    expect(handleFreeTrial).toHaveBeenCalledTimes(1);
  });

  it('shows verification progress only on the existing-license CTA', async () => {
    let resolveLogin;
    const handleLogin = vi.fn(() => new Promise((resolve) => {
      resolveLogin = resolve;
    }));
    useAppStore.setState({ handleLogin });

    render(<WelcomeModal />);
    fireEvent.click(screen.getByRole('button', { name: /ya tengo una licencia/i }));
    fireEvent.change(screen.getByLabelText('Clave de licencia'), {
      target: { value: 'LANZO-TEST-1234' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Acceder con licencia/ }));

    expect(handleLogin).toHaveBeenCalledWith('LANZO-TEST-1234');
    expect(screen.getByRole('button', { name: 'Verificando...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Crear mi licencia gratuita' })).toHaveTextContent('Crear mi licencia gratuita');
    expect(screen.queryByText('Creando licencia...')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Verificando licencia...');

    resolveLogin({ success: true });
    await waitFor(() => expect(screen.getByRole('button', { name: /Acceder con licencia/ })).toBeEnabled());
  });
});
