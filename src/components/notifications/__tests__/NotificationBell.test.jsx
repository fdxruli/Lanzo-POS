// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  state: null
}));

const local = vi.hoisted(() => ({
  snapshot: null,
  markSeen: vi.fn(),
  refresh: vi.fn(async () => ({ status: 'ready' }))
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(store.state))
}));

vi.mock('../../../hooks/useInventoryOperationalAlertsSnapshot', () => ({
  useInventoryOperationalAlertsSnapshot: () => local.snapshot
}));

vi.mock('../../../services/localInventoryOperationalAlerts', () => ({
  markCurrentLocalInventoryOperationalAlertsSeen: local.markSeen,
  refreshLocalInventoryOperationalAlertsSnapshot: local.refresh
}));

vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => ({
    status: 'granted',
    actorType: 'admin',
    actorId: 'admin-1',
    sessionId: 'admin-session-1',
    permissions: ['*']
  })
}));

import NotificationBell from '../NotificationBell';

const emptyLocalSnapshot = () => ({
  catalogSize: 0,
  alerts: [],
  activeCount: 0,
  criticalCount: 0,
  warningCount: 0,
  outOfStockCount: 0,
  lowStockCount: 0,
  expiredCount: 0,
  expiringCount: 0,
  unseenCount: 0,
  status: 'ready',
  loading: false,
  error: null,
  updatedAt: '2026-09-22T12:00:00.000Z'
});

const createState = () => ({
  showTicker: true,
  licenseDetails: {
    features: {
      local_inventory_alerts: true,
      notification_center: false,
      cloud_notifications: false
    }
  },
  currentDeviceRole: 'admin',
  currentStaffUser: null,
  deviceFingerprint: 'device-a',
  notifications: [],
  notificationsUnreadCount: 0,
  notificationsUnseenCount: 0,
  notificationsLoading: false,
  notificationsError: null,
  isNotificationCenterOpen: false,
  openNotificationCenter: vi.fn(),
  closeNotificationCenter: vi.fn(),
  loadNotifications: vi.fn(),
  markNotificationsSeen: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
  archiveNotification: vi.fn(),
  supportTickets: [],
  supportTicketsLoading: false,
  supportTicketsError: null,
  activeSupportTicket: null,
  supportTicketMessages: [],
  supportTicketThreadLoading: false,
  supportTicketThreadError: null,
  supportTicketSubmitting: false,
  supportTicketView: 'list',
  loadSupportTickets: vi.fn(),
  openSupportTicket: vi.fn(),
  createTicket: vi.fn(),
  replyTicket: vi.fn(),
  closeTicket: vi.fn(),
  showSupportTicketForm: vi.fn(),
  showSupportTicketList: vi.fn(),
  notificationCenterRequestedTab: null,
  notificationCenterRequestedTicketId: null,
  clearNotificationCenterRequest: vi.fn(),
  notificationPreferences: {},
  loadNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
  resetNotificationPreferences: vi.fn(),
  muteNotificationCategory: vi.fn(),
  unmuteNotificationCategory: vi.fn(),
  ecommercePublishedStockAlertSnapshot: null,
  ecommercePublishedStockAlertLoading: false,
  ecommercePublishedStockAlertError: null,
  ecommercePublishedStockAlertLoadedAt: null,
  ecommercePublishedStockAlertContextKey: null,
  loadEcommercePublishedStockAlerts: vi.fn(),
  invalidateEcommercePublishedStockAlerts: vi.fn(),
  clearEcommercePublishedStockAlerts: vi.fn()
});

const cloudLicense = () => ({
  license_key: 'license-a',
  features: {
    local_inventory_alerts: true,
    ticker_mode: 'summary',
    notification_center: true,
    cloud_notifications: true,
    support_channel: 'in_app',
    support_center: true
  }
});

const renderBell = (props = {}) => render(
  <MemoryRouter>
    <NotificationBell {...props} />
  </MemoryRouter>
);

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  store.state = createState();
  local.snapshot = emptyLocalSnapshot();
});

describe('NotificationBell', () => {
  it('renders the dedicated local inventory bell for Free/Local', () => {
    renderBell();

    expect(screen.getByRole('button', {
      name: /Abrir alertas operativas de inventario, 0 activas/i
    })).toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: /Abrir centro de notificaciones/i
    })).not.toBeInTheDocument();
  });

  it('uses active local incidents for the badge and opening does not clear it', async () => {
    local.snapshot = {
      ...emptyLocalSnapshot(),
      activeCount: 6,
      criticalCount: 2,
      warningCount: 4,
      outOfStockCount: 1,
      lowStockCount: 3,
      expiredCount: 1,
      expiringCount: 1,
      unseenCount: 6,
      alerts: [{
        incidentId: 'inventory-stock:p1',
        productId: 'p1',
        productName: 'Producto',
        type: 'out_of_stock',
        severity: 'critical',
        availableStock: 0,
        isSeen: false
      }]
    };

    renderBell();

    const bell = screen.getByRole('button', {
      name: /Abrir alertas operativas de inventario, 6 activas/i
    });
    expect(screen.getByText('6')).toBeInTheDocument();

    fireEvent.click(bell);

    expect(screen.getByRole('dialog', {
      name: 'Inventario requiere atención'
    })).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    await waitFor(() => expect(local.markSeen).toHaveBeenCalledTimes(1));
  });

  it('keeps the Free/local bell and full active badge when the ticker is hidden', () => {
    store.state = {
      ...createState(),
      showTicker: false
    };
    local.snapshot = {
      ...emptyLocalSnapshot(),
      activeCount: 6,
      criticalCount: 2,
      warningCount: 4,
      outOfStockCount: 2,
      lowStockCount: 2,
      expiredCount: 1,
      expiringCount: 1,
      unseenCount: 1
    };

    renderBell();

    expect(screen.getByRole('button', {
      name: /Abrir alertas operativas de inventario, 6 activas/i
    })).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('caps the local active badge at 99+', () => {
    local.snapshot = {
      ...emptyLocalSnapshot(),
      activeCount: 100,
      outOfStockCount: 100,
      criticalCount: 100
    };

    renderBell();

    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(screen.getByLabelText('100 alertas operativas activas')).toBeInTheDocument();
  });

  it('hides the local bell from Staff without products or inventory authority', () => {
    store.state = {
      ...createState(),
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-restricted',
        permissions: {
          notifications: false,
          products: false,
          inventory: false
        }
      }
    };

    renderBell();

    expect(screen.queryByRole('button', {
      name: /alertas operativas de inventario/i
    })).not.toBeInTheDocument();
  });

  it('Free opens zero cloud notification/support paths', () => {
    local.snapshot = {
      ...emptyLocalSnapshot(),
      activeCount: 1,
      outOfStockCount: 1,
      criticalCount: 1,
      alerts: [{
        incidentId: 'inventory-stock:p1',
        productId: 'p1',
        productName: 'Producto',
        type: 'out_of_stock',
        severity: 'critical',
        availableStock: 0,
        isSeen: false
      }]
    };

    renderBell();
    fireEvent.click(screen.getByRole('button', {
      name: /Abrir alertas operativas de inventario/i
    }));

    expect(store.state.loadNotifications).not.toHaveBeenCalled();
    expect(store.state.markNotificationsSeen).not.toHaveBeenCalled();
    expect(store.state.markNotificationRead).not.toHaveBeenCalled();
    expect(store.state.markAllNotificationsRead).not.toHaveBeenCalled();
    expect(store.state.archiveNotification).not.toHaveBeenCalled();
    expect(store.state.loadSupportTickets).not.toHaveBeenCalled();
    expect(store.state.loadNotificationPreferences).not.toHaveBeenCalled();
  });

  it('localOnly does not render a second local drawer on Pro/Nube', () => {
    store.state = {
      ...createState(),
      licenseDetails: cloudLicense()
    };

    renderBell({ localOnly: true });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses unseen for the Pro cloud bell and preserves unread for the drawer', () => {
    store.state = {
      ...createState(),
      licenseDetails: cloudLicense(),
      notificationsUnreadCount: 25,
      notificationsUnseenCount: 3
    };

    renderBell();

    fireEvent.click(screen.getByRole('button', {
      name: /Abrir centro de notificaciones, 3 nuevas/i
    }));

    expect(store.state.openNotificationCenter).toHaveBeenCalledTimes(1);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('25')).not.toBeInTheDocument();
  });

  it('Pro opening the cloud drawer marks seen but not read', async () => {
    store.state = {
      ...createState(),
      licenseDetails: cloudLicense(),
      isNotificationCenterOpen: true,
      notificationsUnreadCount: 1,
      notificationsUnseenCount: 1,
      notifications: [{
        id: 'notification-1',
        title: 'Alerta',
        body: 'Requiere revisión',
        is_seen: false,
        is_read: false,
        is_archived: false
      }]
    };

    renderBell();

    await waitFor(() => {
      expect(store.state.loadNotifications).toHaveBeenCalled();
      expect(store.state.markNotificationsSeen).toHaveBeenCalledTimes(1);
    });
    expect(store.state.markNotificationRead).not.toHaveBeenCalled();
    expect(store.state.markAllNotificationsRead).not.toHaveBeenCalled();
    expect(local.markSeen).not.toHaveBeenCalled();
  });

  it('keeps the existing Pro cloud drawer and closes it with Escape', () => {
    store.state = {
      ...createState(),
      licenseDetails: cloudLicense(),
      isNotificationCenterOpen: true
    };

    renderBell();

    expect(screen.getByRole('dialog', { name: 'Centro de notificaciones' }))
      .toBeInTheDocument();
    expect(screen.getByText('No tienes notificaciones por ahora.')).toBeInTheDocument();
    expect(screen.queryByText('Soporte Lanzo Nube')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Inventario requiere atención' }))
      .not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(store.state.closeNotificationCenter).toHaveBeenCalledTimes(1);
  });

  it('keeps the ecommerce operational signal separate from Pro unseen count', () => {
    store.state = {
      ...createState(),
      licenseDetails: cloudLicense(),
      notificationsUnreadCount: 8,
      notificationsUnseenCount: 2,
      ecommercePublishedStockAlertContextKey: 'license-a:admin:admin:device-a',
      ecommercePublishedStockAlertSnapshot: {
        success: true,
        portalStatus: 'published',
        outOfStockCount: 3,
        products: []
      }
    };

    renderBell();

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByLabelText(
      'Alerta operacional: productos publicados sin stock'
    )).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: /2 nuevas, alerta operacional de ecommerce activa/i
    })).toBeInTheDocument();
  });

  it('keeps the existing Pro ecommerce card without local Free count contamination', async () => {
    local.snapshot = {
      ...emptyLocalSnapshot(),
      activeCount: 45,
      outOfStockCount: 45
    };
    store.state = {
      ...createState(),
      licenseDetails: cloudLicense(),
      isNotificationCenterOpen: true,
      ecommercePublishedStockAlertContextKey: 'license-a:admin:admin:device-a',
      ecommercePublishedStockAlertSnapshot: {
        success: true,
        portalStatus: 'published',
        outOfStockCount: 1,
        products: []
      }
    };

    renderBell();

    expect(await screen.findByText('Productos publicados sin stock'))
      .toBeInTheDocument();
    expect(screen.queryByText('45')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar productos' }));

    expect(store.state.closeNotificationCenter).toHaveBeenCalledTimes(1);
    expect(store.state.markNotificationRead).not.toHaveBeenCalled();
    expect(store.state.archiveNotification).not.toHaveBeenCalled();
  });
});
