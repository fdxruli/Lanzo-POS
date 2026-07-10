import {
  Archive,
  BellDot,
  CircleDollarSign,
  CloudCog,
  Headphones,
  KeyRound,
  MonitorCog
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  getNotificationCategory,
  isCategoryMuted,
  shouldFeatureNotification
} from '../../services/notifications/notificationPreferencesService';

const formatNotificationDate = (value) => {
  if (!value) return '';

  try {
    return new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const TYPE_ICONS = {
  cash: CircleDollarSign,
  license: KeyRound,
  support: Headphones,
  sync: CloudCog,
  system: MonitorCog
};

const TYPE_LABELS = {
  cash: 'Caja',
  license: 'Licencia',
  support: 'Soporte',
  sync: 'Sincronización',
  system: 'Sistema'
};

const SEVERITY_LABELS = {
  critical: 'Crítica',
  warning: 'Advertencia',
  info: 'Info',
  success: 'Correcto'
};

export default function NotificationItem({
  notification,
  onRead,
  onArchive,
  preferences
}) {
  const navigate = useNavigate();
  const {
    id,
    title = 'Notificación',
    body = '',
    description = '',
    created_at: createdAtRaw = '',
    createdAt = '',
    severity = 'info',
    tone = 'info',
    type = 'system',
    is_read: isRead = false,
    is_dismissible: isDismissible = true
  } = notification || {};
  const itemTone = severity || tone || 'info';
  const Icon = TYPE_ICONS[type] || BellDot;
  const typeLabel = TYPE_LABELS[type] || 'Sistema';
  const severityLabel = SEVERITY_LABELS[itemTone] || SEVERITY_LABELS.info;
  const category = getNotificationCategory(notification);
  const isMuted = itemTone !== 'critical' && isCategoryMuted(category, preferences);
  const isFeatured = shouldFeatureNotification(notification, preferences);
  const displayBody = body || description;
  const displayDate = formatNotificationDate(createdAtRaw || createdAt);
  const actionRoute = notification?.action_route || notification?.actionRoute || '';
  const actionLabel = notification?.action_label || notification?.actionLabel || (!isRead ? 'Marcar como leída' : '');

  const handleRead = () => {
    if (id) {
      onRead?.(id);
    }

    if (typeof actionRoute === 'string' && actionRoute.startsWith('/')) {
      navigate(actionRoute);
    }
  };

  const handleArchive = (event) => {
    event.stopPropagation();
    if (id) {
      onArchive?.(id);
    }
  };

  const handleAction = (event) => {
    event.stopPropagation();
    handleRead();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleRead();
    }
  };

  return (
    <article
      className={[
        'notification-item',
        `notification-item--${itemTone}`,
        `notification-item--type-${type}`,
        isRead ? 'is-read' : 'is-unread',
        isMuted ? 'is-muted-category' : '',
        !isFeatured ? 'is-not-featured' : ''
      ].filter(Boolean).join(' ')}
      role="listitem"
      onClick={handleRead}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <span className="notification-item__icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="notification-item__copy">
        <div className="notification-item__badges" aria-label="Tipo y prioridad">
          <span className={`notification-item__badge notification-item__badge--type-${type}`}>
            {typeLabel}
          </span>
          <span className={`notification-item__badge notification-item__badge--severity-${itemTone}`}>
            {severityLabel}
          </span>
          {isMuted && (
            <span className="notification-item__badge notification-item__badge--muted">
              Silenciado
            </span>
          )}
        </div>
        <h3>{title}</h3>
        {displayBody && <p>{displayBody}</p>}
        <div className="notification-item__footer">
          {displayDate && <time dateTime={createdAtRaw || createdAt}>{displayDate}</time>}
          {actionLabel && (
            <button
              type="button"
              className="notification-item__action"
              onClick={handleAction}
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>
      {isDismissible && (
        <button
          type="button"
          className="notification-item__archive"
          onClick={handleArchive}
          aria-label={`Archivar notificación ${title}`}
        >
          <Archive size={16} aria-hidden="true" />
        </button>
      )}
    </article>
  );
}
