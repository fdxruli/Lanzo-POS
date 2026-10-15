// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';

vi.mock('lucide-react', () => {
  const Icon = ({ size: _size, ...props }) => React.createElement('svg', props);
  return {
    AlertTriangle: Icon,
    Info: Icon,
    ShieldAlert: Icon,
    ArrowRightCircle: Icon,
    CheckCheck: Icon,
    Copy: Icon,
    Mail: Icon,
    RefreshCw: Icon,
    Wifi: Icon,
    WifiOff: Icon
  };
});

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(() => ({ updateAvailable: false, isUpdating: false, runUpdate: vi.fn() })),
    subscribe: vi.fn(() => () => {})
  }
}));

vi.mock('../../../services/auth/actorOperationalHandoff', () => ({
  getActorCheckoutOwnerships: vi.fn(() => []),
  getPendingActorOperations: vi.fn(() => [])
}));

vi.mock('../../../services/Logger', () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

import ErrorBoundary from '../ErrorBoundary';
import AdminRouteRecoveryRegion from '../AdminRouteRecoveryRegion';
import { useAppStore } from '../../../store/useAppStore';
import {
  getActorCheckoutOwnerships,
  getPendingActorOperations
} from '../../../services/auth/actorOperationalHandoff';

function Bomb({ error }) {
  throw error;
}

function RecoverableSection({ error, shouldThrow }) {
  if (shouldThrow) throw error;
  return <main><h1>Ventas recuperadas</h1></main>;
}

const makeRoot = () => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return root;
};

afterEach(() => {
  cleanup();
  document.getElementById('root')?.remove();
  vi.restoreAllMocks();
});

describe('ErrorBoundary — Fase 2', () => {
  it('contains a route failure inside the content region and leaves its shell visible', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = makeRoot();

    render(
      <MemoryRouter initialEntries={['/ventas']}>
        <nav aria-label="Navegación del POS">Navegación Lanzo</nav>
        <AdminRouteRecoveryRegion>
          <Bomb error={Object.assign(new Error('customer=private-name'), { code: 'DB_OPEN_TIMEOUT' })} />
        </AdminRouteRecoveryRegion>
      </MemoryRouter>,
      { container: root }
    );

    expect(screen.getByRole('navigation', { name: 'Navegación del POS' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No pudimos mostrar esta sección' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('private-name');
    expect(document.querySelector('.incident-recovery--critical')).not.toBeInTheDocument();
  });

  it('keeps technical details collapsed until requested and exposes the allowed metadata only', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    const root = makeRoot();
    render(
      <ErrorBoundary>
        <Bomb error={Object.assign(
          new Error('license_key=private-license customer=private-name'),
          { code: 'DB_OPEN_TIMEOUT', stack: 'at /ventas/private?access_token=hidden' }
        )} />
      </ErrorBoundary>,
      { container: root }
    );

    const details = document.querySelector('.incident-recovery__details-content');
    expect(details).toHaveAttribute('hidden');
    await user.click(screen.getByRole('button', { name: 'Detalles del problema' }));
    expect(screen.getByText('DB_OPEN_TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText('Almacenamiento local')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/private-license|private-name|access_token|hidden/);
  });

  it('keeps unknown errors at section severity instead of presenting a critical blocker', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = makeRoot();
    render(
      <ErrorBoundary createRecoveryContextGuard={() => () => true}>
        <Bomb error={new Error('unexpected failure')} />
      </ErrorBoundary>,
      { container: root }
    );

    expect(screen.getByRole('heading', { name: 'No pudimos mostrar esta sección' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar sección' })).toBeEnabled();
  });

  it('blocks the root shell for an explicitly ambiguous payment and offers verification guidance', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = makeRoot();
    render(
      <ErrorBoundary
        incidentContext={{ category: 'financial_operation', outcomeUnknown: true }}
        openSupportMailto={vi.fn()}
      >
        <Bomb error={Object.assign(new Error('payment result unknown'), {
          code: 'PAYMENT_OUTCOME_UNKNOWN'
        })} />
      </ErrorBoundary>,
      { container: root }
    );

    expect(screen.getByRole('alertdialog', { name: 'Necesitamos verificar esta operación' })).toBeInTheDocument();
    expect(screen.getByText(/No vuelvas a registrar ni a repetir esta operación/)).toBeInTheDocument();
    expect(screen.getByText(/recibo o ledger canónico/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar sección' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver al inicio' })).not.toBeInTheDocument();
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.inert).toBe(true);
  });

  it('does not show an update action without an available update or while actor work is active', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = makeRoot();
    useAppStore.getState.mockReturnValue({
      updateAvailable: true,
      isUpdating: false,
      runUpdate: vi.fn()
    });
    getActorCheckoutOwnerships.mockReturnValue([{ orderId: 'opaque' }]);
    getPendingActorOperations.mockReturnValue([]);

    render(
      <ErrorBoundary createRecoveryContextGuard={() => () => true}>
        <Bomb error={Object.assign(new Error('render failure'), { code: 'CHUNK_LOAD_FAILED' })} />
      </ErrorBoundary>,
      { container: root }
    );

    expect(screen.queryByRole('button', { name: 'Actualizar aplicación' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('does not loop after a failed retry and restores focus to the recovery heading', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = makeRoot();
    render(
      <ErrorBoundary createRecoveryContextGuard={() => () => true}>
        <Bomb error={new Error('repeat render failure')} />
      </ErrorBoundary>,
      { container: root }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar sección' }));
    const retryButton = await screen.findByRole('button', { name: 'Reintento utilizado' });
    expect(retryButton).toBeDisabled();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No pudimos mostrar esta sección' })).toHaveFocus();
    });
  });

  it('blocks navigation and retries after the recovery context becomes stale', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = makeRoot();
    render(
      <MemoryRouter initialEntries={['/ventas']}>
        <ErrorBoundary createRecoveryContextGuard={() => () => false}>
          <Bomb error={new Error('temporary section failure')} />
        </ErrorBoundary>
      </MemoryRouter>,
      { container: root }
    );

    expect(screen.queryByRole('button', { name: 'Volver al inicio' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reabrir sección desde el contexto actual/i })).toBeDisabled();
  });

  it('moves keyboard focus to the restored section after a verified retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = makeRoot();
    const error = new Error('temporary route failure');
    const { rerender } = render(
      <ErrorBoundary createRecoveryContextGuard={() => () => true}>
        <RecoverableSection error={error} shouldThrow />
      </ErrorBoundary>,
      { container: root }
    );

    rerender(
      <ErrorBoundary createRecoveryContextGuard={() => () => true}>
        <RecoverableSection error={error} shouldThrow={false} />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar sección' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Ventas recuperadas' })).toHaveFocus();
    });
  });

  it('uses theme tokens and responsive layouts without forced dark colors or important overrides', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/common/ErrorBoundary.css'), 'utf8');
    expect(css).toContain('var(--background-color)');
    expect(css).toContain('var(--brand-accent)');
    expect(css).toContain('env(safe-area-inset-top');
    expect(css).toContain('100dvh');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).not.toContain('!important');
    expect(css).not.toMatch(/#(?:000|111318|ff4d5f)/i);
  });
});
