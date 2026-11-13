// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ state: null, actor: null, fetchDiagnostics: vi.fn() }));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign((selector) => selector(mocks.state), {
    getState: () => mocks.state
  })
}));
vi.mock('../../../services/auth/useActorAccess', () => ({
  useActorAccess: () => mocks.actor
}));
vi.mock('../../../services/auth/actorAccessPolicy', async (importOriginal) => ({
  ...await importOriginal(),
  readActorAccess: () => mocks.actor
}));
vi.mock('../../../services/notifications/cloudSyncConflictDiagnostics', () => ({
  fetchCloudSyncConflictDiagnostics: (...args) => mocks.fetchDiagnostics(...args)
}));

import { getNotificationAuthorizationKey } from '../../../services/notifications/notificationAccess';
import NotificationCenterDrawer from '../NotificationCenterDrawer';

const license = {
  license_id: 'license-a',
  features: {
    notification_center: true,
    cloud_notifications: true,
    support_center: false,
    support_tickets: false
  }
};

const syncAlert = {
  id: 'sync-1',
  type: 'sync',
  severity: 'critical',
  title: 'Conflictos de sincronización',
  body: 'Hay cambios que requieren atención.',
  action_route: '/configuracion',
  metadata: { event: 'sync_errors_active' },
  is_read: false,
  is_archived: false
};

const availableResult = {
  available: true,
  summary: {
    pendingCount: 1,
    entities: [{ type: 'product', count: 1 }],
    conflictTypes: [{ type: 'VERSION_CONFLICT', count: 1 }],
    lastIncidentAt: null,
    checkedAt: null
  }
};

const makeActor = (actorType = 'admin', sessionId = `${actorType}-session`) => {
  const isAdmin = actorType === 'admin';
  const permissions = isAdmin ? ['*'] : { notifications: true };
  const permissionSession = {
    currentDeviceRole: actorType,
    currentStaffUser: isAdmin ? null : { id: 'staff-a', permissions }
  };
  return {
    isAuthorizedActor: true,
    isAdmin,
    actorType,
    actorId: isAdmin ? 'admin-a' : 'staff-a',
    permissionSession,
    ecommerceSession: permissionSession,
    runtimeSnapshot: {
      status: 'granted',
      actorType,
      actorId: isAdmin ? 'admin-a' : 'staff-a',
      sessionId,
      generation: 1,
      tenant: 'tenant-a',
      deviceRef: 'device-a',
      permissions
    },
    canAccessPermission: (permission) => isAdmin || permissions[permission] === true
  };
};

const createState = (overrides = {}) => ({
  licenseDetails: license,
  currentDeviceRole: 'admin',
  currentAdminUser: { id: 'admin-a' },
  currentStaffUser: null,
  notifications: [syncAlert],
  notificationsAccessDenied: false,
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
  loadSupportTickets: vi.fn(async () => ({ success: true })),
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
  ...overrides
});

const renderDrawer = (options = {}) => {
  mocks.state.notificationAuthorizationKey = getNotificationAuthorizationKey(mocks.state, mocks.actor);
  return render(
    <MemoryRouter>
      <NotificationCenterDrawer isOpen onClose={vi.fn()} unreadCount={1} {...options} />
    </MemoryRouter>
  );
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor = makeActor();
  mocks.state = createState();
});
afterEach(cleanup);

describe('NotificationCenterDrawer sync diagnostics recovery', () => {
  it('keeps the informative fallback when the initial Cloud probe fails', async () => {
    mocks.fetchDiagnostics.mockRejectedValueOnce(new Error('network unavailable'));
    renderDrawer();

    await waitFor(() => expect(mocks.fetchDiagnostics).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'Ver conflictos' })).not.toBeInTheDocument();
    expect(screen.getByText(/diagnóstico detallado todavía no está disponible/i)).toBeInTheDocument();
  });

  it('retries after Refresh and exposes diagnosis without reopening the drawer', async () => {
    mocks.fetchDiagnostics
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(availableResult);
    renderDrawer();

    await waitFor(() => expect(mocks.fetchDiagnostics).toHaveBeenCalledOnce());
    const initialNotificationLoads = mocks.state.loadNotifications.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));

    expect(mocks.state.loadNotifications).toHaveBeenCalledTimes(initialNotificationLoads + 1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar' })).toBeEnabled());
    expect(mocks.fetchDiagnostics).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: 'Ver conflictos' })).toBeInTheDocument();
    expect(screen.getByText('Notificaciones')).toBeInTheDocument();
  });

  it('keeps diagnosis disabled when the retry fails or the RPC is absent', async () => {
    mocks.fetchDiagnostics
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockRejectedValueOnce(new Error('still offline'));
    renderDrawer();

    await waitFor(() => expect(mocks.fetchDiagnostics).toHaveBeenCalledOnce());
    const initialNotificationLoads = mocks.state.loadNotifications.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(mocks.state.loadNotifications).toHaveBeenCalledTimes(initialNotificationLoads + 1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar' })).toBeEnabled());
    expect(mocks.fetchDiagnostics).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Ver conflictos' })).not.toBeInTheDocument();

    cleanup();
    vi.clearAllMocks();
    mocks.state = createState();
    mocks.actor = makeActor();
    mocks.fetchDiagnostics.mockResolvedValueOnce({ available: false, summary: null });
    renderDrawer();
    await waitFor(() => expect(mocks.fetchDiagnostics).toHaveBeenCalledOnce());
    expect(screen.getByText(/diagnóstico detallado todavía no está disponible/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(mocks.state.loadNotifications).toHaveBeenCalled());
    expect(mocks.fetchDiagnostics).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Ver conflictos' })).not.toBeInTheDocument();
  });

  it('does not probe for Staff and keeps access-denied results disabled', async () => {
    mocks.actor = makeActor('staff');
    mocks.state = createState({
      currentDeviceRole: 'staff',
      currentAdminUser: null,
      currentStaffUser: { id: 'staff-a', permissions: { notifications: true } }
    });
    renderDrawer();
    expect(mocks.fetchDiagnostics).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Ver conflictos' })).not.toBeInTheDocument();

    cleanup();
    vi.clearAllMocks();
    mocks.actor = makeActor();
    mocks.state = createState();
    mocks.fetchDiagnostics.mockRejectedValueOnce(Object.assign(new Error('denied'), { status: 403 }));
    renderDrawer();
    await waitFor(() => expect(mocks.fetchDiagnostics).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'Ver conflictos' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar' })).toBeEnabled());
    expect(mocks.fetchDiagnostics).toHaveBeenCalledOnce();
  });

  it('ignores a probe response from the previous session', async () => {
    const previousSession = deferred();
    const currentSession = deferred();
    mocks.fetchDiagnostics.mockReturnValueOnce(previousSession.promise).mockReturnValueOnce(currentSession.promise);
    const view = renderDrawer();
    await waitFor(() => expect(mocks.fetchDiagnostics).toHaveBeenCalledOnce());

    mocks.actor = makeActor('admin', 'admin-session-2');
    mocks.state.notificationAuthorizationKey = getNotificationAuthorizationKey(mocks.state, mocks.actor);
    view.rerender(
      <MemoryRouter>
        <NotificationCenterDrawer isOpen onClose={vi.fn()} unreadCount={1} />
      </MemoryRouter>
    );
    await waitFor(() => expect(mocks.fetchDiagnostics).toHaveBeenCalledTimes(2));

    previousSession.resolve(availableResult);
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: 'Ver conflictos' })).not.toBeInTheDocument();
    currentSession.resolve(availableResult);
    expect(await screen.findByRole('button', { name: 'Ver conflictos' })).toBeInTheDocument();
  });

  it('deduplicates Refresh probes already in progress and keeps notification refresh', async () => {
    const retry = deferred();
    mocks.fetchDiagnostics
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockReturnValueOnce(retry.promise);
    renderDrawer();
    await waitFor(() => expect(mocks.fetchDiagnostics).toHaveBeenCalledOnce());

    const notificationLoadsBeforeRefresh = mocks.state.loadNotifications.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(mocks.state.loadNotifications).toHaveBeenCalledTimes(notificationLoadsBeforeRefresh + 1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar' })).toBeEnabled());
    expect(mocks.fetchDiagnostics).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(mocks.state.loadNotifications).toHaveBeenCalledTimes(notificationLoadsBeforeRefresh + 2));
    expect(mocks.fetchDiagnostics).toHaveBeenCalledTimes(2);

    retry.resolve(availableResult);
    expect(await screen.findByRole('button', { name: 'Ver conflictos' })).toBeInTheDocument();
  });

  it('does not duplicate the initial probe during the app StrictMode mount replay', async () => {
    const initialProbe = deferred();
    mocks.fetchDiagnostics.mockReturnValue(initialProbe.promise);
    mocks.state.notificationAuthorizationKey = getNotificationAuthorizationKey(mocks.state, mocks.actor);
    render(
      <StrictMode>
        <MemoryRouter>
          <NotificationCenterDrawer isOpen onClose={vi.fn()} unreadCount={1} />
        </MemoryRouter>
      </StrictMode>
    );

    await waitFor(() => expect(mocks.fetchDiagnostics).toHaveBeenCalledOnce());
    initialProbe.resolve(availableResult);
    expect(await screen.findByRole('button', { name: 'Ver conflictos' })).toBeInTheDocument();
    expect(mocks.fetchDiagnostics).toHaveBeenCalledOnce();
  });

  it('keeps Support refresh behavior while the sync alert is present', async () => {
    mocks.state = createState({
      licenseDetails: {
        ...license,
        features: { ...license.features, support_center: true, support_tickets: true }
      }
    });
    mocks.fetchDiagnostics.mockResolvedValueOnce(availableResult);
    renderDrawer();
    fireEvent.click(screen.getByRole('tab', { name: /Soporte/ }));
    await waitFor(() => expect(mocks.state.loadSupportTickets).toHaveBeenCalled());
    const supportLoadsBeforeRefresh = mocks.state.loadSupportTickets.mock.calls.length;
    const notificationLoadsBeforeRefresh = mocks.state.loadNotifications.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(mocks.state.loadSupportTickets).toHaveBeenCalledTimes(supportLoadsBeforeRefresh + 1));
    expect(mocks.state.loadNotifications).toHaveBeenCalledTimes(notificationLoadsBeforeRefresh + 1);
    expect(mocks.fetchDiagnostics).toHaveBeenCalledOnce();
  });
});
