// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  state: null
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(store.state))
}));

import NotificationBell from '../NotificationBell';

const createState = () => ({
  licenseDetails: {
    features: {
      notification_center: false
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
    ticker_mode: 'summary',
    notification_center: true,
    cloud_notifications: true,
    support_channel: 'in_app',
    support_center: true
  }
});

const renderBell = () => render(
  <MemoryRouter>
    <NotificationBell />
  </MemoryRouter>
);

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  store.state = createState();
});

describe('NotificationBell', () => {
  it('no renderiza la campana cuando el centro no esta habilitado', () => {
    renderBell();

    expect(screen.queryByRole('button', { name: /Abrir centro de notificaciones/i }))
      .not.toBeInTheDocument();
  });

  it('usa unseen para la campana y conserva unread para el drawer', () => {
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

  it('abrir el drawer marca visto pero no marca leído', async () => {
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
  });

  it('renderiza el drawer abierto y lo cierra con Escape', () => {
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

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(store.state.closeNotificationCenter).toHaveBeenCalledTimes(1);
  });

  it('muestra una señal separada sin alterar el contador cloud unseen', () => {
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

  it('presenta la tarjeta local sin invocar lectura o archivo cloud', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Revisar productos' }));

    expect(store.state.closeNotificationCenter).toHaveBeenCalledTimes(1);
    expect(store.state.markNotificationRead).not.toHaveBeenCalled();
    expect(store.state.archiveNotification).not.toHaveBeenCalled();
    expect(store.state.notificationsUnreadCount).toBe(0);
  });
});
