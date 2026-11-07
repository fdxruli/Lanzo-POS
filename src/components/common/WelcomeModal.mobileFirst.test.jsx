// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import WelcomeModal from './WelcomeModal';

describe('WelcomeModal mobile-first welcome', () => {
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

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const mockSpaciousLayout = (initial) => {
    let listener;
    const query = {
      matches: initial,
      addEventListener: (_event, callback) => { listener = callback; },
      removeEventListener: () => { listener = undefined; }
    };
    vi.stubGlobal('matchMedia', vi.fn(() => query));
    return (matches) => {
      query.matches = matches;
      act(() => listener?.({ matches }));
    };
  };

  it('introduces LANZO POS and provides the public information destinations', () => {
    render(<WelcomeModal />);

    expect(screen.getByRole('heading', { name: 'Vende, organiza y controla tu negocio.' })).toBeInTheDocument();
    expect(screen.getByText('Gestiona ventas, caja, inventario, clientes y reportes desde un solo lugar.')).toBeInTheDocument();
    expect(screen.getByText('Ventas')).toBeInTheDocument();
    expect(screen.getByText('Inventario')).toBeInTheDocument();
    expect(screen.getByText('Reportes')).toBeInTheDocument();

    const landingLink = screen.getByRole('link', { name: 'Conoce LANZO' });
    const storeLink = screen.getByRole('link', { name: 'Tienda en línea' });
    expect(landingLink).toHaveAttribute('href', 'https://lanzo-store.vercel.app/conoce-lanzo');
    expect(storeLink).toHaveAttribute('href', 'https://lanzo-store.vercel.app/');
    [landingLink, storeLink].forEach((link) => {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  it('keeps the entered license while the mobile activation form is collapsed and reopened', () => {
    render(<WelcomeModal />);

    const toggle = screen.getByRole('button', { name: /ya tengo una licencia/i });
    fireEvent.click(toggle);
    const input = screen.getByRole('textbox', { name: 'Clave de licencia' });
    fireEvent.change(input, { target: { value: 'lanzo-prueba-1234' } });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('welcome-license-panel')).toHaveAttribute('hidden');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Clave de licencia' })).toHaveValue('LANZO-PRUEBA-1234');
  });

  it('shows the license form without an accordion on a spacious viewport', () => {
    mockSpaciousLayout(true);
    render(<WelcomeModal />);

    // The control is visually hidden by the responsive CSS, but remains mounted.
    expect(document.querySelector('.license-entry-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('welcome-license-panel')).not.toHaveAttribute('hidden');
    expect(screen.getByRole('textbox', { name: 'Clave de licencia' })).toBeVisible();
  });

  it('adapts between spacious and compact layouts without losing the license', () => {
    const resize = mockSpaciousLayout(false);
    render(<WelcomeModal />);

    const toggle = screen.getByRole('button', { name: /ya tengo una licencia/i });
    fireEvent.click(toggle);
    const input = screen.getByRole('textbox', { name: 'Clave de licencia' });
    fireEvent.change(input, { target: { value: 'lanzo-prueba-5678' } });
    fireEvent.click(toggle);
    expect(document.getElementById('welcome-license-panel')).toHaveAttribute('hidden');

    resize(true);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveValue('LANZO-PRUEBA-5678');
    expect(document.getElementById('welcome-license-panel')).not.toHaveAttribute('hidden');

    // Focus before a keyboard-driven viewport reduction must not hide the active field.
    fireEvent.focus(input);
    resize(false);
    expect(document.getElementById('welcome-license-panel')).not.toHaveAttribute('hidden');
    expect(input).toHaveValue('LANZO-PRUEBA-5678');
  });

  it('keeps all three low-priority information actions together in the footer', () => {
    render(<WelcomeModal />);
    const footer = document.querySelector('.welcome-secondary');
    const actions = footer.querySelector('.prelogin-support__actions');
    expect(actions.querySelectorAll('a')).toHaveLength(2);
    expect(actions.querySelector('button')).toHaveTextContent('Soporte');
  });

  it('keeps initial activation and free creation blocked while offline', () => {
    const handleLogin = vi.fn();
    const handleFreeTrial = vi.fn();
    useAppStore.setState({ handleLogin, handleFreeTrial });
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false
    });

    render(<WelcomeModal />);

    expect(screen.getByRole('status')).toHaveTextContent('Sin conexión a internet');
    expect(screen.getByRole('button', { name: 'Crear mi licencia gratuita' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /ya tengo una licencia/i }));
    expect(screen.getByRole('textbox', { name: 'Clave de licencia' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Acceder con licencia' })).toBeDisabled();
    expect(handleLogin).not.toHaveBeenCalled();
    expect(handleFreeTrial).not.toHaveBeenCalled();
  });
});
