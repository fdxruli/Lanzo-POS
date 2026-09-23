import {
  Archive,
  BellDot,
  CircleDollarSign,
  Headphones,
  KeyRound,
  MonitorCog,
  Package,
  ShoppingBag
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { canReadSalesReports } from '../../services/auth/salesPermissionPolicy';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import { getCloudInventoryNotificationNavigationRoute } from '../../services/notifications/inventoryNotificationNavigation';
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

const CATEGORY_ICONS = {
  operations: CircleDollarSign,
  license: KeyRound,
  support: Headphones,
  ecommerce: ShoppingBag,
  system: MonitorCog
};

const CATEGORY_LABELS = {
  operations: 'Operaciones',
  license: 'Licencia',
  support: 'Soporte',
  ecommerce: 'Pedidos online',
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
  const closeNotificationCenter = useAppStore((state) => state.closeNotificationCenter);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const canAccess = useAppStore((state) => state.canAccess);
  const actorRuntime = useActorRuntimeSnapshot();
  const canReadReports = canReadSalesReports(actorRuntime);
  const canReadProducts = (
    currentDeviceRole === 'staff'
    && Boolean(currentStaffUser?.id)
    && typeof canAccess === 'function'
    && (canAccess('products') || canAccess('inventory'))
  );
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
  const category = getNotificationCategory(notification);
  const Icon = type === 'inventory'
    ? Package
    : (CATEGORY_ICONS[category] || BellDot);
  const typeLabel = CATEGORY_LABELS[category] || 'Sistema';
  const severityLabel = SEVERITY_LABELS[itemTone] || SEVERITY_LABELS.info;
  const isMuted = itemTone !== 'critical' && isCategoryMuted(category, preferences);
  const isFeatured = shouldFeatureNotification(notification, preferences);
  const displayBody = body || description;
  const displayDate = formatNotificationDate(createdAtRaw || createdAt);
  const rawActionRoute = notification?.action_route || notification?.actionRoute || '';
  const actionRoute = type === 'inventory'
    ? getCloudInventoryNotificationNavigationRoute(notification, {
        canReadReports,
        canReadProducts
      })
    : rawActionRoute;
  const actionLabel = type === 'inventory'
    ? (actionRoute
        ? (notification?.action_label || notification?.actionLabel || 'Revisar')
        : (!isRead ? 'Marcar como leída' : ''))
    : (notification?.action_label || notification?.actionLabel || (!isRead ? 'Marcar como leída' : ''));

  const handleRead = async () => {
    const result = id ? await onRead?.(id) : { success: true };
    if (result?.success === false) return;

    if (typeof actionRoute === 'string' && actionRoute.startsWith('/')) {
      if (category === 'ecommerce' || type === 'inventory') {
        closeNotificationCenter?.();
      }
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
        `notification-item--type-${category}`,
        `notification-item--source-${type}`,
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
          <span className={`notification-item__badge notification-item__badge--type-${category}`}>
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
