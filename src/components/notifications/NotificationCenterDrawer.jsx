import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  canStaffAccessNotifications,
  canStaffAccessSupportCenter,
  isCloudNotificationsEnabled,
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
import NotificationPreferencesPanel from './NotificationPreferencesPanel';
import NotificationTabs from './NotificationTabs';
import SupportTicketForm from './support/SupportTicketForm';
import SupportTicketList from './support/SupportTicketList';
import SupportTicketThread from './support/SupportTicketThread';

const isUnreadNotification = (notification) => (
  notification?.is_read !== true && notification?.is_archived !== true
);

const getNotificationGroup = (notification) => {
  const type = getNotificationCategory(notification);

  if (type === 'cash' || type === 'sync') return 'operation';
  if (type === 'support') return 'support';
  if (type === 'license') return 'license';
  return 'system';
};

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
  unreadCount = 0
}) {
  const [activeTab, setActiveTab] = useState('all');
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const notifications = useAppStore((state) => state.notifications);
  const notificationsLoading = useAppStore((state) => state.notificationsLoading);
  const isRefreshingNotifications = useAppStore((state) => state.isRefreshingNotifications);
  const notificationsError = useAppStore((state) => state.notificationsError);
  const loadNotifications = useAppStore((state) => state.loadNotifications);
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

  const staffSession = { currentDeviceRole, currentStaffUser };
  const notificationsAccessEnabled = canStaffAccessNotifications(licenseDetails, staffSession);
  const supportAccessEnabled = canStaffAccessSupportCenter(licenseDetails, staffSession);
  const cloudNotificationsEnabled = (
    isCloudNotificationsEnabled(licenseDetails) &&
    notificationsAccessEnabled
  );
  const supportCenterEnabled = (
    isSupportCenterEnabled(licenseDetails) &&
    supportAccessEnabled
  );
  const normalizedPreferences = useMemo(
    () => normalizeNotificationPreferences(notificationPreferences),
    [notificationPreferences]
  );

  const notificationCounts = useMemo(() => {
    const counts = {
      all: notifications.length,
      unread: 0,
      support: 0,
      operation: 0,
      license: 0,
      system: 0
    };

    notifications.forEach((notification) => {
      if (isUnreadNotification(notification)) counts.unread += 1;
      const group = getNotificationGroup(notification);
      counts[group] = Number(counts[group] || 0) + 1;
    });

    return counts;
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    const indexedNotifications = notifications.map((notification, index) => ({
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
  }, [activeTab, normalizedPreferences, notifications]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.body.classList.add('notification-center-open');
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.classList.remove('notification-center-open');
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !cloudNotificationsEnabled) return;
    loadNotificationPreferences?.();
    loadNotifications?.();
  }, [cloudNotificationsEnabled, isOpen, loadNotificationPreferences, loadNotifications]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'support' || !supportCenterEnabled) return;
    loadSupportTickets?.();
  }, [activeTab, isOpen, loadSupportTickets, supportCenterEnabled]);

  useEffect(() => {
    if (!isOpen || !requestedTab) return;

    if (!cloudNotificationsEnabled) {
      clearNotificationCenterRequest?.();
      return;
    }

    setActiveTab(requestedTab);

    if (requestedTab === 'support' && supportCenterEnabled) {
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
    loadSupportTickets,
    openSupportTicket,
    requestedTab,
    requestedTicketId,
    supportCenterEnabled,
    cloudNotificationsEnabled
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

  const handleNotificationRead = async (notificationId) => {
    const notification = notifications.find((item) => item.id === notificationId);
    const result = await markNotificationRead?.(notificationId);

    if (
      notification?.metadata?.ticket_id ||
      notification?.action_route === 'notifications:support'
    ) {
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
          id="notification-center-drawer"
          className="notification-center-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="notification-center-title"
        >
          <NotificationCenterHeader onClose={onClose} />
          <div className="notification-list-state notification-list-state--error" role="alert">
            <p>Tu usuario staff no tiene acceso al Centro de Notificaciones.</p>
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
        id="notification-center-drawer"
        className={[
          'notification-center-drawer',
          normalizedPreferences.compactMode ? 'is-compact-mode' : ''
        ].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-center-title"
      >
        <NotificationCenterHeader
          onClose={onClose}
        />

        <div className="notification-center-actions">
          <button
            type="button"
            className="notification-center-action notification-center-action--refresh"
            onClick={handleRefresh}
            disabled={
              notificationsLoading ||
              supportTicketsLoading ||
              isRefreshingNotifications ||
              isRefreshingSupport ||
              isManualRefreshing
            }
          >
            <RefreshCw size={14} aria-hidden="true" />
            {isManualRefreshing || isRefreshingNotifications || isRefreshingSupport
              ? 'Actualizando...'
              : 'Actualizar'}
          </button>
          <button
            type="button"
            className={`notification-center-action ${showPreferences ? 'is-active' : ''}`}
            onClick={() => setShowPreferences((value) => !value)}
            aria-expanded={showPreferences}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            Preferencias
          </button>
        </div>

        {unreadCount > 0 && (
          <div className="notification-center-actions">
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

        {showPreferences && (
          <NotificationPreferencesPanel
            preferences={normalizedPreferences}
            onUpdate={updateNotificationPreferences}
            onMuteCategory={muteNotificationCategory}
            onUnmuteCategory={unmuteNotificationCategory}
            onReset={resetNotificationPreferences}
          />
        )}

        <NotificationTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          showSupport={supportCenterEnabled}
          counts={notificationCounts}
        />

        <div className="notification-center-body">
          {activeTab === 'support' && supportCenterEnabled ? (
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
              preferences={normalizedPreferences}
            />
          )}
        </div>
      </aside>
    </>
  );
}
