import { useActorAccess } from '../../services/auth/useActorAccess';
import { canAccessCloudNotificationCenter, getNotificationAuthorizationKey } from '../../services/notifications/notificationAccess';
import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { useEcommercePublishedStockAlerts } from '../../hooks/useEcommercePublishedStockAlerts';
import { useInventoryOperationalAlertsSnapshot } from '../../hooks/useInventoryOperationalAlertsSnapshot';
import useCashSessionAgeAttention from '../../hooks/useCashSessionAgeAttention';
import usePostDowngradeCashPending from '../../hooks/usePostDowngradeCashPending';
import { useLocalBackupAttention } from '../../hooks/useLocalBackupAttention';
import { isValidBusinessTimezone } from '../../utils/layawayCalendar';
import {
  getLicenseKeyFromDetails,
  isCloudCashSyncEnabled
} from '../../services/sync/syncConstants';
import {
  buildPostDowngradeCashAttentionKey,
  POST_DOWNGRADE_CASH_ATTENTION_EVENT,
  readPostDowngradeCashAttention
} from '../../services/cash/postDowngradeCashAttention';
import {
  canStaffAccessEcommerceOperationalAlert,
  canStaffAccessLocalInventoryOperationalAlerts,
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
  const actorAccess = useActorAccess();
  const [isLocalOpen, setIsLocalOpen] = useState(false);
  const closeLocal = useCallback(() => setIsLocalOpen(false), []);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentAdminUser = useAppStore((state) => state.currentAdminUser);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const companyProfile = useAppStore((state) => state.companyProfile);
  const syncNotificationRuntime = useAppStore((state) => state.syncNotificationRuntime);
  const notificationAuthorizationKey = getNotificationAuthorizationKey({ licenseDetails }, actorAccess);
  const storedAuthorizationKey = useAppStore((state) => state.notificationAuthorizationKey);
  const notificationsAccessDenied = useAppStore((state) => state.notificationsAccessDenied);
  useEffect(() => { syncNotificationRuntime?.(); }, [notificationAuthorizationKey, syncNotificationRuntime]);
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

  const cloudEnabled = canAccessCloudNotificationCenter(licenseDetails, actorAccess);
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const businessTimezoneReminderNeeded = Boolean(
    actorAccess.isAdmin
    && companyProfile?.license_key
    && companyProfile.license_key === licenseDetails?.license_key
    && !isValidBusinessTimezone(companyProfile.timezone)
  );
  const localTimezoneReminder = businessTimezoneReminderNeeded && !cloudEnabled;
  const cloudTimezoneReminder = businessTimezoneReminderNeeded && cloudEnabled && !notificationsAccessDenied;
  const isCloudCash = Boolean(licenseKey && isCloudCashSyncEnabled(licenseDetails));
  const cashActorKey = currentAdminUser?.id ? 'admin:' + currentAdminUser.id : null;
  const isCurrentOwner = Boolean(
    actorAccess.isAdmin &&
    currentDeviceRole === 'admin' &&
    currentAdminUser?.is_owner === true
  );
  const canLoadCashSessionAgeAttention = Boolean(
    isCurrentOwner &&
    (!isCloudCash || (cloudEnabled && !localOnly && !notificationsAccessDenied))
  );
  const cashSessionAgeScopeKey = canLoadCashSessionAgeAttention
    ? JSON.stringify([
      licenseDetails?.license_id || licenseDetails?.id || null,
      licenseKey,
      currentAdminUser?.id || null,
      actorAccess.runtimeSnapshot?.sessionId || null,
      actorAccess.runtimeSnapshot?.generation || null,
      actorAccess.runtimeSnapshot?.tenant || null,
      actorAccess.runtimeSnapshot?.deviceRef || null,
      cashActorKey,
      isCloudCash ? 'cloud' : 'local'
    ])
    : null;
  const cashSessionAgeAttention = useCashSessionAgeAttention({
    enabled: canLoadCashSessionAgeAttention,
    scopeKey: cashSessionAgeScopeKey,
    isCloudCash,
    actorKey: cashActorKey
  });
  const localInventoryEnabled = (
    shouldUseLocalInventoryOperationalBell(licenseDetails) &&
    canStaffAccessLocalInventoryOperationalAlerts(licenseDetails, staffSession)
  );
  const hasLocalAgedCashSessions = Boolean(
    canLoadCashSessionAgeAttention &&
    !isCloudCash &&
    cashSessionAgeAttention.status === 'success' &&
    cashSessionAgeAttention.pendingCount > 0
  );
  const hasCloudAgedCashSessions = Boolean(
    canLoadCashSessionAgeAttention &&
    isCloudCash &&
    cashSessionAgeAttention.status === 'success' &&
    cashSessionAgeAttention.pendingCount > 0
  );
  const backupAttention = useLocalBackupAttention();
  const localEnabled = localInventoryEnabled || backupAttention.enabled || hasLocalAgedCashSessions || localTimezoneReminder;
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
  }, [setCashAttentionRecord]);

  const handleReviewCashSessions = useCallback(() => {
    const session = cashSessionAgeAttention.agedSessions[0]?.session;
    const sessionId = session?.id || session?.cash_session_id || null;
    setIsLocalOpen(false);
    closeNotificationCenter?.();
    navigate('/caja', {
      state: {
        cashSessionAttention: {
          section: isCloudCash ? 'negocio' : 'turno',
          sessionId
        }
      }
    });
  }, [cashSessionAgeAttention.agedSessions, closeNotificationCenter, isCloudCash, navigate]);

  const canShowLocalOperationalAlert = (
    !localOnly
    && cloudEnabled
    && !notificationsAccessDenied
    && canStaffAccessEcommerceOperationalAlert(licenseDetails, actorAccess.permissionSession)
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
    const localIncidentCount = safeActiveCount + (hasConfirmedCashAttention ? 1 : 0)
      + (hasLocalAgedCashSessions ? 1 : 0) + (hasBackupAttention ? 1 : 0);
    const badge = localIncidentCount > 99 ? '99+' : localIncidentCount;
    const localOpenLabelBase = backupAttention.enabled || !localInventoryEnabled
      ? `Abrir alertas locales, ${localIncidentCount} ${localIncidentCount === 1 ? 'incidencia activa' : 'incidencias activas'}${hasBackupAttention ? '; respaldos necesitan atención' : ''}`
      : hasConfirmedCashAttention
      ? `Abrir alertas locales, ${localIncidentCount} ${localIncidentCount === 1 ? 'incidencia activa' : 'incidencias activas'}; una agrupa ${cashPendingCount} cajas para conciliación`
      : `Abrir alertas operativas de inventario, ${safeActiveCount} activas`;
    const localOpenLabel = `${localOpenLabelBase}${localTimezoneReminder ? '; zona horaria pendiente' : ''}`;
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
        showBusinessTimezoneReminder={localTimezoneReminder}
        cashSessionAgeAttention={canLoadCashSessionAgeAttention && !isCloudCash
          ? cashSessionAgeAttention
          : null}
        onReviewCashSessions={handleReviewCashSessions}
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
              : hasLocalAgedCashSessions
                ? 'Abrir alertas locales, ' + localIncidentCount
                  + (localIncidentCount === 1 ? ' incidencia activa' : ' incidencias activas')
                  + '; una agrupa '
                  + cashSessionAgeAttention.pendingCount + ' cajas abiertas antiguas'
                  + (localTimezoneReminder ? '; zona horaria pendiente' : '')
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
          {localTimezoneReminder && !isLocalOpen && (
            <span className="notification-bell__warning-dot" aria-hidden="true" />
          )}
        </button>

        {typeof document === 'undefined' ? drawer : createPortal(drawer, document.body)}
      </>
    );
  }

  if (localOnly) return null;
  if (!cloudEnabled || notificationsAccessDenied) {
    const restrictedDrawer = <NotificationCenterDrawer isOpen={isOpen} onClose={closeNotificationCenter} />;
    return typeof document === 'undefined' ? restrictedDrawer : createPortal(restrictedDrawer, document.body);
  }

  const buttonClassName = [
    'notification-bell',
    hasLocalOperationalWarning ? 'has-local-operational-warning' : '',
    hasCloudAgedCashSessions ? 'has-cash-session-attention' : '',
    className
  ].filter(Boolean).join(' ');
  const runtimeCurrent = storedAuthorizationKey === notificationAuthorizationKey;
  const safeUnreadCount = runtimeCurrent ? Number(unreadCount || 0) : 0;
  const safeUnseenCount = runtimeCurrent ? Number(unseenCount || 0) : 0;
  const drawer = (
    <>
      <NotificationCenterDrawer
        isOpen={isOpen}
        onClose={closeNotificationCenter}
        unreadCount={safeUnreadCount}
        showBusinessTimezoneReminder={cloudTimezoneReminder}
        cashSessionAgeAttention={canLoadCashSessionAgeAttention && isCloudCash
          ? cashSessionAgeAttention
          : null}
        onReviewCashSessions={handleReviewCashSessions}
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
    hasCloudAgedCashSessions ? 'una incidencia de Caja abierta requiere revisión' : '',
    `Abrir centro de notificaciones, ${safeUnseenCount} nuevas`,
    hasLocalOperationalWarning ? 'alerta operacional de ecommerce activa' : '',
    cloudTimezoneReminder ? 'zona horaria pendiente' : ''
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
        aria-label={isOpen
          ? 'Cerrar centro de notificaciones'
          : hasCloudAgedCashSessions
            ? openLabel + ', hay cajas abiertas que requieren revisión'
            : openLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="notification-center-drawer"
      >
        <Bell size={20} strokeWidth={2.35} aria-hidden="true" />
        {showLabel && <span className="notification-bell__label">Notificaciones</span>}
        {(safeUnseenCount > 0 || hasCloudAgedCashSessions) && (
          <span className="notification-bell__badge" aria-label={hasCloudAgedCashSessions
            ? safeUnseenCount > 0
              ? safeUnseenCount + ' notificaciones nuevas y 1 incidencia de Caja'
              : '1 incidencia de Caja requiere revisión'
            : safeUnseenCount + ' notificaciones nuevas'}>
            {safeUnseenCount + (hasCloudAgedCashSessions ? 1 : 0) > 99
              ? '99+'
              : safeUnseenCount + (hasCloudAgedCashSessions ? 1 : 0)}
          </span>
        )}
        {(hasLocalOperationalWarning || hasCloudAgedCashSessions || cloudTimezoneReminder) && !isOpen && (
          <span
            className="notification-bell__warning-dot"
            aria-label={hasCloudAgedCashSessions
              ? 'Alerta de Caja: sesiones abiertas que requieren revisión'
              : cloudTimezoneReminder
                ? 'Recordatorio: zona horaria pendiente'
                : 'Alerta operacional: productos publicados sin stock'}
          />
        )}
      </button>

      {typeof document === 'undefined' ? drawer : createPortal(drawer, document.body)}
    </>
  );
}
