// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: null,
  actorRuntime: null,
  access: null,
  closeNotificationCenter: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign((selector) => selector(mocks.app), { getState: () => mocks.app })
}));
vi.mock('../../../services/auth/useActorAccess', () => ({ useActorAccess: () => mocks.access }));
vi.mock('../../../services/auth/actorAccessPolicy', async (importOriginal) => ({
  ...await importOriginal(), readActorAccess: () => mocks.access
}));

import { getNotificationAuthorizationKey } from '../../../services/notifications/notificationAccess';
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

const renderItem = (onRead = vi.fn().mockResolvedValue({ success: true })) => {
  const role = mocks.actorRuntime.actorType;
  const permissions = mocks.actorRuntime.permissions;
  const isAdmin = role === 'admin';
  mocks.access = {
    isAuthorizedActor: true, isAdmin, actorType: role, actorId: mocks.actorRuntime.actorId,
    runtimeSnapshot: { ...mocks.actorRuntime, generation: 1, tenant: 'license-test' },
    permissionSession: { currentDeviceRole: role, currentStaffUser: { permissions } },
    ecommerceSession: { currentDeviceRole: role, currentStaffUser: { permissions } },
    canAccessPermission: (permission) => isAdmin || permissions?.[permission] === true
  };
  mocks.app.notificationAuthorizationKey = getNotificationAuthorizationKey(mocks.app, mocks.access);
  return render(
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
};

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.app = {
    closeNotificationCenter: mocks.closeNotificationCenter,
    currentDeviceRole: 'admin',
    currentStaffUser: null,
    canAccess: vi.fn(() => true),
    licenseDetails: {
      license_id: 'license-test',
      features: { notification_center: true, cloud_notifications: true }
    }
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

    fireEvent.click(screen.getByRole('button', { name: 'Ver reabastecimiento' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Ver productos' }));

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

    expect(screen.queryByRole('button', { name: 'Ver productos' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída' }));

    await waitFor(() => expect(onRead).toHaveBeenCalled());
    expect(screen.getByTestId('location')).toHaveTextContent('/');
    expect(mocks.closeNotificationCenter).not.toHaveBeenCalled();
  });
});
