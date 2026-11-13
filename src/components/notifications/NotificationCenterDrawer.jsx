import { useActorAccess } from '../../services/auth/useActorAccess';
import { readActorAccess } from '../../services/auth/actorAccessPolicy';
import { isPendingSyncConflictNotification } from '../../services/notifications/notificationActionNavigation';
import { fetchCloudSyncConflictDiagnostics } from '../../services/notifications/cloudSyncConflictDiagnostics';
import {
  canAccessCloudNotificationCenter,
  getNotificationAuthorizationKey,
  isNotificationAccessDenied,
  NOTIFICATION_ACCESS_MESSAGE
} from '../../services/notifications/notificationAccess';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import {
  canStaffAccessNotificationCategory,
  canStaffAccessSupportCenter,
  isSupportCenterEnabled
} from '../../services/notifications/notificationCapabilities';
import {
  getNotificationCategory,
  isCategoryMuted,
  normalizeNotificationPreferences,
  shouldFeatureNotification
} from '../../services/notifications/notificationPreferencesService';
import NotificationCenterHeader from './NotificationCenterHeader';
import NotificationList from './NotificationList';
import BusinessTimezoneReminder from './BusinessTimezoneReminder';
import NotificationPreferencesPanel from './NotificationPreferencesPanel';
import NotificationTabs from './NotificationTabs';
import SupportTicketForm from './support/SupportTicketForm';
import SupportTicketList from './support/SupportTicketList';
import SupportTicketThread from './support/SupportTicketThread';
import CashSessionAgeAttention from './CashSessionAgeAttention';

const isUnreadNotification = (notification) => (
  notification?.is_read !== true && notification?.is_archived !== true
);

const getNotificationGroup = (notification) => getNotificationCategory(notification);
const syncEntityName = (type) => ({
  product: 'Productos', customer: 'Clientes', category: 'Categorías',
  product_batch: 'Lotes', customer_credit: 'Crédito de clientes'
}[type] || type);
const syncDiagnosisError = (error) => (
  isNotificationAccessDenied(error) || String(error?.message || '').includes('SYNC_DIAG_ACCESS_DENIED')
    ? 'denied' : 'error'
);
const NOTIFICATION_CATEGORY_TABS = ['ecommerce', 'inventory', 'operations', 'license', 'system'];
const REQUESTABLE_NOTIFICATION_TABS = new Set([
  'all',
  'unread',
  'support',
  ...NOTIFICATION_CATEGORY_TABS
]);

const getNotificationPriorityRank = (notification, preferences) => {
  const unread = isUnreadNotification(notification);
  const severity = notification?.severity || notification?.tone || 'info';
  const category = getNotificationCategory(notification);
  const muted = isCategoryMuted(category, preferences);
  const featured = shouldFeatureNotification(notification, preferences);

  if (unread && severity === 'critical') return 0;
  if (unread && severity === 'warning' && featured && !muted) return 1;
  if (unread && category === 'support') return 2;
  if (unread && featured && !muted) return 3;
  if (unread) return 4;
  return featured && !muted ? 5 : 6;
};

export default function NotificationCenterDrawer({
  isOpen,
  onClose,
  unreadCount = 0,
  showBusinessTimezoneReminder = false,
  cashSessionAgeAttention = null,
  onReviewCashSessions
}) {
  const actorAccess = useActorAccess();
  const drawerRef = useRef(null);
  const accessDenied = useAppStore((state) => state.notificationsAccessDenied);
  const [activeTab, setActiveTab] = useState('all');
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [syncDiagnosticsStatus, setSyncDiagnosticsStatus] = useState('idle');
  const [syncDiagnosticsOpen, setSyncDiagnosticsOpen] = useState(false);
  const [syncDiagnosticsKey, setSyncDiagnosticsKey] = useState(null);
  const [syncDiagnosis, setSyncDiagnosis] = useState({ status: 'idle', summary: null });
  const syncDiagnosticsProbeRequest = useRef(0);
  const activeSyncDiagnosticsProbe = useRef(null);
  const syncDiagnosisRequest = useRef(0);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const notifications = useAppStore((state) => state.notifications);
  const notificationsLoading = useAppStore((state) => state.notificationsLoading);
  const isRefreshingNotifications = useAppStore((state) => state.isRefreshingNotifications);
  const notificationsError = useAppStore((state) => state.notificationsError);
  const loadNotifications = useAppStore((state) => state.loadNotifications);
  const markNotificationsSeen = useAppStore((state) => state.markNotificationsSeen);
  const markAllNotificationsRead = useAppStore((state) => state.markAllNotificationsRead);
  const markNotificationRead = useAppStore((state) => state.markNotificationRead);
  const archiveNotification = useAppStore((state) => state.archiveNotification);
  const supportTickets = useAppStore((state) => state.supportTickets);
  const supportTicketsLoading = useAppStore((state) => state.supportTicketsLoading);
  const isRefreshingSupport = useAppStore((state) => state.isRefreshingSupport);
  const supportTicketsError = useAppStore((state) => state.supportTicketsError);
  const activeSupportTicket = useAppStore((state) => state.activeSupportTicket);
  const supportTicketMessages = useAppStore((state) => state.supportTicketMessages);
  const supportTicketThreadLoading = useAppStore((state) => state.supportTicketThreadLoading);
  const supportTicketThreadError = useAppStore((state) => state.supportTicketThreadError);
  const supportTicketSubmitting = useAppStore((state) => state.supportTicketSubmitting);
  const supportTicketView = useAppStore((state) => state.supportTicketView);
  const loadSupportTickets = useAppStore((state) => state.loadSupportTickets);
  const openSupportTicket = useAppStore((state) => state.openSupportTicket);
  const createTicket = useAppStore((state) => state.createTicket);
  const replyTicket = useAppStore((state) => state.replyTicket);
  const closeTicket = useAppStore((state) => state.closeTicket);
  const showSupportTicketForm = useAppStore((state) => state.showSupportTicketForm);
  const showSupportTicketList = useAppStore((state) => state.showSupportTicketList);
  const requestedTab = useAppStore((state) => state.notificationCenterRequestedTab);
  const requestedTicketId = useAppStore((state) => state.notificationCenterRequestedTicketId);
  const clearNotificationCenterRequest = useAppStore((state) => state.clearNotificationCenterRequest);
  const notificationPreferences = useAppStore((state) => state.notificationPreferences);
  const loadNotificationPreferences = useAppStore((state) => state.loadNotificationPreferences);
  const updateNotificationPreferences = useAppStore((state) => state.updateNotificationPreferences);
  const resetNotificationPreferences = useAppStore((state) => state.resetNotificationPreferences);
  const muteNotificationCategory = useAppStore((state) => state.muteNotificationCategory);
  const unmuteNotificationCategory = useAppStore((state) => state.unmuteNotificationCategory);

  const authorizationKey = useAppStore((state) => state.notificationAuthorizationKey);
  const runtimeCurrent = authorizationKey === getNotificationAuthorizationKey({ licenseDetails }, actorAccess);
  const staffSession = actorAccess.permissionSession;
  const supportAccessEnabled = canStaffAccessSupportCenter(licenseDetails, staffSession);
  const cloudNotificationsEnabled = (
    canAccessCloudNotificationCenter(licenseDetails, actorAccess) && runtimeCurrent && !accessDenied
  );
  const supportCenterEnabled = (
    isSupportCenterEnabled(licenseDetails) &&
    supportAccessEnabled
  );
  const inventoryAccessEnabled = canStaffAccessNotificationCategory(
    licenseDetails,
    staffSession,
    'inventory'
  );
  const notificationCategoryAccess = useMemo(
    () => Object.fromEntries(NOTIFICATION_CATEGORY_TABS.map((category) => [
      category,
      canStaffAccessNotificationCategory(licenseDetails, staffSession, category)
    ])),
    [licenseDetails, staffSession]
  );
  const normalizedPreferences = useMemo(
    () => normalizeNotificationPreferences(notificationPreferences),
    [notificationPreferences]
  );

  const visibleNotifications = useMemo(
    () => notifications.filter((notification) => canStaffAccessNotificationCategory(
      licenseDetails,
      staffSession,
      getNotificationCategory(notification)
    )),
    [licenseDetails, notifications, staffSession]
  );

  const hasSyncConflictAlert = visibleNotifications.some(isPendingSyncConflictNotification);
  const isCurrentDiagnosticsContext = useCallback(() => {
    const state = useAppStore.getState();
    return Boolean(authorizationKey &&
      state.notificationAuthorizationKey === authorizationKey &&
      getNotificationAuthorizationKey(state, readActorAccess(state)) === authorizationKey);
  }, [authorizationKey]);
  const syncDiagnosticsAvailable = syncDiagnosticsStatus === 'available';
  const syncContextChanged = syncDiagnosticsOpen && (
    syncDiagnosticsKey !== authorizationKey || !runtimeCurrent || !isCurrentDiagnosticsContext()
  );

  const probeSyncDiagnostics = useCallback(async () => {
    if (
      !isOpen || !cloudNotificationsEnabled || !actorAccess.isAdmin
      || !hasSyncConflictAlert || !isCurrentDiagnosticsContext()
    ) return;

    const activeProbe = activeSyncDiagnosticsProbe.current;
    if (activeProbe?.authorizationKey === authorizationKey) return activeProbe.promise;

    const request = ++syncDiagnosticsProbeRequest.current;
    setSyncDiagnosticsStatus('checking');
    const isCurrentProbe = () => (
      request === syncDiagnosticsProbeRequest.current
      && isOpen
      && cloudNotificationsEnabled
      && actorAccess.isAdmin
      && hasSyncConflictAlert
      && isCurrentDiagnosticsContext()
    );
    const promise = (async () => {
      try {
        // A successful read is the capability probe: an absent RPC remains unavailable.
        const result = await fetchCloudSyncConflictDiagnostics(licenseDetails);
        if (!isCurrentProbe()) return;
        setSyncDiagnosticsStatus(result.available ? 'available' : 'unavailable');
      } catch (error) {
        if (!isCurrentProbe()) return;
        setSyncDiagnosticsStatus(syncDiagnosisError(error));
      } finally {
        if (activeSyncDiagnosticsProbe.current?.request === request) {
          activeSyncDiagnosticsProbe.current = null;
        }
      }
    })();
    activeSyncDiagnosticsProbe.current = { request, authorizationKey, promise };
    return promise;
  }, [
    actorAccess.isAdmin,
    authorizationKey,
    cloudNotificationsEnabled,
    hasSyncConflictAlert,
    isCurrentDiagnosticsContext,
    isOpen,
    licenseDetails
  ]);

  useEffect(() => {
    let cancelled = false;
    setSyncDiagnosticsStatus('idle');
    if (isOpen) {
      // Deferring one microtask lets StrictMode's mount replay cancel its first setup.
      void Promise.resolve().then(() => {
        if (!cancelled) void probeSyncDiagnostics();
      });
    }
    return () => {
      cancelled = true;
      syncDiagnosticsProbeRequest.current += 1;
      activeSyncDiagnosticsProbe.current = null;
    };
  }, [isOpen, probeSyncDiagnostics]);

  useEffect(() => {
    syncDiagnosisRequest.current += 1;
    if (!isOpen) {
      setSyncDiagnosticsOpen(false);
      setSyncDiagnosis({ status: 'idle', summary: null });
      setSyncDiagnosticsKey(null);
    }
  }, [isOpen, authorizationKey]);

  const refreshSyncDiagnostics = async () => {
    if (!isCurrentDiagnosticsContext()) {
      setSyncDiagnosis({ status: 'changed', summary: null });
      return;
    }
    const request = ++syncDiagnosisRequest.current;
    setSyncDiagnosis({ status: 'loading', summary: null });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSyncDiagnosis({ status: 'offline', summary: null });
      return;
    }
    try {
      const result = await fetchCloudSyncConflictDiagnostics(licenseDetails);
      if (request !== syncDiagnosisRequest.current) return;
      if (!isCurrentDiagnosticsContext()) {
        setSyncDiagnosis({ status: 'changed', summary: null });
        return;
      }
      if (!result.available) {
        setSyncDiagnosticsStatus('unavailable');
        setSyncDiagnosis({ status: 'unavailable', summary: null });
        return;
      }
      setSyncDiagnosis({
        status: result.summary.pendingCount === 0 ? 'empty' : 'ready',
        summary: result.summary
      });
    } catch (error) {
      if (request !== syncDiagnosisRequest.current) return;
      const diagnosisStatus = !isCurrentDiagnosticsContext() ? 'changed'
        : (typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : syncDiagnosisError(error));
      if (diagnosisStatus === 'denied') setSyncDiagnosticsStatus('denied');
      setSyncDiagnosis({ status: diagnosisStatus, summary: null });
    }
  };

  const handleShowSyncDiagnostics = () => {
    if (syncDiagnosticsStatus !== 'available' || !actorAccess.isAdmin || !isCurrentDiagnosticsContext()) return;
    setSyncDiagnosticsKey(authorizationKey);
    setSyncDiagnosticsOpen(true);
    void refreshSyncDiagnostics();
  };

  const notificationCounts = useMemo(() => {
    const counts = {
      all: visibleNotifications.length,
      unread: 0,
      support: 0,
      ecommerce: 0,
      inventory: 0,
      operations: 0,
      license: 0,
      system: 0
    };

    visibleNotifications.forEach((notification) => {
      if (isUnreadNotification(notification)) counts.unread += 1;
      const group = getNotificationGroup(notification);
      counts[group] = Number(counts[group] || 0) + 1;
    });

    return counts;
  }, [visibleNotifications]);

  const filteredNotifications = useMemo(() => {
    const indexedNotifications = visibleNotifications.map((notification, index) => ({
      notification,
      index
    }));

    const filtered = indexedNotifications.filter(({ notification }) => {
      if (activeTab === 'all' || activeTab === 'support') return true;
      if (activeTab === 'unread') return isUnreadNotification(notification);
      return getNotificationGroup(notification) === activeTab;
    });

    return filtered
      .sort((left, right) => {
        const rankDelta = (
          getNotificationPriorityRank(left.notification, normalizedPreferences) -
          getNotificationPriorityRank(right.notification, normalizedPreferences)
        );
        if (rankDelta !== 0) return rankDelta;
        return left.index - right.index;
      })
      .map(({ notification }) => notification);
  }, [activeTab, normalizedPreferences, visibleNotifications]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousFocus = document.activeElement;
    const focusTimer = setTimeout(() => drawerRef.current?.querySelector('.notification-center-close')?.focus(), 0);
    const handleKeyDown = (event) => {
      if (event.key === 'Tab') {
        const elements = [...(drawerRef.current?.querySelectorAll(
          'button:not(:disabled):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), input:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled):not([tabindex="-1"]), select:not(:disabled):not([tabindex="-1"]), [tabindex="0"]'
        ) || [])];
        const first = elements[0];
        const last = elements.at(-1);
        if (first && ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first) || !drawerRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.body.classList.add('notification-center-open');
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer);
      if (previousFocus?.isConnected) previousFocus.focus?.();
      document.body.classList.remove('notification-center-open');
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !cloudNotificationsEnabled) return undefined;

    let cancelled = false;
    loadNotificationPreferences?.();

    const loadAndMarkSeen = async () => {
      const result = await loadNotifications?.();
      if (!cancelled && result?.success !== false) {
        await markNotificationsSeen?.();
      }
    };

    void loadAndMarkSeen();

    return () => {
      cancelled = true;
    };
  }, [
    cloudNotificationsEnabled,
    isOpen,
    loadNotificationPreferences,
    loadNotifications,
    markNotificationsSeen
  ]);

  useEffect(() => {
    if (!isOpen || !cloudNotificationsEnabled || activeTab !== 'support' || !supportCenterEnabled) return;
    loadSupportTickets?.();
  }, [activeTab, cloudNotificationsEnabled, isOpen, loadSupportTickets, supportCenterEnabled]);

  useEffect(() => {
    if (!isOpen || !requestedTab) return;

    if (!cloudNotificationsEnabled) {
      clearNotificationCenterRequest?.();
      return;
    }

    let nextTab = 'all';
    if (REQUESTABLE_NOTIFICATION_TABS.has(requestedTab)) {
      if (requestedTab === 'support') {
        nextTab = supportCenterEnabled ? 'support' : 'all';
      } else if (requestedTab === 'all' || requestedTab === 'unread') {
        nextTab = requestedTab;
      } else if (canStaffAccessNotificationCategory(
        licenseDetails,
        staffSession,
        requestedTab
      )) {
        nextTab = requestedTab;
      }
    }

    setActiveTab(nextTab);

    if (nextTab === 'support' && supportCenterEnabled) {
      if (requestedTicketId) {
        openSupportTicket?.(requestedTicketId, { force: true });
      } else {
        loadSupportTickets?.();
      }
    }

    clearNotificationCenterRequest?.();
  }, [
    clearNotificationCenterRequest,
    isOpen,
    licenseDetails,
    loadSupportTickets,
    openSupportTicket,
    requestedTab,
    requestedTicketId,
    staffSession,
    supportCenterEnabled,
    cloudNotificationsEnabled
  ]);

  useEffect(() => {
    if (!isOpen) return;

    if (activeTab === 'support' && !supportCenterEnabled) {
      setActiveTab('all');
      return;
    }

    if (
      NOTIFICATION_CATEGORY_TABS.includes(activeTab)
      && !canStaffAccessNotificationCategory(licenseDetails, staffSession, activeTab)
    ) {
      setActiveTab('all');
    }
  }, [
    activeTab,
    isOpen,
    licenseDetails,
    staffSession,
    supportCenterEnabled
  ]);

  const handleMarkAllRead = async () => {
    setIsMarkingAllRead(true);
    try {
      await markAllNotificationsRead?.();
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const handleRefresh = async () => {
    setIsManualRefreshing(true);
    if (hasSyncConflictAlert && syncDiagnosticsStatus === 'error') {
      // Retry only after an explicit refresh and deduplicate an in-flight probe.
      void probeSyncDiagnostics();
    }

    try {
      if (activeTab === 'support' && supportCenterEnabled) {
        if (supportTicketView === 'thread' && activeSupportTicket?.id) {
          await openSupportTicket?.(activeSupportTicket.id, { force: true });
          await loadSupportTickets?.({ force: true, background: true });
        } else {
          await loadSupportTickets?.({ force: true });
        }

        await loadNotifications?.({
          force: true,
          refreshOperational: false,
          background: true
        });
        return;
      }

      await loadNotifications?.({ force: true });
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const handleNotificationsRetry = () => {
    loadNotifications?.({ force: true });
  };

  const handleSupportRetry = () => {
    loadSupportTickets?.({ force: true });
  };

  const handleOpenSupportTicket = (ticketId, options) => {
    openSupportTicket?.(ticketId, options);
  };

  const handleNotificationRead = async (notificationId, { openSupport = false } = {}) => {
    const notification = visibleNotifications.find((item) => item.id === notificationId);
    const result = await markNotificationRead?.(notificationId);
    const currentState = useAppStore.getState();
    const currentAuthorizationKey = getNotificationAuthorizationKey(currentState);

    if (
      result?.success !== true
      || !currentAuthorizationKey
      || currentAuthorizationKey !== authorizationKey
      || currentState.notificationAuthorizationKey !== authorizationKey
    ) {
      return result?.success === true
        ? { success: false, code: 'STALE_NOTIFICATION_CONTEXT' }
        : result;
    }

    if (openSupport && (
      notification?.metadata?.ticket_id ||
      notification?.action_route === 'notifications:support'
    )) {
      if (!supportCenterEnabled) {
        return { success: false, code: 'STAFF_SUPPORT_DISABLED', message: 'Tu usuario staff no tiene acceso a soporte Lanzo.' };
      }

      setActiveTab('support');
      if (notification.metadata?.ticket_id) {
        openSupportTicket?.(notification.metadata.ticket_id, { force: true });
      } else {
        loadSupportTickets?.();
      }
    }

    return result;
  };

  const renderSyncDiagnostics = () => {
    const status = syncContextChanged ? 'changed' : syncDiagnosis.status;
    const summary = status === 'ready' || status === 'empty' ? syncDiagnosis.summary : null;
    return (
      <section
        className="notification-sync-diagnostics"
        aria-label="Diagnóstico de sincronización"
        data-status={status}
      >
        <div className="notification-sync-diagnostics__actions">
          <button type="button" onClick={() => setSyncDiagnosticsOpen(false)}>Volver a notificaciones</button>
          <button type="button" onClick={() => void refreshSyncDiagnostics()} disabled={status === 'loading' || status === 'changed'}>
            Actualizar diagnóstico
          </button>
        </div>
        <p className="notification-sync-diagnostics__eyebrow">Diagnóstico Cloud</p>
        <h3>Conflictos de sincronización Cloud</h3>
        {status === 'loading' && <p role="status">Consultando conflictos pendientes...</p>}
        {status === 'changed' && <p role="alert">Cambió el negocio o la sesión. Vuelve a abrir el diagnóstico desde la notificación.</p>}
        {status === 'offline' && <p role="alert">Sin conexión. Comprueba internet e intenta de nuevo.</p>}
        {status === 'denied' && <p role="alert">Acceso denegado. Se requiere una sesión activa del administrador.</p>}
        {status === 'error' && <p role="alert">No fue posible consultar Cloud. Intenta de nuevo.</p>}
        {status === 'unavailable' && <p role="status">El diagnóstico todavía no está instalado en Cloud.</p>}
        {status === 'empty' && <p role="status">No hay conflictos pendientes registrados en Cloud.</p>}
        {summary && (
          <>
            {status === 'ready' && (
              <>
                <p className="notification-sync-diagnostics__total">Conflictos pendientes: {summary.pendingCount}</p>
                <div className="notification-sync-diagnostics__breakdown">
                  <section className="notification-sync-diagnostics__group" aria-label="Conflictos por entidad">
                    <h4>Por entidad</h4>
                    <ul>
                      {summary.entities.map(({ type, count }) => (
                        <li key={type}><span>{syncEntityName(type)}</span><strong>{count}</strong></li>
                      ))}
                    </ul>
                  </section>
                  <section className="notification-sync-diagnostics__group" aria-label="Clasificación de los conflictos">
                    <h4>Clasificación de los conflictos</h4>
                    <ul>
                      {summary.conflictTypes.map(({ type, count }) => (
                        <li key={type}>
                          <span>{type === 'VERSION_CONFLICT' ? 'Versión distinta entre dispositivo y Cloud' : type}</span>
                          <strong>{count}</strong>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
                <p>Algunos cambios registrados en Cloud no pudieron conciliarse automáticamente.</p>
              </>
            )}
            {summary.checkedAt && <p className="notification-sync-diagnostics__date">Consulta Cloud: {new Date(summary.checkedAt).toLocaleString('es-MX')}</p>}
            <p>Conserva tus datos y evita repetir operaciones para corregir el conflicto manualmente. Si persiste, solicita asistencia.</p>
          </>
        )}
        {supportCenterEnabled && (
          <button type="button" className="notification-sync-diagnostics__support" onClick={() => {
            setSyncDiagnosticsOpen(false);
            setActiveTab('support');
          }}>Ir a soporte</button>
        )}
      </section>
    );
  };

  const renderSupportContent = () => {
    if (!supportCenterEnabled) return null;

    if (supportTicketView === 'form') {
      return (
        <SupportTicketForm
          submitting={supportTicketSubmitting}
          error={supportTicketsError}
          onCancel={showSupportTicketList}
          onSubmit={createTicket}
        />
      );
    }

    if (supportTicketView === 'thread') {
      return (
        <SupportTicketThread
          ticket={activeSupportTicket}
          messages={supportTicketMessages}
          loading={supportTicketThreadLoading}
          error={supportTicketThreadError}
          submitting={supportTicketSubmitting}
          onBack={showSupportTicketList}
          onRetry={(ticketId) => openSupportTicket?.(ticketId, { force: true })}
          onReply={replyTicket}
          onCloseTicket={closeTicket}
        />
      );
    }

    return (
      <SupportTicketList
        tickets={supportTickets}
        loading={supportTicketsLoading}
        error={supportTicketsError}
        onRetry={handleSupportRetry}
        onNewTicket={showSupportTicketForm}
        onOpenTicket={handleOpenSupportTicket}
      />
    );
  };

  if (!isOpen) return null;

  if (!cloudNotificationsEnabled) {
    return (
      <>
        <button
          type="button"
          className="notification-center-backdrop"
          onClick={onClose}
          aria-label="Cerrar centro de notificaciones"
        />

        <aside
          ref={drawerRef}
          id="notification-center-drawer"
          className="notification-center-drawer notification-center-drawer--cloud"
          role="dialog"
          aria-modal="true"
          aria-labelledby="notification-center-title"
        >
          <NotificationCenterHeader onClose={onClose} />
          <div className="notification-list-state notification-list-state--restricted" role="status">
            <p>{NOTIFICATION_ACCESS_MESSAGE}</p>
            <button type="button" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </aside>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="notification-center-backdrop"
        onClick={onClose}
        aria-label="Cerrar centro de notificaciones"
      />

      <aside
        ref={drawerRef}
        id="notification-center-drawer"
        className={[
          'notification-center-drawer',
          'notification-center-drawer--cloud',
          normalizedPreferences.compactMode ? 'is-compact-mode' : ''
        ].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-center-title"
      >
        <NotificationCenterHeader
          onClose={onClose}
          onRefresh={handleRefresh}
          onTogglePreferences={() => setShowPreferences((value) => !value)}
          refreshDisabled={
            notificationsLoading ||
            supportTicketsLoading ||
            isRefreshingNotifications ||
            isRefreshingSupport ||
            isManualRefreshing
          }
          refreshing={isManualRefreshing || isRefreshingNotifications || isRefreshingSupport}
          showPreferences={showPreferences}
        />

        {unreadCount > 0 && (
          <div className="notification-center-actions notification-center-actions--mark-read">
            <button
              type="button"
              className="notification-center-action"
              onClick={handleMarkAllRead}
              disabled={notificationsLoading || isMarkingAllRead}
            >
              {isMarkingAllRead ? 'Marcando...' : 'Marcar todo como leído'}
            </button>
          </div>
        )}

        <NotificationTabs
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab);
            setSyncDiagnosticsOpen(false);
          }}
          showSupport={supportCenterEnabled}
          showInventory={inventoryAccessEnabled}
          categoryAccess={notificationCategoryAccess}
          counts={notificationCounts}
        />

        <div className="notification-center-body">
          {showPreferences && (
            <NotificationPreferencesPanel
              preferences={normalizedPreferences}
              onUpdate={updateNotificationPreferences}
              onMuteCategory={muteNotificationCategory}
              onUnmuteCategory={unmuteNotificationCategory}
              onReset={resetNotificationPreferences}
            />
          )}
          {!syncDiagnosticsOpen && (
            <CashSessionAgeAttention
              attention={cashSessionAgeAttention}
              onReview={onReviewCashSessions}
            />
          )}
          {showBusinessTimezoneReminder
            && !syncDiagnosticsOpen
            && (activeTab === 'all' || activeTab === 'system') && (
              <BusinessTimezoneReminder onClose={onClose} />
          )}
          {syncDiagnosticsOpen ? renderSyncDiagnostics() : activeTab === 'support' && supportCenterEnabled ? (
            renderSupportContent()
          ) : (
            <NotificationList
              notifications={filteredNotifications}
              activeTab={activeTab}
              loading={notificationsLoading}
              error={notificationsError}
              onRetry={handleNotificationsRetry}
              onNotificationRead={handleNotificationRead}
              onNotificationArchive={archiveNotification}
              onShowSyncDiagnostics={handleShowSyncDiagnostics}
              syncDiagnosticsAvailable={syncDiagnosticsAvailable && actorAccess.isAdmin}
              preferences={normalizedPreferences}
            />
          )}
        </div>
      </aside>
    </>
  );
}
