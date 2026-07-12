import { Bell } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { useEcommercePublishedStockAlerts } from '../../hooks/useEcommercePublishedStockAlerts';
import {
  canStaffAccessEcommerceOperationalAlert,
  canStaffAccessNotifications,
  isCloudNotificationsEnabled,
  isNotificationCenterEnabled
} from '../../services/notifications/notificationCapabilities';
import EcommercePublishedStockOperationalAlert from './EcommercePublishedStockOperationalAlert';
import NotificationCenterDrawer from './NotificationCenterDrawer';
import './NotificationCenter.css';
import './EcommercePublishedStockOperationalAlert.css';

export default function NotificationBell({ className = '' }) {
  const navigate = useNavigate();
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const isOpen = useAppStore((state) => state.isNotificationCenterOpen);
  const unreadCount = useAppStore((state) => state.notificationsUnreadCount);
  const openNotificationCenter = useAppStore((state) => state.openNotificationCenter);
  const closeNotificationCenter = useAppStore((state) => state.closeNotificationCenter);
  const staffSession = { currentDeviceRole, currentStaffUser };
  const isEnabled = (
    isNotificationCenterEnabled(licenseDetails) &&
    isCloudNotificationsEnabled(licenseDetails) &&
    canStaffAccessNotifications(licenseDetails, staffSession)
  );
  const canShowLocalOperationalAlert = (
    isEnabled
    && canStaffAccessEcommerceOperationalAlert(licenseDetails, staffSession)
  );
  const { snapshot } = useEcommercePublishedStockAlerts({
    enabled: canShowLocalOperationalAlert,
    reason: 'notification_center'
  });
  const hasLocalOperationalWarning = Boolean(
    canShowLocalOperationalAlert
    && snapshot?.success === true
    && snapshot?.portalStatus === 'published'
    && Number(snapshot?.outOfStockCount || 0) > 0
  );

  if (!isEnabled) return null;

  const buttonClassName = [
    'notification-bell',
    hasLocalOperationalWarning ? 'has-local-operational-warning' : '',
    className
  ].filter(Boolean).join(' ');
  const safeUnreadCount = Number(unreadCount || 0);
  const drawer = (
    <>
      <NotificationCenterDrawer
        isOpen={isOpen}
        onClose={closeNotificationCenter}
        unreadCount={safeUnreadCount}
      />
      <EcommercePublishedStockOperationalAlert
        isOpen={isOpen}
        snapshot={hasLocalOperationalWarning ? snapshot : null}
        onNavigate={(route) => {
          closeNotificationCenter?.();
          navigate(route);
        }}
      />
    </>
  );

  const openLabel = [
    `Abrir centro de notificaciones, ${safeUnreadCount} sin leer`,
    hasLocalOperationalWarning ? 'alerta operacional de ecommerce activa' : ''
  ].filter(Boolean).join(', ');

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onClick={isOpen ? closeNotificationCenter : openNotificationCenter}
        aria-label={isOpen ? 'Cerrar centro de notificaciones' : openLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="notification-center-drawer"
      >
        <Bell size={20} strokeWidth={2.35} aria-hidden="true" />
        {safeUnreadCount > 0 && (
          <span className="notification-bell__badge" aria-label={`${safeUnreadCount} notificaciones sin leer`}>
            {safeUnreadCount > 99 ? '99+' : safeUnreadCount}
          </span>
        )}
        {hasLocalOperationalWarning && !isOpen && (
          <span
            className="notification-bell__warning-dot"
            aria-label="Alerta operacional: productos publicados sin stock"
          />
        )}
      </button>

      {typeof document === 'undefined' ? drawer : createPortal(drawer, document.body)}
    </>
  );
}
