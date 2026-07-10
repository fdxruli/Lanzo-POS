import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BellDot,
  CircleDollarSign,
  Clock,
  Cloud,
  CloudCog,
  Headphones,
  MonitorCog,
  Package,
  Rocket,
  Shield,
  Sparkles
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useTickerAlerts } from '../../hooks/useTickerAlerts';
import Logger from '../../services/Logger';
import {
  canStaffAccessNotifications,
  getTickerMode,
  isCloudNotificationsEnabled,
  isNotificationCenterEnabled,
  shouldUseLocalTicker,
  shouldUseSummaryTicker
} from '../../services/notifications/notificationCapabilities';
import {
  isCategoryMuted,
  isNotificationHiddenByPreferences,
  normalizeNotificationPreferences
} from '../../services/notifications/notificationPreferencesService';
import './Ticker.css';

const MAX_INVENTORY_ALERTS = 8;
const BACKUP_ALERT_THRESHOLD = 5;
const SECONDS_PER_MESSAGE = 10;
const MIN_ANIMATION_DURATION = 15;
const GRACE_PERIOD_DAYS = 7;

const URGENCY = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2
};

const promotionalMessages = [
  { id: 'promo-growth', icon: Rocket, text: '¡Potencia tu negocio con Lanzo POS!', urgency: URGENCY.INFO },
  { id: 'promo-inventory', icon: Package, text: 'Gestiona tu inventario de forma fácil y rápida.', urgency: URGENCY.INFO },
  { id: 'promo-progress', icon: Sparkles, text: '¡Sigue creciendo tu negocio con nosotros!', urgency: URGENCY.INFO }
];

function getDaysRemaining(endDate) {
  if (!endDate) return 0;

  const now = new Date();
  const end = new Date(endDate);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86400000));
}

function getDayText(days) {
  if (days <= 0) return 'hoy';
  if (days === 1) return 'mañana';
  return `en ${days} días`;
}

function deriveGracePeriodEnd(expiresAt) {
  if (!expiresAt) return null;

  const expiryDate = new Date(expiresAt);
  if (Number.isNaN(expiryDate.getTime())) return null;

  return new Date(
    expiryDate.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

function readBackupAlert() {
  const postponedUntil = localStorage.getItem('backup_postponed_until');
  if (postponedUntil && Date.now() < new Date(postponedUntil).getTime()) {
    return null;
  }

  const lastBackup = localStorage.getItem('last_backup_date');
  if (!lastBackup) {
    return {
      id: 'backup-missing',
      icon: Shield,
      text: 'No has realizado ninguna copia de seguridad. Ve a Configuración > Exportar.',
      urgency: URGENCY.WARNING,
      route: '/configuracion'
    };
  }

  const lastBackupTime = new Date(lastBackup).getTime();
  if (!Number.isFinite(lastBackupTime)) return null;

  const diffDays = Math.ceil(Math.abs(Date.now() - lastBackupTime) / 86400000);
  return diffDays > 7
    ? {
        id: 'backup-stale',
        icon: Shield,
        text: `Hace ${diffDays} días que no respaldas tus datos. ¡Haz una copia hoy!`,
        urgency: URGENCY.WARNING,
        route: '/configuracion'
      }
    : null;
}

function useBackupAlert(enabled) {
  const [backupAlert, setBackupAlert] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer;

    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (cancelled) return;

        try {
          setBackupAlert(enabled ? readBackupAlert() : null);
        } catch (error) {
          Logger.warn('No se pudo leer el estado de respaldo del ticker:', error);
          setBackupAlert(null);
        }
      }, 0);
    };

    refresh();
    window.addEventListener('backup_status_changed', refresh);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('backup_status_changed', refresh);
    };
  }, [enabled]);

  return backupAlert;
}

function useTickerVisibility() {
  const containerRef = useRef(null);
  const [isPageVisible, setIsPageVisible] = useState(
    () => document.visibilityState === 'visible'
  );
  const [isIntersecting, setIsIntersecting] = useState(true);

  useEffect(() => {
    const handleVisibility = () => {
      setIsPageVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => setIsIntersecting(entry.isIntersecting),
      { threshold: 0.01 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return {
    containerRef,
    shouldPauseAnimation: !isPageVisible || !isIntersecting
  };
}

function toTickerMessage(alert) {
  if (alert.type === 'low-stock') {
    return {
      ...alert,
      icon: Package,
      text: `¡Stock bajo! Quedan ${alert.availableStock} unidades disponibles de ${alert.productName}.`
    };
  }

  return {
    ...alert,
    icon: Clock,
    text: alert.expiryDays === 0
      ? `¡Atención! ${alert.productName} caduca hoy.`
      : `¡Atención! ${alert.productName} caduca en ${alert.expiryDays} días.`
  };
}

function isUnread(notification) {
  return notification?.is_read !== true && notification?.is_archived !== true;
}

function getOperationalSummary(notification) {
  if (!notification) return null;

  if (notification.type === 'sync') {
    return {
      icon: CloudCog,
      text: 'Sincronización cloud requiere atención. Revisa Lanzo Nube.'
    };
  }

  if (notification.type === 'cash') {
    return {
      icon: CircleDollarSign,
      text: 'Hay una alerta de caja cloud. Revisa Lanzo Nube.'
    };
  }

  return {
    icon: MonitorCog,
    text: 'Hay un aviso de dispositivos o staff. Revisa Lanzo Nube.'
  };
}

function buildSummaryMessages({
  notifications = [],
  notificationsUnreadCount = 0,
  supportTickets = [],
  notificationPreferences
}) {
  const preferences = normalizeNotificationPreferences(notificationPreferences);
  const unreadNotifications = notifications.filter((notification) => (
    isUnread(notification) &&
    !isNotificationHiddenByPreferences(notification, preferences, { surface: 'ticker' })
  ));
  const messages = [];

  const criticalAlert = unreadNotifications.find((notification) => (
    notification.severity === 'critical'
  ));
  const licenseAlert = criticalAlert || unreadNotifications.find((notification) => (
    notification.type === 'license' && notification.severity === 'critical'
  )) || unreadNotifications.find((notification) => (
    notification.type === 'license' && notification.severity === 'warning'
  ));

  if (licenseAlert) {
    const isLicenseAlert = licenseAlert.type === 'license';
    messages.push({
      id: `summary-critical-${licenseAlert.id}`,
      icon: AlertTriangle,
      text: isLicenseAlert
        ? 'Hay una alerta importante de licencia. Revisa Lanzo Nube.'
        : 'Hay una alerta crítica en Lanzo Nube. Revisa el Centro de Notificaciones.',
      urgency: licenseAlert.severity === 'critical' ? URGENCY.CRITICAL : URGENCY.WARNING,
      openNotificationCenter: true
    });
  }

  const supportNotification = unreadNotifications.find((notification) => (
    notification.type === 'support' && notification.metadata?.ticket_id
  ));
  const canShowSupportInTicker = (
    preferences.tickerCategories?.support !== false &&
    !isCategoryMuted('support', preferences)
  );
  const supportTicketWaiting = canShowSupportInTicker
    ? supportTickets.find((ticket) => ticket.status === 'waiting_user')
    : null;
  const supportTicketId = supportNotification?.metadata?.ticket_id || supportTicketWaiting?.id || null;

  if (canShowSupportInTicker && (supportNotification || supportTicketWaiting)) {
    messages.push({
      id: `summary-support-${supportTicketId || supportNotification?.id || 'waiting'}`,
      icon: Headphones,
      text: 'Soporte respondió una solicitud. Abre el Centro de Notificaciones.',
      urgency: URGENCY.WARNING,
      openNotificationCenter: true,
      tab: 'support',
      ticketId: supportTicketId
    });
  }

  const operationalWarning = unreadNotifications.find((notification) => (
    ['sync', 'cash'].includes(notification.type) &&
    ['critical', 'warning'].includes(notification.severity)
  )) || unreadNotifications.find((notification) => (
    notification.type === 'system' &&
    ['critical', 'warning'].includes(notification.severity) &&
    ['staff', 'sync', 'cash'].includes(notification.metadata?.category)
  ));

  if (
    operationalWarning &&
    operationalWarning.id !== licenseAlert?.id &&
    !messages.some((message) => message.sourceNotificationId === operationalWarning.id)
  ) {
    const summary = getOperationalSummary(operationalWarning);
    messages.push({
      id: `summary-operational-${operationalWarning.id}`,
      sourceNotificationId: operationalWarning.id,
      icon: summary.icon,
      text: summary.text,
      urgency: operationalWarning.severity === 'critical' ? URGENCY.CRITICAL : URGENCY.WARNING,
      openNotificationCenter: true
    });
  }

  const safeUnreadCount = Math.min(
    Number(notificationsUnreadCount || 0),
    unreadNotifications.length
  );
  if (safeUnreadCount > 0) {
    messages.push({
      id: 'summary-unread-count',
      icon: BellDot,
      text: `Tienes ${safeUnreadCount} notificaciones nuevas en Lanzo Nube.`,
      urgency: URGENCY.INFO,
      openNotificationCenter: true
    });
  }

  if (messages.length === 0) {
    messages.push({
      id: 'summary-cloud-ok',
      icon: Cloud,
      text: 'Lanzo Nube activo: sincronización, soporte y notificaciones cloud disponibles.',
      urgency: URGENCY.INFO,
      openNotificationCenter: true
    });
  }

  return messages.slice(0, 3);
}

export default function Ticker() {
  const navigate = useNavigate();
  const licenseStatus = useAppStore(state => state.licenseStatus);
  const gracePeriodEnds = useAppStore(state => state.gracePeriodEnds);
  const licenseDetails = useAppStore(state => state.licenseDetails);
  const currentDeviceRole = useAppStore(state => state.currentDeviceRole);
  const currentStaffUser = useAppStore(state => state.currentStaffUser);
  const notifications = useAppStore(state => state.notifications);
  const notificationsUnreadCount = useAppStore(state => state.notificationsUnreadCount);
  const supportTickets = useAppStore(state => state.supportTickets);
  const notificationPreferences = useAppStore(state => state.notificationPreferences);
  const openNotificationCenter = useAppStore(state => state.openNotificationCenter);
  const loadNotifications = useAppStore(state => state.loadNotifications);
  const tickerMode = getTickerMode(licenseDetails);
  const useLocalTicker = shouldUseLocalTicker(licenseDetails);
  const useSummaryTicker = (
    shouldUseSummaryTicker(licenseDetails) &&
    isNotificationCenterEnabled(licenseDetails) &&
    isCloudNotificationsEnabled(licenseDetails) &&
    canStaffAccessNotifications(licenseDetails, { currentDeviceRole, currentStaffUser })
  );
  const { catalogSize, alerts } = useTickerAlerts(useLocalTicker);
  const backupAlert = useBackupAlert(useLocalTicker && catalogSize > BACKUP_ALERT_THRESHOLD);
  const { containerRef, shouldPauseAnimation } = useTickerVisibility();

  useEffect(() => {
    if (!useSummaryTicker) return;
    loadNotifications?.();
  }, [loadNotifications, useSummaryTicker]);

  const { messages, isPriority } = useMemo(() => {
    if (useSummaryTicker) {
      return {
        messages: buildSummaryMessages({
          notifications,
          notificationsUnreadCount,
          supportTickets,
          notificationPreferences
        }),
        isPriority: false
      };
    }

    const now = new Date();
    const effectiveGracePeriodEnds =
      gracePeriodEnds ||
      (licenseStatus === 'grace_period'
        ? deriveGracePeriodEnd(licenseDetails?.expires_at)
        : null);
    const graceDate = effectiveGracePeriodEnds ? new Date(effectiveGracePeriodEnds) : null;
    const expiryDate = licenseDetails?.expires_at
      ? new Date(licenseDetails.expires_at)
      : null;
    const isGracePeriod = licenseStatus === 'grace_period'
      || (expiryDate && graceDate && expiryDate < now && graceDate > now);

    if (isGracePeriod && effectiveGracePeriodEnds) {
      const warning = {
        id: 'license-grace',
        icon: AlertTriangle,
        text: `Tu licencia ha caducado. El sistema se bloqueará ${getDayText(getDaysRemaining(effectiveGracePeriodEnds))}. Renueva tu plan para evitar interrupciones.`,
        urgency: URGENCY.CRITICAL,
        route: '/configuracion'
      };

      return {
        messages: [
          warning,
          { ...warning, id: 'license-grace-2' },
          { ...warning, id: 'license-grace-3' }
        ],
        isPriority: true
      };
    }

    const inventoryMessages = alerts
      .map(toTickerMessage)
      .concat(backupAlert ? [backupAlert] : [])
      .sort((left, right) => left.urgency - right.urgency)
      .slice(0, MAX_INVENTORY_ALERTS);

    return {
      messages: inventoryMessages.length > 0
        ? inventoryMessages
        : promotionalMessages,
      isPriority: false
    };
  }, [
    alerts,
    backupAlert,
    gracePeriodEnds,
    licenseDetails,
    licenseStatus,
    notifications,
    notificationsUnreadCount,
    notificationPreferences,
    supportTickets,
    useSummaryTicker
  ]);

  const animationDuration = useMemo(() => {
    const secondsPerMessage = isPriority ? 8 : SECONDS_PER_MESSAGE;
    return Math.max(
      MIN_ANIMATION_DURATION,
      messages.length * secondsPerMessage
    );
  }, [isPriority, messages.length]);

  const handleAlertClick = useCallback((message) => {
    if (message.openNotificationCenter) {
      openNotificationCenter?.({
        tab: message.tab || null,
        ticketId: message.ticketId || null
      });
      return;
    }

    if (message.route) navigate(message.route);
  }, [navigate, openNotificationCenter]);

  const containerClasses = [
    'notification-ticker-container',
    tickerMode === 'summary' ? 'summary-mode' : '',
    isPriority ? 'priority-warning' : '',
    shouldPauseAnimation ? 'ticker-animation-paused' : ''
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={containerRef}
      id="notification-ticker-container"
      className={containerClasses}
      role="marquee"
      aria-label="Notificaciones del sistema"
      aria-live="polite"
    >
      <div className="ticker-wrap">
        <div
          className="ticker-move"
          style={{ animationDuration: `${animationDuration}s` }}
        >
          {messages.map(message => {
            const Icon = message.icon;
            const isClickable = Boolean(message.route || message.openNotificationCenter);
            const urgencyClass = message.urgency === URGENCY.CRITICAL
              ? 'urgency-critical'
              : message.urgency === URGENCY.WARNING
                ? 'urgency-warning'
                : 'urgency-info';

            return (
              <div
                key={message.id}
                className={`ticker-item ${urgencyClass} ${isClickable ? 'ticker-item-clickable' : ''}`}
                onClick={isClickable ? () => handleAlertClick(message) : undefined}
                role={isClickable ? (message.openNotificationCenter ? 'button' : 'link') : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onKeyDown={isClickable ? event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleAlertClick(message);
                  }
                } : undefined}
              >
                {Icon && <Icon size={18} aria-hidden="true" />}
                <span>{message.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
