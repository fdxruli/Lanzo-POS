// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: null,
  actorRuntime: null,
  closeNotificationCenter: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(mocks.app)
}));

vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => mocks.actorRuntime
}));

import NotificationItem from '../NotificationItem';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

const notification = {
  id: 'inventory-notification-1',
  type: 'inventory',
  severity: 'critical',
  title: 'Producto agotado',
  body: 'Producto prueba no tiene stock disponible.',
  action_label: null,
  action_route: null,
  metadata: {
    category: 'inventory',
    classification: 'out_of_stock'
  },
  is_read: false,
  is_dismissible: true
};

const renderItem = (onRead = vi.fn().mockResolvedValue({ success: true })) => render(
  <MemoryRouter initialEntries={['/']}>
    <NotificationItem
      notification={notification}
      onRead={onRead}
      onArchive={vi.fn()}
      preferences={{}}
    />
    <LocationProbe />
  </MemoryRouter>
);

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.app = {
    closeNotificationCenter: mocks.closeNotificationCenter,
    currentDeviceRole: 'admin',
    currentStaffUser: null,
    canAccess: vi.fn(() => true)
  };
  mocks.actorRuntime = {
    status: 'granted',
    actorType: 'admin',
    actorId: 'admin-1',
    sessionId: 'admin-session-1',
    permissions: ['*']
  };
});

describe('NotificationItem inventory actor-safe navigation', () => {
  it('labels inventory explicitly and lets an authorized Admin open Reabastecimiento', async () => {
    const onRead = vi.fn().mockResolvedValue({ success: true });
    renderItem(onRead);

    expect(screen.getByText('Inventario')).toBeInTheDocument();
    expect(screen.getByText('Crítica')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));

    await waitFor(() => {
      expect(onRead).toHaveBeenCalledWith('inventory-notification-1');
      expect(mocks.closeNotificationCenter).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('location')).toHaveTextContent('/ventas?tab=restock');
    });
  });

  it('falls back to Products for Staff with products but without reports', async () => {
    mocks.app = {
      closeNotificationCenter: mocks.closeNotificationCenter,
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-products',
        permissions: { reports: false, products: true, inventory: false }
      },
      canAccess: vi.fn((permission) => permission === 'products')
    };
    mocks.actorRuntime = {
      status: 'granted',
      actorType: 'staff',
      actorId: 'staff-products',
      sessionId: 'staff-session-products',
      permissions: { reports: false, products: true, inventory: false }
    };

    renderItem();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/productos');
    });
    expect(screen.getByTestId('location')).not.toHaveTextContent('/ventas');
  });

  it('does not use the server action route when the actor has no authorized destination', async () => {
    mocks.app = {
      closeNotificationCenter: mocks.closeNotificationCenter,
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-restricted',
        permissions: { reports: false, products: false, inventory: false }
      },
      canAccess: vi.fn(() => false)
    };
    mocks.actorRuntime = {
      status: 'granted',
      actorType: 'staff',
      actorId: 'staff-restricted',
      sessionId: 'staff-session-restricted',
      permissions: { reports: false, products: false, inventory: false }
    };

    const onRead = vi.fn().mockResolvedValue({ success: true });
    renderItem(onRead);

    expect(screen.queryByRole('button', { name: 'Revisar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída' }));

    await waitFor(() => expect(onRead).toHaveBeenCalled());
    expect(screen.getByTestId('location')).toHaveTextContent('/');
    expect(mocks.closeNotificationCenter).not.toHaveBeenCalled();
  });
});
