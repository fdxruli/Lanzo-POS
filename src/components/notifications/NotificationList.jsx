import NotificationEmptyState from './NotificationEmptyState';
import NotificationItem from './NotificationItem';

export default function NotificationList({
  notifications = [],
  activeTab = 'all',
  loading = false,
  error = null,
  onRetry,
  onNotificationRead,
  onNotificationArchive,
  preferences
}) {
  if (loading) {
    return (
      <div className="notification-list-state" role="status" aria-live="polite">
        Cargando notificaciones...
      </div>
    );
  }

  if (error) {
    return (
      <div className="notification-list-state notification-list-state--error" role="alert">
        <p>{error}</p>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            Reintentar
          </button>
        )}
      </div>
    );
  }

  if (notifications.length === 0) {
    return <NotificationEmptyState activeTab={activeTab} />;
  }

  return (
    <div className="notification-list" role="list" aria-label="Notificaciones">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onRead={onNotificationRead}
          onArchive={onNotificationArchive}
          preferences={preferences}
        />
      ))}
    </div>
  );
}
