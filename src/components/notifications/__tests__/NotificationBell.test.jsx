import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationBell from '../NotificationBell';

const appState = {
  licenseDetails: {
    features: {
      notification_center: false
    }
  },
  notifications: [],
  notificationsUnreadCount: 0,
  notificationsLoading: false,
  notificationsError: null,
  isNotificationCenterOpen: false,
  openNotificationCenter: vi.fn(),
  closeNotificationCenter: vi.fn(),
  loadNotifications: vi.fn(),
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
  showSupportTicketList: vi.fn()
};

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(appState))
}));

describe('NotificationBell', () => {
  beforeEach(() => {
    appState.licenseDetails = {
      features: {
        notification_center: false
      }
    };
    appState.notifications = [];
    appState.notificationsUnreadCount = 0;
    appState.notificationsLoading = false;
    appState.notificationsError = null;
    appState.isNotificationCenterOpen = false;
    appState.openNotificationCenter = vi.fn();
    appState.closeNotificationCenter = vi.fn();
    appState.loadNotifications = vi.fn();
    appState.markAllNotificationsRead = vi.fn();
    appState.markNotificationRead = vi.fn();
    appState.archiveNotification = vi.fn();
    appState.supportTickets = [];
    appState.supportTicketsLoading = false;
    appState.supportTicketsError = null;
    appState.activeSupportTicket = null;
    appState.supportTicketMessages = [];
    appState.supportTicketThreadLoading = false;
    appState.supportTicketThreadError = null;
    appState.supportTicketSubmitting = false;
    appState.supportTicketView = 'list';
    appState.loadSupportTickets = vi.fn();
    appState.openSupportTicket = vi.fn();
    appState.createTicket = vi.fn();
    appState.replyTicket = vi.fn();
    appState.closeTicket = vi.fn();
    appState.showSupportTicketForm = vi.fn();
    appState.showSupportTicketList = vi.fn();
  });

  it('no renderiza la campana cuando el centro no esta habilitado', () => {
    render(<NotificationBell />);

    expect(screen.queryByRole('button', { name: /Abrir centro de notificaciones/i })).toBeNull();
  });

  it('solicita abrir el centro para licencias cloud con contador real', () => {
    appState.licenseDetails = {
      features: {
        ticker_mode: 'summary',
        notification_center: true,
        cloud_notifications: true,
        support_channel: 'in_app',
        support_center: true
      }
    };
    appState.notificationsUnreadCount = 3;

    render(<NotificationBell />);

    fireEvent.click(screen.getByRole('button', { name: /Abrir centro de notificaciones, 3 sin leer/i }));

    expect(appState.openNotificationCenter).toHaveBeenCalledTimes(1);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renderiza el drawer abierto y lo cierra con Escape', () => {
    appState.licenseDetails = {
      features: {
        ticker_mode: 'summary',
        notification_center: true,
        cloud_notifications: true,
        support_channel: 'in_app',
        support_center: true
      }
    };
    appState.isNotificationCenterOpen = true;

    render(<NotificationBell />);

    expect(screen.getByRole('dialog', { name: 'Centro de notificaciones' })).toBeTruthy();
    expect(screen.getByText('No tienes notificaciones por ahora.')).toBeTruthy();
    expect(screen.queryByText('Soporte Lanzo Nube')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(appState.closeNotificationCenter).toHaveBeenCalledTimes(1);
  });
});
