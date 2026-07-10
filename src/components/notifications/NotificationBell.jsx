import { Bell } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import {
  canStaffAccessNotifications,
  isCloudNotificationsEnabled,
  isNotificationCenterEnabled
} from '../../services/notifications/notificationCapabilities';
import NotificationCenterDrawer from './NotificationCenterDrawer';
import './NotificationCenter.css';

export default function NotificationBell({ className = '' }) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const isOpen = useAppStore((state) => state.isNotificationCenterOpen);
  const unreadCount = useAppStore((state) => state.notificationsUnreadCount);
  const openNotificationCenter = useAppStore((state) => state.openNotificationCenter);
  const closeNotificationCenter = useAppStore((state) => state.closeNotificationCenter);
  const isEnabled = (
    isNotificationCenterEnabled(licenseDetails) &&
    isCloudNotificationsEnabled(licenseDetails) &&
    canStaffAccessNotifications(licenseDetails, { currentDeviceRole, currentStaffUser })
  );

  if (!isEnabled) return null;

  const buttonClassName = ['notification-bell', className].filter(Boolean).join(' ');
  const safeUnreadCount = Number(unreadCount || 0);
  const drawer = (
    <NotificationCenterDrawer
      isOpen={isOpen}
      onClose={closeNotificationCenter}
      unreadCount={safeUnreadCount}
    />
  );

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onClick={isOpen ? closeNotificationCenter : openNotificationCenter}
        aria-label={
          isOpen
            ? 'Cerrar centro de notificaciones'
            : `Abrir centro de notificaciones, ${safeUnreadCount} sin leer`
        }
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
      </button>

      {typeof document === 'undefined' ? drawer : createPortal(drawer, document.body)}
    </>
  );
}
