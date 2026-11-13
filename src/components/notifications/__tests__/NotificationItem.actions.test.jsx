// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ state: {}, actor: null, close: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign((selector) => selector(mocks.state), { getState: () => mocks.state })
}));
vi.mock('../../../services/auth/useActorAccess', () => ({ useActorAccess: () => mocks.actor }));
vi.mock('../../../services/auth/actorAccessPolicy', async (importOriginal) => ({
  ...await importOriginal(), readActorAccess: () => mocks.actor
}));

import { getNotificationAuthorizationKey } from '../../../services/notifications/notificationAccess';
import NotificationItem from '../NotificationItem';

const base = {
  id: 'notif-1', type: 'sync', severity: 'critical', title: 'Conflictos',
  body: 'Hay cambios que requieren atención.',
  action_label: 'Revisar sincronización', action_route: '/configuracion',
  metadata: { event: 'sync_errors_active' }, is_read: false, is_dismissible: true
};

const makeActor = (role = 'admin', permissionRecord = {}) => ({
  isAuthorizedActor: true,
  isAdmin: role === 'admin',
  actorType: role,
  actorId: role + '-1',
  runtimeSnapshot: {
    status: 'granted', actorType: role, actorId: role + '-1',
    sessionId: role + '-session', generation: 1,
    tenant: role + '-license', permissions: role === 'admin' ? ['*'] : permissionRecord
  },
  permissionSession: { currentDeviceRole: role, currentStaffUser: { permissions: permissionRecord } },
  ecommerceSession: { currentDeviceRole: role, currentStaffUser: { permissions: permissionRecord } },
  canAccessPermission: (key) => role === 'admin' || permissionRecord[key] === true
});

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname}{loc.search}</output>;
}

function show(notification = base, onRead = vi.fn().mockResolvedValue({ success: true }), onArchive = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <NotificationItem notification={notification} onRead={onRead} onArchive={onArchive} preferences={{}} />
      <LocationProbe />
    </MemoryRouter>
  );
  return { onRead, onArchive };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor = makeActor();
  mocks.state = {
    licenseDetails: {
      license_id: 'license-test',
      features: { notification_center: true, cloud_notifications: true, support_center: true }
    },
    closeNotificationCenter: mocks.close
  };
  mocks.state.notificationAuthorizationKey = getNotificationAuthorizationKey(mocks.state, mocks.actor);
});
afterEach(cleanup);

describe('NotificationItem safe actions', () => {
  it('NOTIF-ACTION-04: sync stays visible/readable with no misleading Review button', async () => {
    const { onRead } = show();
    expect(screen.getByText('Crítica')).toBeInTheDocument();
    expect(screen.getByText(/diagnóstico detallado todavía no está disponible/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revisar sincronización' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída' }));
    await waitFor(() => expect(onRead).toHaveBeenCalledWith('notif-1'));
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('SYNC-DIAG-06: available diagnosis opens without marking the notification read', () => {
    const onRead = vi.fn();
    const onDiagnose = vi.fn();
    render(
      <MemoryRouter initialEntries={['/']}>
        <NotificationItem notification={base} onRead={onRead} onDiagnose={onDiagnose}
          syncDiagnosticsAvailable preferences={{}} />
        <LocationProbe />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: 'Ver conflictos' })).toBeInTheDocument();
    expect(screen.queryByText(/diagnóstico detallado todavía no está disponible/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver conflictos' }));
    expect(onDiagnose).toHaveBeenCalledOnce();
    expect(onRead).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('SYNC-DIAG-03: staff never sees admin-only diagnosis', () => {
    mocks.actor = makeActor('staff', { notifications: true });
    mocks.state.notificationAuthorizationKey = getNotificationAuthorizationKey(mocks.state, mocks.actor);
    render(
      <MemoryRouter>
        <NotificationItem notification={base} syncDiagnosticsAvailable preferences={{}} />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: 'Ver conflictos' })).not.toBeInTheDocument();
  });

  it('NOTIF-ACTION-05: missing destination does not create an inert action', () => {
    show({ ...base, type: 'system', metadata: {}, action_route: null });
    expect(screen.queryByRole('button', { name: 'Revisar sincronización' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar como leída' })).toBeInTheDocument();
  });

  it('NOTIF-ACTION-09: read and archive are distinct and do not mutate the incident', async () => {
    const { onRead, onArchive } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída' }));
    await waitFor(() => expect(onRead).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: /Archivar notificación/ }));
    expect(onArchive).toHaveBeenCalledWith('notif-1');
    expect(base.metadata.event).toBe('sync_errors_active');
  });

  it('NOTIF-ACTION-10: no navigation after actor switch while read is pending', async () => {
    let finish;
    const read = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    show({ ...base, type: 'license' }, read);
    fireEvent.click(screen.getByRole('button', { name: 'Ver licencia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver licencia' }));
    expect(read).toHaveBeenCalledOnce();
    mocks.actor = makeActor('staff', { notifications: true });
    mocks.state.notificationAuthorizationKey = getNotificationAuthorizationKey(mocks.state, mocks.actor);
    finish({ success: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar como leída' })).not.toBeDisabled());
    expect(screen.getByTestId('location')).toHaveTextContent('/');
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('remote read failure keeps route unchanged and explains the failure', async () => {
    show({ ...base, type: 'license' }, vi.fn().mockResolvedValue({ success: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver licencia' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/No se pudo marcar/));
    expect(screen.getByTestId('location')).toHaveTextContent('/');
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('support action remains inside the drawer', async () => {
    const read = vi.fn().mockResolvedValue({ success: true });
    show({
      ...base, type: 'support', action_route: 'notifications:support',
      metadata: { ticket_id: 'ticket-1' }
    }, read);
    fireEvent.click(screen.getByRole('button', { name: 'Ver soporte' }));
    await waitFor(() => expect(read).toHaveBeenCalledWith('notif-1', { openSupport: true }));
    expect(screen.getByTestId('location')).toHaveTextContent('/');
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
