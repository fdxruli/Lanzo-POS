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
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { useActorAccess } from '../../services/auth/useActorAccess';
import { readActorAccess } from '../../services/auth/actorAccessPolicy';
import { evaluateSettingsAccess } from '../../services/auth/settingsAccessPolicy';
import { getNotificationAuthorizationKey } from '../../services/notifications/notificationAccess';
import {
  isPendingSyncConflictNotification,
  resolveNotificationAction
} from '../../services/notifications/notificationActionNavigation';
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
  inventory: Package,
  operations: CircleDollarSign,
  license: KeyRound,
  support: Headphones,
  ecommerce: ShoppingBag,
  system: MonitorCog
};

const CATEGORY_LABELS = {
  inventory: 'Inventario',
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
  onDiagnose,
  syncDiagnosticsAvailable = false,
  preferences
}) {
  const navigate = useNavigate();
  const closeNotificationCenter = useAppStore((state) => state.closeNotificationCenter);
  const actorAccess = useActorAccess();
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const storedAuthorizationKey = useAppStore((state) => state.notificationAuthorizationKey);
  const authorizationKey = getNotificationAuthorizationKey({ licenseDetails }, actorAccess);
  const hasCurrentContext = Boolean(authorizationKey && authorizationKey === storedAuthorizationKey);
  const settingsAccess = evaluateSettingsAccess({
    actorAccess,
    runtimeSnapshot: actorAccess.runtimeSnapshot
  });
  const operationRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [readError, setReadError] = useState('');
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
  const action = hasCurrentContext
    ? resolveNotificationAction(notification, { actorAccess, settingsAccess, licenseDetails, syncDiagnosticsAvailable })
    : null;

  const isCurrentContext = () => {
    const currentState = useAppStore.getState();
    const currentAccess = readActorAccess(currentState);
    return Boolean(
      authorizationKey
      && currentState.notificationAuthorizationKey === authorizationKey
      && getNotificationAuthorizationKey(currentState, currentAccess) === authorizationKey
    );
  };

  const handleRead = async (openAction = false) => {
    if (!id || !hasCurrentContext || operationRef.current || !isCurrentContext()) return;
    operationRef.current = true;
    setPending(true);
    setReadError('');

    try {
      const result = openAction && action?.kind === 'support'
        ? await onRead?.(id, { openSupport: true })
        : await onRead?.(id);
      if (result?.success !== true) {
        if (isCurrentContext()) setReadError('No se pudo marcar como leída. Intenta de nuevo.');
        return;
      }

      if (!openAction || action?.kind !== 'navigate' || !isCurrentContext()) return;

      const liveState = useAppStore.getState();
      const liveAccess = readActorAccess(liveState);
      const liveSettingsAccess = evaluateSettingsAccess({
        actorAccess: liveAccess,
        runtimeSnapshot: liveAccess.runtimeSnapshot
      });
      const liveAction = resolveNotificationAction(notification, {
        actorAccess: liveAccess,
        settingsAccess: liveSettingsAccess,
        licenseDetails: liveState.licenseDetails
      });
      if (liveAction?.kind !== 'navigate' || liveAction.route !== action.route) return;

      closeNotificationCenter?.();
      navigate(action.route);
    } catch {
      if (isCurrentContext()) setReadError('No se pudo marcar como leída. Intenta de nuevo.');
    } finally {
      operationRef.current = false;
      setPending(false);
    }
  };

  const handleArchive = (event) => {
    event.stopPropagation();
    if (id && hasCurrentContext && !pending && isCurrentContext()) {
      void onArchive?.(id);
    }
  };

  const handleAction = (event) => {
    event.stopPropagation();
    if (action?.kind === 'diagnose') {
      if (hasCurrentContext && isCurrentContext() && !pending) onDiagnose?.();
      return;
    }
    void handleRead(true);
  };

  const handleMarkRead = (event) => {
    event.stopPropagation();
    void handleRead(false);
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
      aria-busy={pending}
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
        {isPendingSyncConflictNotification(notification) && !syncDiagnosticsAvailable && (
          <p>Hay conflictos pendientes. Su diagnóstico detallado todavía no está disponible aquí.</p>
        )}
        {readError && <p role="alert">{readError}</p>}
        <div className="notification-item__footer">
          {displayDate && <time dateTime={createdAtRaw || createdAt}>{displayDate}</time>}
          {action && (
            <button
              type="button"
              className="notification-item__action"
              onClick={handleAction}
              disabled={pending}
            >
              {action.label}
            </button>
          )}
          {!isRead && (
            <button
              type="button"
              className="notification-item__read"
              onClick={handleMarkRead}
              disabled={pending || !hasCurrentContext}
            >
              Marcar como leída
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
          disabled={pending || !hasCurrentContext}
        >
          <Archive size={16} aria-hidden="true" />
        </button>
      )}
    </article>
  );
}
