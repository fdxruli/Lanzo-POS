// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ state: null }));

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
  currentStaffUser: null,
  _isInitializing: false
});

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  store.state = baseState();
});

describe('EcommerceOrdersRoute', () => {
  it('allows an admin with the inbox feature', () => {
    renderRoute();
    expect(screen.getByText('Bandeja autorizada')).toBeInTheDocument();
  });

  it('allows staff with ecommerce even when settings and notifications are disabled', () => {
    store.state = {
      ...baseState(),
      currentDeviceRole: 'staff',
      currentStaffUser: {
        permissions: {
          ecommerce: true,
          settings: false,
          notifications: false
        }
      }
    };

    renderRoute();
    expect(screen.getByText('Bandeja autorizada')).toBeInTheDocument();
  });

  it('blocks direct navigation for staff without ecommerce', () => {
    store.state = {
      ...baseState(),
      currentDeviceRole: 'staff',
      currentStaffUser: {
        permissions: {
          ecommerce: false,
          settings: true,
          notifications: true
        }
      }
    };

    renderRoute();
    expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso');
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
      currentStaffUser: { permissions: { ecommerce: true, settings: false } },
      _isInitializing: false
    };
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
      currentStaffUser: { permissions: { ecommerce: false, settings: true } },
      _isInitializing: false
    };
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
