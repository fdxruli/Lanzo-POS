// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ runtimeSnapshot: null }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: (selector) => selector({}) }));
vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => mocks.runtimeSnapshot
}));
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import NoPermission from '../NoPermission';

afterEach(() => {
  cleanup();
  actorRuntimeController.lock('test_cleanup');
  mocks.runtimeSnapshot = null;
});

describe('NoPermission', () => {
  it('uses actor-neutral copy when runtime authority is unavailable', () => {
    render(
      <MemoryRouter>
        <NoPermission />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /no tienes acceso a esta sección/i }))
      .toBeInTheDocument();
    expect(screen.getByText(/No pudimos confirmar el acceso de tu sesión/))
      .toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/acerca-de');
    expect(screen.queryByText(/tu usuario staff/i)).not.toBeInTheDocument();
  });

  it('shows session restoration progress while continuing to block protected content', () => {
    act(() => {
      actorRuntimeController.lock('test_restore');
      actorRuntimeController.beginAuthentication({ actorType: 'admin' });
      mocks.runtimeSnapshot = actorRuntimeController.getState();
    });

    render(
      <MemoryRouter>
        <NoPermission />
      </MemoryRouter>
    );

    expect(screen.getByRole('status')).toHaveTextContent(/Verificando acceso a tu sesión/);
    expect(screen.getByText(/seguirá protegida hasta terminar la verificación/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
