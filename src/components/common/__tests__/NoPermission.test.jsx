// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  runtimeSnapshot: null,
  access: { isAuthorizedActor: false, isVerifyingAccess: false, canAccessPermission: () => false, runtimeSnapshot: null },
  initializeApp: vi.fn()
}));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: (selector) => selector({
  licenseDetails: null, initializeApp: mocks.initializeApp, _isInitializing: false
}) }));
vi.mock('../../../services/auth/useActorAccess', () => ({ useActorAccess: () => mocks.access }));
vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => mocks.runtimeSnapshot
}));
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import NoPermission from '../NoPermission';

afterEach(() => {
  cleanup();
  actorRuntimeController.lock('test_cleanup');
  mocks.runtimeSnapshot = null;
  mocks.access = { isAuthorizedActor: false, isVerifyingAccess: false, canAccessPermission: () => false, runtimeSnapshot: null };
  mocks.initializeApp.mockReset();
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

  it('shows pending verification and allows one safe bootstrap retry for a tenant readiness gap', async () => {
    const generation = 8371;
    mocks.runtimeSnapshot = { status: 'granted', generation };
    mocks.access = {
      isAuthorizedActor: false, isVerifyingAccess: true, runtimeSnapshot: null,
      canAccessPermission: () => false, ecommerceSession: {}
    };
    mocks.initializeApp.mockResolvedValue({ status: 'ready' });

    const { unmount } = render(<MemoryRouter><NoPermission /></MemoryRouter>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /verificando acceso a tu sesión/i })).toBeInTheDocument();
    expect(screen.queryByText(/No pudimos confirmar el acceso/i)).not.toBeInTheDocument();
    expect(screen.getByText(/seguirá protegida hasta terminar la verificación/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reintentar verificación/i }));
    await waitFor(() => expect(mocks.initializeApp).toHaveBeenCalledWith({ force: true }));
    expect(mocks.initializeApp).toHaveBeenCalledTimes(1);

    unmount();
    render(<MemoryRouter><NoPermission /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /reintentar verificación/i })).not.toBeInTheDocument();
    expect(screen.getByText(/ya se reintentó para esta sesión/i)).toBeInTheDocument();
  });

  it('keeps a confirmed Staff permission denial definitive', () => {
    mocks.runtimeSnapshot = { status: 'granted', generation: 17 };
    mocks.access = {
      isAuthorizedActor: true, isVerifyingAccess: false, actorType: 'staff', runtimeSnapshot: {},
      canAccessPermission: () => false, ecommerceSession: {}
    };

    render(<MemoryRouter><NoPermission /></MemoryRouter>);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /no tienes acceso a esta sección/i })).toBeInTheDocument();
    expect(screen.getByText(/Tu perfil no tiene permiso/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reintentar verificación/i })).not.toBeInTheDocument();
  });
});
