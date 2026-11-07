// @vitest-environment jsdom
import { grantTestActor } from '../../../../services/auth/__tests__/actorAccessTestHarness';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ state: null, runtime: null }));
vi.mock('../../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => store.runtime
}));

vi.mock('../../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(store.state)
}));

import EcommerceOrdersRoute from '../EcommerceOrdersRoute';

const routeTree = () => (
  <MemoryRouter>
    <EcommerceOrdersRoute>
      <div>Bandeja autorizada</div>
    </EcommerceOrdersRoute>
  </MemoryRouter>
);

const renderRoute = () => render(routeTree());

const baseState = () => ({
  licenseDetails: { features: { ecommerce_order_inbox: true } },
  currentDeviceRole: 'admin',
  currentAdminUser: { id: 'admin-a' },
  currentStaffUser: null,
  _isInitializing: false
});

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  store.state = baseState();
  store.runtime = grantTestActor({ actorType: 'admin', actorId: 'admin-a' });
});

describe('EcommerceOrdersRoute', () => {
  it('allows an admin with the inbox feature', () => {
    store.runtime = grantTestActor({
      actorType: store.state.currentDeviceRole,
      actorId: store.state.currentDeviceRole === 'staff' ? 'staff-a' : 'admin-a',
      permissions: store.state.currentStaffUser?.permissions || []
    });
    renderRoute();
    expect(screen.getByText('Bandeja autorizada')).toBeInTheDocument();
  });

  it('allows staff with ecommerce even when settings and notifications are disabled', () => {
    store.state = {
      ...baseState(),
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-a',
        permissions: {
          ecommerce: true,
          settings: false,
          notifications: false
        }
      }
    };

    store.runtime = grantTestActor({
      actorType: store.state.currentDeviceRole,
      actorId: store.state.currentDeviceRole === 'staff' ? 'staff-a' : 'admin-a',
      permissions: store.state.currentStaffUser?.permissions || []
    });
    renderRoute();
    expect(screen.getByText('Bandeja autorizada')).toBeInTheDocument();
  });

  it('blocks direct navigation for staff without ecommerce', () => {
    store.state = {
      ...baseState(),
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-a',
        permissions: {
          ecommerce: false,
          settings: true,
          notifications: true
        }
      }
    };

    renderRoute();
    expect(screen.getByRole('alert')).toHaveTextContent('No tienes acceso');
    expect(screen.queryByText('Bandeja autorizada')).not.toBeInTheDocument();
  });

  it('blocks every actor when the inbox feature is disabled', () => {
    store.state = {
      ...baseState(),
      licenseDetails: { features: { ecommerce_order_inbox: false } }
    };

    renderRoute();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows a loading state instead of a permission flash while role restoration is active', () => {
    store.state = {
      ...baseState(),
      currentDeviceRole: null,
      _isInitializing: true
    };

    renderRoute();

    expect(screen.getByRole('status')).toHaveTextContent('Cargando permisos');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Bandeja autorizada')).not.toBeInTheDocument();
  });

  it('blocks a null role when bootstrap is no longer active', () => {
    store.state = {
      ...baseState(),
      currentDeviceRole: null,
      _isInitializing: false
    };

    renderRoute();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('reveals access when an unresolved role becomes admin', () => {
    store.state = {
      ...baseState(),
      currentDeviceRole: null,
      _isInitializing: true
    };
    const view = renderRoute();
    expect(screen.getByRole('status')).toBeInTheDocument();

    store.state = {
      ...baseState(),
      currentDeviceRole: 'admin',
      _isInitializing: false
    };
    store.runtime = grantTestActor({
      actorType: store.state.currentDeviceRole,
      actorId: store.state.currentDeviceRole === 'staff' ? 'staff-a' : 'admin-a',
      permissions: store.state.currentStaffUser?.permissions || []
    });
    view.rerender(routeTree());

    expect(screen.getByText('Bandeja autorizada')).toBeInTheDocument();
  });

  it('reveals access when an unresolved role becomes authorized staff', () => {
    store.state = {
      ...baseState(),
      currentDeviceRole: null,
      _isInitializing: true
    };
    const view = renderRoute();

    store.state = {
      ...baseState(),
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-a', permissions: { ecommerce: true, settings: false } },
      _isInitializing: false
    };
    store.runtime = grantTestActor({
      actorType: store.state.currentDeviceRole,
      actorId: store.state.currentDeviceRole === 'staff' ? 'staff-a' : 'admin-a',
      permissions: store.state.currentStaffUser?.permissions || []
    });
    view.rerender(routeTree());

    expect(screen.getByText('Bandeja autorizada')).toBeInTheDocument();
  });

  it('remains blocked when an unresolved role becomes staff without ecommerce', () => {
    store.state = {
      ...baseState(),
      currentDeviceRole: null,
      _isInitializing: true
    };
    const view = renderRoute();

    store.state = {
      ...baseState(),
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-a', permissions: { ecommerce: false, settings: true } },
      _isInitializing: false
    };
    store.runtime = grantTestActor({
      actorType: store.state.currentDeviceRole,
      actorId: store.state.currentDeviceRole === 'staff' ? 'staff-a' : 'admin-a',
      permissions: store.state.currentStaffUser?.permissions || []
    });
    view.rerender(routeTree());

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Bandeja autorizada')).not.toBeInTheDocument();
  });

  it('blocks an unknown role', () => {
    store.state = {
      ...baseState(),
      currentDeviceRole: 'owner'
    };

    renderRoute();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
