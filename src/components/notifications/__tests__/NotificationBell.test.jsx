import { grantTestActor } from '../../../services/auth/__tests__/actorAccessTestHarness';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import { evaluateActorAccess } from '../../../services/auth/actorAccessPolicy';
import { getNotificationAuthorizationKey } from '../../../services/notifications/notificationAccess';
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  state: null
}));
const backup = vi.hoisted(() => ({ attention: { enabled: false, ready: false } }));
const cashAge = vi.hoisted(() => ({
  mode: { cloudEnabled: false, online: true, actor: { actorKey: 'admin:admin-1' } },
  attention: {
    scopeKey: null,
    status: 'idle',
    isCloudCash: false,
    sessions: [],
    agedSessions: [],
    pendingCount: 0,
    reviewCount: 0
  }
}));
vi.mock('../../../hooks/useLocalBackupAttention', () => ({ useLocalBackupAttention: () => backup.attention }));
vi.mock('../../../hooks/useCashSessionAgeAttention', () => ({
  default: () => cashAge.attention
}));
vi.mock('../../../services/cash/cashRepository', () => ({
  cashRepository: {
    getMode: () => cashAge.mode
  }
}));

const local = vi.hoisted(() => ({
  snapshot: null,
  cashPending: null,
  markSeen: vi.fn(),
  refresh: vi.fn(async () => ({ status: 'ready' }))
}));

const cashAttention = vi.hoisted(() => ({
  buildKey: vi.fn(async ({ scopeKey, downgradedAt }) => `attention:${scopeKey}:${downgradedAt}`),
  read: vi.fn(() => ({ version: 1, readAt: null, postponedAt: null })),
  markRead: vi.fn(() => ({ version: 1, readAt: 'read', postponedAt: null }))
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(store.state))
}));

vi.mock('../../../hooks/useInventoryOperationalAlertsSnapshot', () => ({
  useInventoryOperationalAlertsSnapshot: () => local.snapshot
}));

vi.mock('../../../hooks/usePostDowngradeCashPending', () => ({
  default: () => local.cashPending
}));

vi.mock('../../../services/cash/postDowngradeCashAttention', () => ({
  buildPostDowngradeCashAttentionKey: (...args) => cashAttention.buildKey(...args),
  markPostDowngradeCashAttentionRead: (...args) => cashAttention.markRead(...args),
  POST_DOWNGRADE_CASH_ATTENTION_EVENT: 'lanzo:post-downgrade-cash-attention',
  readPostDowngradeCashAttention: (...args) => cashAttention.read(...args)
}));

vi.mock('../../../services/localInventoryOperationalAlerts', () => ({
  markCurrentLocalInventoryOperationalAlertsSeen: local.markSeen,
  refreshLocalInventoryOperationalAlertsSnapshot: local.refresh
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
  currentAdminUser: { id: 'admin-1' },
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

const renderBell = (props = {}) => {
  const snapshot = grantTestActor({
    actorType: store.state.currentDeviceRole,
    actorId: store.state.currentDeviceRole === 'staff' ? store.state.currentStaffUser?.id || 'staff-local' : 'admin-1',
    permissions: store.state.currentStaffUser?.permissions || []
  });
  store.state.notificationAuthorizationKey = getNotificationAuthorizationKey(store.state, evaluateActorAccess({ ...store.state, runtimeSnapshot: snapshot }));
  return render(
  <MemoryRouter>
    <NotificationBell {...props} />
  </MemoryRouter>
);
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  backup.attention = { enabled: false, ready: false };
  store.state = createState();
  local.snapshot = emptyLocalSnapshot();
  local.cashPending = {
    eligible: false,
    online: true,
    status: 'idle',
    pendingCount: null,
    isPostDowngrade: false,
    downgradedAt: null,
    scopeKey: null,
    refresh: vi.fn()
  };
  cashAge.mode = { cloudEnabled: false, online: true, actor: { actorKey: 'admin:admin-1' } };
  cashAge.attention = {
    scopeKey: null,
    status: 'idle',
    isCloudCash: false,
    sessions: [],
    agedSessions: [],
    pendingCount: 0,
    reviewCount: 0
  };
});

describe('backup attention in the existing local bell', () => {
  const activeAttention = () => ({
    enabled: true, ready: true, key: 'opaque-attention', record: { readStates: [] },
    condition: { key: 'unlock', active: true, severity: 'warning', title: 'Respaldos cifrados bloqueados', detail: 'Revisa tus respaldos.', action: 'Desbloquear', route: '/configuracion?tab=backup' },
    update: vi.fn(() => true)
  });
  it('counts one backup incident alongside inventory and cash, and reading does not resolve it', async () => {
    backup.attention = activeAttention();
    local.snapshot = { ...emptyLocalSnapshot(), activeCount: 2 };
    local.cashPending = { eligible: true, pendingCount: 4, scopeKey: 'scope', downgradedAt: '2026-10-01', status: 'ready' };
    renderBell();
    const bell = screen.getByRole('button', { name: /Abrir alertas locales, 4 incidencias activas/ });
    fireEvent.click(bell);
    expect(screen.getByText('Respaldos cifrados bloqueados')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída' }));
    expect(backup.attention.update).toHaveBeenCalledWith('read', 'unlock');
    expect(screen.getByText('Respaldos cifrados bloqueados')).toBeInTheDocument();
    expect(screen.getByLabelText(/4 incidencias activas: 2 de inventario/)).toBeInTheDocument();
  });
  it('exposes backups to a permitted actor without exposing inventory or marking it seen', () => {
    backup.attention = activeAttention();
    Object.assign(store.state, { currentDeviceRole: 'staff', currentStaffUser: { permissions: { sync: true, inventory: false, products: false } } });
    local.snapshot = { ...emptyLocalSnapshot(), activeCount: 8 };
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /Abrir alertas locales, 1 incidencia activa/ }));
    expect(screen.getByText('Respaldos cifrados bloqueados')).toBeInTheDocument();
    expect(screen.queryByText(/Revisando inventario|Tu inventario|8 alertas activas/)).not.toBeInTheDocument();
    expect(local.markSeen).not.toHaveBeenCalled();
  });
  it('keeps the drawer focus on preference updates and restores it on Escape', async () => {
    backup.attention = activeAttention();
    const view = renderBell();
    const bell = screen.getByRole('button', { name: /Abrir alertas locales/ });
    bell.focus(); fireEvent.click(bell);
    const close = within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar alertas locales' });
    await waitFor(() => expect(close).toHaveFocus());
    backup.attention = { ...backup.attention, record: { readStates: ['unlock'] } };
    view.rerender(<MemoryRouter><NotificationBell /></MemoryRouter>);
    expect(close).toHaveFocus();
    expect(screen.getByText('Leída · la atención sigue pendiente.')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });
  it('updates a resolved backup to an informational state without an active badge', () => {
    backup.attention = activeAttention();
    backup.attention.condition = { ...backup.attention.condition, key: 'ready', active: false, title: 'Protección local activa', action: 'Ir a respaldos' };
    renderBell();
    expect(screen.queryByLabelText(/incidencias activas:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Abrir alertas locales, 0 incidencias activas/ }));
    expect(screen.getByText('Protección local activa')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar como leída' })).not.toBeInTheDocument();
  });
});

describe('NotificationBell', () => {
  it('adds one grouped local attention for multiple old open sessions', () => {
    store.state.currentAdminUser = { ...store.state.currentAdminUser, is_owner: true };
    cashAge.attention = {
      scopeKey: 'owner-local',
      status: 'success',
      isCloudCash: false,
      sessions: [],
      agedSessions: [
        { session: { id: 'old-a' }, age: { level: 'important' } },
        { session: { id: 'old-b' }, age: { level: 'review' } }
      ],
      pendingCount: 2,
      reviewCount: 1
    };
    renderBell();

    expect(screen.getByRole('button', {
      name: /Abrir alertas locales, 1 incidencia activa; una agrupa 2 cajas abiertas antiguas/
    })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Abrir alertas locales/ }));
    expect(screen.getByText('Tienes 2 cajas abiertas que requieren revisión')).toBeInTheDocument();
    expect(screen.getByText(/1 caja lleva 3 días o más abierta/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar cajas' })).toBeInTheDocument();
  });

  it('renders the dedicated local inventory bell for Free/Local', () => {
    renderBell();

    expect(screen.getByRole('button', {
      name: /Abrir alertas operativas de inventario, 0 activas/i
    })).toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: /Abrir centro de notificaciones/i
    })).not.toBeInTheDocument();
  });

  it('opens the Free/Local alert surface for an admin reminder without counting it as an inventory alert', () => {
    store.state.licenseDetails = {
      license_key: 'license-a',
      features: {
        local_inventory_alerts: false,
        local_backup_alerts: false,
        notification_center: false,
        cloud_notifications: false
      }
    };
    store.state.companyProfile = { license_key: 'license-a', timezone: null };
    renderBell();

    const bell = screen.getByRole('button', { name: /Abrir alertas locales.*zona horaria pendiente/i });
    expect(bell.querySelector('.notification-bell__badge')).not.toBeInTheDocument();
    expect(bell.querySelector('.notification-bell__warning-dot')).toBeInTheDocument();
    fireEvent.click(bell);

    expect(screen.getByRole('heading', { name: 'Zona horaria pendiente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir a Configuración' })).toBeInTheDocument();
    expect(screen.queryByText('1 alertas activas')).not.toBeInTheDocument();
  });

  it('keeps a PRO timezone reminder in the Cloud center and outside the server counters', () => {
    store.state.licenseDetails = cloudLicense();
    store.state.companyProfile = { license_key: 'license-a', timezone: null };
    store.state.isNotificationCenterOpen = false;
    renderBell();

    const bell = screen.getByRole('button', { name: /zona horaria pendiente/i });
    expect(bell.querySelector('.notification-bell__badge')).not.toBeInTheDocument();
    expect(bell.querySelector('.notification-bell__warning-dot')).toBeInTheDocument();
  });

  it('does not expose the timezone reminder to Staff without settings access', () => {
    store.state.licenseDetails.license_key = 'license-a';
    store.state.companyProfile = { license_key: 'license-a', timezone: null };
    store.state.currentDeviceRole = 'staff';
    store.state.currentAdminUser = null;
    store.state.currentStaffUser = {
      id: 'staff-1',
      permissions: { products: true, notifications: true, settings: false }
    };
    renderBell();

    fireEvent.click(screen.getByRole('button', { name: /Abrir alertas/i }));
    expect(screen.getByRole('dialog', { name: 'Alertas locales' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Zona horaria pendiente' })).not.toBeInTheDocument();
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
      name: 'Alertas locales'
    })).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    await waitFor(() => expect(local.markSeen).toHaveBeenCalledTimes(1));
  });

  it('adds one grouped cash incident to the local badge without counting each box', async () => {
    local.snapshot = {
      ...emptyLocalSnapshot(),
      activeCount: 30,
      outOfStockCount: 30,
      unseenCount: 30
    };
    local.cashPending = {
      eligible: true,
      online: true,
      status: 'success',
      pendingCount: 7,
      isPostDowngrade: true,
      downgradedAt: '2026-09-24T05:53:00.000Z',
      scopeKey: 'LANZO-A:owner-a',
      refresh: vi.fn()
    };

    renderBell();

    const bell = await screen.findByRole('button', {
      name: /Abrir alertas locales, 31 incidencias activas; una agrupa 7 cajas/i
    });
    expect(screen.getByText('31')).toHaveAttribute(
      'aria-label',
      '31 incidencias activas: 30 de inventario y 1 de Caja y conciliación'
    );

    fireEvent.click(bell);

    expect(screen.getByRole('dialog', { name: 'Alertas locales' })).toBeInTheDocument();
    expect(screen.getByText('7 cajas pendientes de revisión')).toBeInTheDocument();
    expect(screen.getByText('30 alertas activas')).toBeInTheDocument();
    expect(screen.getByText('31')).toBeInTheDocument();
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
    local.cashPending = {
      eligible: true,
      online: true,
      status: 'success',
      pendingCount: 7,
      isPostDowngrade: true,
      downgradedAt: '2026-09-24T05:53:00.000Z',
      scopeKey: 'LANZO-A:owner-a',
      refresh: vi.fn()
    };
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
      name: /Abrir alertas locales/i
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

    expect(screen.getByRole('dialog', { name: 'Notificaciones' }))
      .toBeInTheDocument();
    expect(screen.getByText('No tienes notificaciones por ahora.')).toBeInTheDocument();
    expect(screen.queryByText('Soporte Lanzo Nube')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Alertas locales' }))
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


describe('Cloud notification authority and recovery UX', () => {
  it('hides the Cloud entry for Staff without notifications permission', () => {
    store.state = { ...createState(), licenseDetails: cloudLicense(), currentDeviceRole: 'staff', currentStaffUser: { id: 'staff-a', permissions: { pos: true, notifications: false } } };
    renderBell();
    expect(screen.queryByRole('button', { name: /Abrir centro/ })).not.toBeInTheDocument();
    expect(store.state.openNotificationCenter).not.toHaveBeenCalled();
    expect(store.state.loadNotifications).not.toHaveBeenCalled();
  });

  it('keeps the Cloud entry for a confirmed authorized Staff', () => {
    store.state = { ...createState(), licenseDetails: cloudLicense(), currentDeviceRole: 'staff', currentStaffUser: { id: 'staff-a', permissions: { notifications: true } } };
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /Abrir centro/ }));
    expect(store.state.openNotificationCenter).toHaveBeenCalledOnce();
  });

  it('removes protected content and controls when an open actor is locked', async () => {
    store.state = { ...createState(), licenseDetails: cloudLicense(), isNotificationCenterOpen: true, notifications: [{ id: 'private', title: 'Aviso privado', body: 'Información del negocio' }] };
    renderBell();
    expect(screen.getByText('Aviso privado')).toBeInTheDocument();
    act(() => actorRuntimeController.lock('revoked'));
    expect(screen.queryByText('Aviso privado')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actualizar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preferencias' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abrir centro/ })).not.toBeInTheDocument();
  });

  it('renders a permanent server rejection with close and no retry', () => {
    store.state = { ...createState(), licenseDetails: cloudLicense(), isNotificationCenterOpen: true, notificationsAccessDenied: true };
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(store.state.closeNotificationCenter).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(store.state.loadNotifications).not.toHaveBeenCalled();
  });

  it('retries a temporary connection failure and contains keyboard focus', async () => {
    store.state = { ...createState(), licenseDetails: cloudLicense(), isNotificationCenterOpen: true, notificationsError: 'No pudimos conectar. Intenta de nuevo.' };
    renderBell();
    const retry = screen.getByRole('button', { name: 'Reintentar' });
    fireEvent.click(retry);
    expect(store.state.loadNotifications).toHaveBeenCalledWith({ force: true });
    const dialog = within(screen.getByRole('dialog'));
    const close = dialog.getByRole('button', { name: 'Cerrar centro de notificaciones' });
    const refresh = dialog.getByRole('button', { name: 'Actualizar' });
    await waitFor(() => expect(close).toHaveFocus());
    refresh.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(retry).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(refresh).toHaveFocus();
  });

  it.each(['identity', 'business'])('never renders previous content on a %s change before effects reset the store', (change) => {
    store.state = { ...createState(), licenseDetails: cloudLicense(), isNotificationCenterOpen: true, notifications: [{ id: 'private', title: 'Información anterior' }] };
    const view = renderBell();
    expect(screen.getByText('Información anterior')).toBeInTheDocument();
    if (change === 'identity') store.state.currentAdminUser = { id: 'other-admin' };
    else store.state.licenseDetails = { ...cloudLicense(), license_key: 'other-business' };
    view.rerender(<MemoryRouter><NotificationBell /></MemoryRouter>);
    expect(screen.queryByText('Información anterior')).not.toBeInTheDocument();
  });
});
