// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  closeNotificationCenter: vi.fn(), app: {}, access: null
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
  id: 'notification-1',
  type: 'ecommerce',
  severity: 'info',
  title: 'Nuevo pedido online EC-00000011',
  body: '1 artículo · $20.00 MXN · Recoger en el negocio',
  action_label: 'Ver pedido',
  action_route: '/pedidos-online?order=11111111-1111-4111-8111-111111111111',
  metadata: { category: 'ecommerce' },
  is_read: false,
  is_dismissible: true
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access = {
    isAuthorizedActor: true, isAdmin: true, actorType: 'admin', actorId: 'admin-1',
    runtimeSnapshot: {
      status: 'granted', actorType: 'admin', actorId: 'admin-1',
      sessionId: 'admin-session-1', generation: 1, tenant: 'license-test', permissions: ['*']
    },
    permissionSession: { currentDeviceRole: 'admin', currentStaffUser: { permissions: {} } },
    ecommerceSession: { currentDeviceRole: 'admin', currentStaffUser: { permissions: {} } },
    canAccessPermission: () => true
  };
  mocks.app = {
    closeNotificationCenter: mocks.closeNotificationCenter,
    licenseDetails: {
      license_id: 'license-test',
      features: { notification_center: true, cloud_notifications: true, ecommerce_order_inbox: true }
    }
  };
  mocks.app.notificationAuthorizationKey = getNotificationAuthorizationKey(mocks.app, mocks.access);
});

describe('NotificationItem ecommerce', () => {
  it('shows the ecommerce label, marks read, closes the center and navigates', async () => {
    const onRead = vi.fn().mockResolvedValue({ success: true });

    render(
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

    expect(screen.getByText('Pedidos online')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver pedido' }));

    await waitFor(() => {
      expect(onRead).toHaveBeenCalledWith('notification-1');
      expect(mocks.closeNotificationCenter).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('location'))
        .toHaveTextContent('/pedidos-online?order=11111111-1111-4111-8111-111111111111');
    });
  });

  it('does not navigate when marking read is denied', async () => {
    const onRead = vi.fn().mockResolvedValue({ success: false, code: 'NOTIFICATION_NOT_FOUND' });

    render(
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

    fireEvent.click(screen.getByRole('button', { name: 'Ver pedido' }));

    await waitFor(() => expect(onRead).toHaveBeenCalled());
    expect(mocks.closeNotificationCenter).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });
});
