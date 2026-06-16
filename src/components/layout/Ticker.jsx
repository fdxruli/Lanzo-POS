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
  Clock,
  Package,
  Rocket,
  Shield,
  Sparkles
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useTickerAlerts } from '../../hooks/useTickerAlerts';
import Logger from '../../services/Logger';
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

export default function Ticker() {
  const navigate = useNavigate();
  const licenseStatus = useAppStore(state => state.licenseStatus);
  const gracePeriodEnds = useAppStore(state => state.gracePeriodEnds);
  const licenseDetails = useAppStore(state => state.licenseDetails);
  const { catalogSize, alerts } = useTickerAlerts();
  const backupAlert = useBackupAlert(catalogSize > BACKUP_ALERT_THRESHOLD);
  const { containerRef, shouldPauseAnimation } = useTickerVisibility();

  const { messages, isPriority } = useMemo(() => {
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
  }, [alerts, backupAlert, gracePeriodEnds, licenseDetails, licenseStatus]);

  const animationDuration = useMemo(() => {
    const secondsPerMessage = isPriority ? 8 : SECONDS_PER_MESSAGE;
    return Math.max(
      MIN_ANIMATION_DURATION,
      messages.length * secondsPerMessage
    );
  }, [isPriority, messages.length]);

  const handleAlertClick = useCallback((message) => {
    if (message.route) navigate(message.route);
  }, [navigate]);

  const containerClasses = [
    'notification-ticker-container',
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
            const isClickable = Boolean(message.route);
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
                role={isClickable ? 'link' : undefined}
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
