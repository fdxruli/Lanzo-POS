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
    fireEvent.click(screen.getByRole('button', { name: 'Crear licencia Lanzo Local' }));

    expect(handleFreeTrial).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Creando licencia...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Acceder con Licencia/ })).toHaveTextContent('Acceder con Licencia');
    expect(screen.queryByText('Verificando...')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Creando licencia Lanzo Local...');

    resolveTrial({ success: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crear licencia Lanzo Local' })).toBeEnabled());
  });

  it('shows verification progress only on the existing-license CTA', async () => {
    let resolveLogin;
    const handleLogin = vi.fn(() => new Promise((resolve) => {
      resolveLogin = resolve;
    }));
    useAppStore.setState({ handleLogin });

    render(<WelcomeModal />);
    fireEvent.change(screen.getByLabelText('Clave de Licencia'), {
      target: { value: 'LANZO-TEST-1234' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Acceder con Licencia/ }));

    expect(handleLogin).toHaveBeenCalledWith('LANZO-TEST-1234');
    expect(screen.getByRole('button', { name: 'Verificando...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Crear licencia Lanzo Local' })).toHaveTextContent('Crear licencia Lanzo Local');
    expect(screen.queryByText('Creando licencia...')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Verificando licencia...');

    resolveLogin({ success: true });
    await waitFor(() => expect(screen.getByRole('button', { name: /Acceder con Licencia/ })).toBeEnabled());
  });
});
