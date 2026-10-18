import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { useEcommercePublishedStockAlerts } from '../../hooks/useEcommercePublishedStockAlerts';
import { useInventoryOperationalAlertsSnapshot } from '../../hooks/useInventoryOperationalAlertsSnapshot';
import usePostDowngradeCashPending from '../../hooks/usePostDowngradeCashPending';
import { useLocalBackupAttention } from '../../hooks/useLocalBackupAttention';
import {
  buildPostDowngradeCashAttentionKey,
  POST_DOWNGRADE_CASH_ATTENTION_EVENT,
  readPostDowngradeCashAttention
} from '../../services/cash/postDowngradeCashAttention';
import {
  canStaffAccessEcommerceOperationalAlert,
  canStaffAccessLocalInventoryOperationalAlerts,
  canStaffAccessNotifications,
  isCloudNotificationsEnabled,
  isNotificationCenterEnabled,
  shouldUseLocalInventoryOperationalBell
} from '../../services/notifications/notificationCapabilities';
import EcommercePublishedStockOperationalAlert from './EcommercePublishedStockOperationalAlert';
import LocalInventoryOperationalAlertsDrawer from './LocalInventoryOperationalAlertsDrawer';
import NotificationCenterDrawer from './NotificationCenterDrawer';
import './NotificationCenter.css';
import './EcommercePublishedStockOperationalAlert.css';

export default function NotificationBell({
  className = '',
  showLabel = false,
  onOpen,
  localOnly = false
}) {
  const navigate = useNavigate();
  const [isLocalOpen, setIsLocalOpen] = useState(false);
  const closeLocal = useCallback(() => setIsLocalOpen(false), []);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const isOpen = useAppStore((state) => state.isNotificationCenterOpen);
  const unreadCount = useAppStore((state) => state.notificationsUnreadCount);
  const unseenCount = useAppStore((state) => state.notificationsUnseenCount);
  const openNotificationCenter = useAppStore((state) => state.openNotificationCenter);
  const closeNotificationCenter = useAppStore((state) => state.closeNotificationCenter);
  const localSnapshot = useInventoryOperationalAlertsSnapshot();
  const postDowngradeCashPending = usePostDowngradeCashPending();
  const [cashAttentionKey, setCashAttentionKey] = useState(null);
  const [cashAttentionRecord, setCashAttentionRecord] = useState(null);
  const staffSession = { currentDeviceRole, currentStaffUser };

  const cloudEnabled = (
    isNotificationCenterEnabled(licenseDetails) &&
    isCloudNotificationsEnabled(licenseDetails) &&
    canStaffAccessNotifications(licenseDetails, staffSession)
  );
  const localInventoryEnabled = (
    shouldUseLocalInventoryOperationalBell(licenseDetails) &&
    canStaffAccessLocalInventoryOperationalAlerts(licenseDetails, staffSession)
  );
  const backupAttention = useLocalBackupAttention();
  const localEnabled = localInventoryEnabled || backupAttention.enabled;
  const hasBackupAttention = Boolean(backupAttention.ready && backupAttention.condition?.active);
  const hasConfirmedCashAttention = Boolean(
    postDowngradeCashPending.eligible
    && Number.isInteger(postDowngradeCashPending.pendingCount)
    && postDowngradeCashPending.pendingCount > 0
  );
  const cashPendingCount = hasConfirmedCashAttention
    ? postDowngradeCashPending.pendingCount
    : 0;

  useEffect(() => {
    let current = true;

    if (!hasConfirmedCashAttention || !postDowngradeCashPending.scopeKey) {
      setCashAttentionKey(null);
      setCashAttentionRecord(null);
      return () => {
        current = false;
      };
    }

    setCashAttentionKey(null);
    setCashAttentionRecord(null);
    void buildPostDowngradeCashAttentionKey({
      scopeKey: postDowngradeCashPending.scopeKey,
      downgradedAt: postDowngradeCashPending.downgradedAt
    }).then((key) => {
      if (!current) return;
      setCashAttentionKey(key);
      setCashAttentionRecord(readPostDowngradeCashAttention(key));
    });

    return () => {
      current = false;
    };
  }, [
    hasConfirmedCashAttention,
    postDowngradeCashPending.downgradedAt,
    postDowngradeCashPending.scopeKey
  ]);

  useEffect(() => {
    if (!cashAttentionKey || typeof window === 'undefined') return undefined;

    const handleAttentionChange = (event) => {
      if (event?.detail?.key !== cashAttentionKey) return;
      setCashAttentionRecord(readPostDowngradeCashAttention(cashAttentionKey));
    };

    window.addEventListener(POST_DOWNGRADE_CASH_ATTENTION_EVENT, handleAttentionChange);
    return () => window.removeEventListener(POST_DOWNGRADE_CASH_ATTENTION_EVENT, handleAttentionChange);
  }, [cashAttentionKey]);

  const handleCashAttentionRead = useCallback((record) => {
    setCashAttentionRecord(record);
  }, []);

  const canShowLocalOperationalAlert = (
    !localOnly
    && cloudEnabled
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

  if (localOnly && !localEnabled) return null;

  if (localEnabled) {
    const safeActiveCount = localInventoryEnabled ? Math.max(Number(localSnapshot?.activeCount || 0), 0) : 0;
    const localIncidentCount = safeActiveCount + (hasConfirmedCashAttention ? 1 : 0) + (hasBackupAttention ? 1 : 0);
    const badge = localIncidentCount > 99 ? '99+' : localIncidentCount;
    const localOpenLabel = backupAttention.enabled || !localInventoryEnabled
      ? `Abrir alertas locales, ${localIncidentCount} ${localIncidentCount === 1 ? 'incidencia activa' : 'incidencias activas'}${hasBackupAttention ? '; respaldos necesitan atención' : ''}`
      : hasConfirmedCashAttention
      ? `Abrir alertas locales, ${localIncidentCount} ${localIncidentCount === 1 ? 'incidencia activa' : 'incidencias activas'}; una agrupa ${cashPendingCount} cajas para conciliación`
      : `Abrir alertas operativas de inventario, ${safeActiveCount} activas`;
    const localButtonClassName = [
      'notification-bell',
      'notification-bell--local-inventory',
      className
    ].filter(Boolean).join(' ');
    const drawer = (
      <LocalInventoryOperationalAlertsDrawer
        isOpen={isLocalOpen}
        onClose={closeLocal}
        snapshot={localSnapshot}
        postDowngradeCashPending={postDowngradeCashPending}
        cashAttentionKey={cashAttentionKey}
        cashAttentionRecord={cashAttentionRecord}
        onCashAttentionRecordChange={handleCashAttentionRead}
        backupAttention={backupAttention}
        inventoryEnabled={localInventoryEnabled}
      />
    );

    return (
      <>
        <button
          type="button"
          className={localButtonClassName}
          onClick={() => {
            if (isLocalOpen) {
              setIsLocalOpen(false);
              return;
            }
            onOpen?.();
            setIsLocalOpen(true);
          }}
          aria-label={
            isLocalOpen
              ? 'Cerrar alertas locales'
              : localOpenLabel
          }
          aria-haspopup="dialog"
          aria-expanded={isLocalOpen}
          aria-controls="local-inventory-operational-alerts-drawer"
        >
          <Bell size={20} strokeWidth={2.35} aria-hidden="true" />
          {showLabel && <span className="notification-bell__label">Alertas locales</span>}
          {localIncidentCount > 0 && (
            <span
              className="notification-bell__badge"
              aria-label={hasBackupAttention
                ? `${localIncidentCount} ${localIncidentCount === 1 ? 'incidencia activa' : 'incidencias activas'}: ${safeActiveCount} de inventario, ${hasConfirmedCashAttention ? 1 : 0} de Caja y conciliación y 1 de respaldos`
                : hasConfirmedCashAttention
              ? `${localIncidentCount} ${localIncidentCount === 1 ? 'incidencia' : 'incidencias'} activas: ${safeActiveCount} de inventario y 1 de Caja y conciliación`
                : `${safeActiveCount} alertas operativas activas`}
            >
              {badge}
            </span>
          )}
        </button>

        {typeof document === 'undefined' ? drawer : createPortal(drawer, document.body)}
      </>
    );
  }

  if (localOnly || !cloudEnabled) return null;

  const buttonClassName = [
    'notification-bell',
    hasLocalOperationalWarning ? 'has-local-operational-warning' : '',
    className
  ].filter(Boolean).join(' ');
  const safeUnreadCount = Number(unreadCount || 0);
  const safeUnseenCount = Number(unseenCount || 0);
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
    `Abrir centro de notificaciones, ${safeUnseenCount} nuevas`,
    hasLocalOperationalWarning ? 'alerta operacional de ecommerce activa' : ''
  ].filter(Boolean).join(', ');

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => {
          if (isOpen) {
            closeNotificationCenter?.();
            return;
          }
          onOpen?.();
          openNotificationCenter?.();
        }}
        aria-label={isOpen ? 'Cerrar centro de notificaciones' : openLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="notification-center-drawer"
      >
        <Bell size={20} strokeWidth={2.35} aria-hidden="true" />
        {showLabel && <span className="notification-bell__label">Notificaciones</span>}
        {safeUnseenCount > 0 && (
          <span className="notification-bell__badge" aria-label={`${safeUnseenCount} notificaciones nuevas`}>
            {safeUnseenCount > 99 ? '99+' : safeUnseenCount}
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
