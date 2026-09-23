// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ state: null }));
const runtime = vi.hoisted(() => ({ value: null }));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(store.state)
}));

vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => runtime.value
}));

import NotificationCenterDrawer from '../NotificationCenterDrawer';

const cloudLicense = {
  features: {
    notification_center: true,
    cloud_notifications: true,
    support_center: false,
    support_tickets: false
  }
};

const inventory = {
  id: 'inventory-1',
  type: 'inventory',
  severity: 'warning',
  title: 'Stock bajo',
  body: 'Producto con stock bajo.',
  metadata: { category: 'inventory', classification: 'low_stock' },
  is_read: false,
  is_archived: false
};

const cash = {
  id: 'cash-1',
  type: 'cash',
  severity: 'warning',
  title: 'Caja requiere atención',
  body: 'Revisa la caja.',
  metadata: { category: 'cash' },
  is_read: false,
  is_archived: false
};

const createState = (overrides = {}) => ({
  licenseDetails: cloudLicense,
  currentDeviceRole: 'admin',
  currentStaffUser: null,
  notifications: [inventory, { ...inventory, id: 'inventory-2', title: 'Producto vencido' }, cash],
  notificationsLoading: false,
  isRefreshingNotifications: false,
  notificationsError: null,
  loadNotifications: vi.fn(async () => ({ success: true })),
  markNotificationsSeen: vi.fn(async () => ({ success: true })),
  markAllNotificationsRead: vi.fn(async () => ({ success: true })),
  markNotificationRead: vi.fn(async () => ({ success: true })),
  archiveNotification: vi.fn(async () => ({ success: true })),
  supportTickets: [],
  supportTicketsLoading: false,
  isRefreshingSupport: false,
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
  closeNotificationCenter: vi.fn(),
  canAccess: vi.fn(() => true),
  ...overrides
});

const renderDrawer = () => render(
  <MemoryRouter>
    <NotificationCenterDrawer isOpen onClose={vi.fn()} unreadCount={3} />
  </MemoryRouter>
);

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  store.state = createState();
  runtime.value = {
    status: 'granted',
    actorType: 'admin',
    actorId: 'admin-1',
    sessionId: 'admin-session',
    permissions: ['*']
  };
});

describe('NotificationCenterDrawer Phase 5 Inventory category', () => {
  it('separates Inventory and Operations counts and filtering for Admin', () => {
    renderDrawer();

    expect(screen.getByRole('tab', { name: /Inventario 2 pendientes/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Operaciones 1 pendientes/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Inventario/ }));
    expect(screen.getByText('Stock bajo')).toBeInTheDocument();
    expect(screen.getByText('Producto vencido')).toBeInTheDocument();
    expect(screen.queryByText('Caja requiere atención')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Operaciones/ }));
    expect(screen.getByText('Caja requiere atención')).toBeInTheDocument();
    expect(screen.queryByText('Stock bajo')).not.toBeInTheDocument();
    expect(screen.queryByText('Producto vencido')).not.toBeInTheDocument();
  });

  it('shows Inventory to authorized Staff', () => {
    store.state = createState({
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-allowed',
        permissions: {
          notifications: true,
          notifications_inventory: true,
          notifications_operations: true
        }
      }
    });
    runtime.value = {
      status: 'granted',
      actorType: 'staff',
      actorId: 'staff-allowed',
      sessionId: 'staff-session',
      permissions: store.state.currentStaffUser.permissions
    };

    renderDrawer();

    expect(screen.getByRole('tab', { name: /Inventario 2 pendientes/i })).toBeInTheDocument();
  });

  it('hides Inventory rows, count and tab from denied Staff while keeping Operations', () => {
    store.state = createState({
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-denied',
        permissions: {
          notifications: true,
          notifications_inventory: false,
          notifications_operations: true
        }
      }
    });
    runtime.value = {
      status: 'granted',
      actorType: 'staff',
      actorId: 'staff-denied',
      sessionId: 'staff-session',
      permissions: store.state.currentStaffUser.permissions
    };

    renderDrawer();

    expect(screen.queryByRole('tab', { name: /Inventario/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Operaciones 1 pendientes/i })).toBeInTheDocument();
    expect(screen.queryByText('Stock bajo')).not.toBeInTheDocument();
    expect(screen.queryByText('Producto vencido')).not.toBeInTheDocument();
    expect(screen.getByText('Caja requiere atención')).toBeInTheDocument();
  });

  it('falls back safely to All when denied Staff requests Inventory directly', async () => {
    store.state = createState({
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-denied',
        permissions: {
          notifications: true,
          notifications_inventory: false,
          notifications_operations: true
        }
      },
      notificationCenterRequestedTab: 'inventory'
    });
    runtime.value = {
      status: 'granted',
      actorType: 'staff',
      actorId: 'staff-denied',
      sessionId: 'staff-session',
      permissions: store.state.currentStaffUser.permissions
    };

    renderDrawer();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Todas' })).toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.queryByRole('tab', { name: /Inventario/ })).not.toBeInTheDocument();
    expect(store.state.clearNotificationCenterRequest).toHaveBeenCalled();
  });

  it('accepts an Inventory requested tab for authorized Staff', async () => {
    store.state = createState({
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-allowed',
        permissions: {
          notifications: true,
          notifications_inventory: true,
          notifications_operations: true
        }
      },
      notificationCenterRequestedTab: 'inventory'
    });
    runtime.value = {
      status: 'granted',
      actorType: 'staff',
      actorId: 'staff-allowed',
      sessionId: 'staff-session',
      permissions: store.state.currentStaffUser.permissions
    };

    renderDrawer();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Inventario/ }))
        .toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getByText('Stock bajo')).toBeInTheDocument();
    expect(screen.queryByText('Caja requiere atención')).not.toBeInTheDocument();
  });

  it('fails an invalid requested tab safely back to All', async () => {
    store.state = createState({ notificationCenterRequestedTab: 'not-a-tab' });
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Todas' })).toHaveAttribute('aria-selected', 'true');
    });
    expect(store.state.clearNotificationCenterRequest).toHaveBeenCalled();
  });
});
