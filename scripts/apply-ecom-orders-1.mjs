import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const write = (path, content) => fs.writeFileSync(path, content, 'utf8');
const replaceRequired = (path, search, replacement, label) => {
  const source = read(path);
  if (!source.includes(search)) {
    throw new Error(`Missing transform ${label} in ${path}`);
  }
  write(path, source.replace(search, replacement));
};

replaceRequired(
  'src/store/useAppStore.js',
  "import { createNotificationSlice } from './slices/createNotificationSlice';\n",
  "import { createNotificationSlice } from './slices/createNotificationSlice';\nimport { createEcommerceOrderSlice } from './slices/createEcommerceOrderSlice';\n",
  'store import'
);
replaceRequired(
  'src/store/useAppStore.js',
  '  ...createDriveSlice(...a),\n  ...createNotificationSlice(...a)\n',
  '  ...createDriveSlice(...a),\n  ...createNotificationSlice(...a),\n  ...createEcommerceOrderSlice(...a)\n',
  'store composition'
);

replaceRequired(
  'src/App.jsx',
  "import PermissionRoute from './components/common/PermissionRoute';\n",
  "import PermissionRoute from './components/common/PermissionRoute';\nimport EcommerceOrdersRoute from './components/ecommerce/orders/EcommerceOrdersRoute';\n",
  'app route guard import'
);
replaceRequired(
  'src/App.jsx',
  "const OrdersPage = lazyRetry(() => import('./pages/OrderPage'), 'OrdersPage');\n",
  "const OrdersPage = lazyRetry(() => import('./pages/OrderPage'), 'OrdersPage');\nconst EcommerceOrdersPage = lazyRetry(() => import('./pages/EcommerceOrdersPage'), 'EcommerceOrdersPage');\n",
  'app lazy page'
);
replaceRequired(
  'src/App.jsx',
  '                  <Route path="pedidos" element={<PermissionRoute permission="orders"><Suspense fallback={<PageLoader />}><OrdersPage /></Suspense></PermissionRoute>} />\n',
  '                  <Route path="pedidos" element={<PermissionRoute permission="orders"><Suspense fallback={<PageLoader />}><OrdersPage /></Suspense></PermissionRoute>} />\n                  <Route path="pedidos-online" element={<EcommerceOrdersRoute><Suspense fallback={<PageLoader />}><EcommerceOrdersPage /></Suspense></EcommerceOrdersRoute>} />\n',
  'app ecommerce route'
);

replaceRequired(
  'src/components/layout/Layout.jsx',
  "import { useActiveOrders } from '../../hooks/pos/useActiveOrders';\n",
  "import { useActiveOrders } from '../../hooks/pos/useActiveOrders';\nimport EcommerceOrdersRuntime from '../ecommerce/orders/EcommerceOrdersRuntime';\n",
  'layout runtime import'
);
replaceRequired(
  'src/components/layout/Layout.jsx',
  '      <Navbar />\n\n      <div className={`content-wrapper',
  '      <Navbar />\n      <EcommerceOrdersRuntime />\n\n      <div className={`content-wrapper',
  'layout runtime mount'
);

replaceRequired(
  'src/services/notifications/notificationPreferencesService.js',
  "export const NOTIFICATION_CATEGORIES = ['support', 'cash', 'sync', 'license', 'system'];",
  "export const NOTIFICATION_CATEGORIES = ['support', 'ecommerce', 'cash', 'sync', 'license', 'system'];",
  'notification categories'
);
replaceRequired(
  'src/services/notifications/notificationPreferencesService.js',
  '    support: true,\n    cash: true,',
  '    support: true,\n    ecommerce: true,\n    cash: true,',
  'ticker ecommerce default'
);
replaceRequired(
  'src/services/notifications/notificationPreferencesService.js',
  '    support: true,\n    cash: true,',
  '    support: true,\n    ecommerce: true,\n    cash: true,',
  'featured ecommerce default'
);
replaceRequired(
  'src/services/notifications/notificationPreferencesService.js',
  '    support: null,\n    cash: null,',
  '    support: null,\n    ecommerce: null,\n    cash: null,',
  'muted ecommerce default'
);
replaceRequired(
  'src/services/notifications/notificationPreferencesService.js',
  "  if (type === 'support') return 'support';\n  if (type === 'cash' || metadataCategory === 'cash') return 'cash';",
  "  if (type === 'support') return 'support';\n  if (type === 'ecommerce' || metadataCategory === 'ecommerce') return 'ecommerce';\n  if (type === 'cash' || metadataCategory === 'cash') return 'cash';",
  'notification ecommerce classification'
);

replaceRequired(
  'src/components/notifications/NotificationPreferencesPanel.jsx',
  "  support: 'Soporte',\n  cash: 'Caja',",
  "  support: 'Soporte',\n  ecommerce: 'Pedidos online',\n  cash: 'Caja',",
  'preference label'
);
replaceRequired(
  'src/components/notifications/NotificationTabs.jsx',
  "  { key: 'support', label: 'Soporte' },\n  { key: 'operation', label: 'Operación' },",
  "  { key: 'support', label: 'Soporte' },\n  { key: 'ecommerce', label: 'Pedidos online' },\n  { key: 'operation', label: 'Operación' },",
  'notification ecommerce tab'
);

replaceRequired(
  'src/components/notifications/NotificationCenterDrawer.jsx',
  "  if (type === 'cash' || type === 'sync') return 'operation';\n  if (type === 'support') return 'support';",
  "  if (type === 'cash' || type === 'sync') return 'operation';\n  if (type === 'support') return 'support';\n  if (type === 'ecommerce') return 'ecommerce';",
  'drawer ecommerce group'
);
replaceRequired(
  'src/components/notifications/NotificationCenterDrawer.jsx',
  '      support: 0,\n      operation: 0,',
  '      support: 0,\n      ecommerce: 0,\n      operation: 0,',
  'drawer ecommerce count'
);

replaceRequired(
  'src/components/notifications/NotificationItem.jsx',
  '  MonitorCog\n} from \'lucide-react\';',
  '  MonitorCog,\n  ShoppingBag\n} from \'lucide-react\';',
  'notification ecommerce icon import'
);
replaceRequired(
  'src/components/notifications/NotificationItem.jsx',
  "import { useNavigate } from 'react-router-dom';\n",
  "import { useNavigate } from 'react-router-dom';\nimport { useAppStore } from '../../store/useAppStore';\n",
  'notification store import'
);
replaceRequired(
  'src/components/notifications/NotificationItem.jsx',
  "  sync: CloudCog,\n  system: MonitorCog",
  "  sync: CloudCog,\n  ecommerce: ShoppingBag,\n  system: MonitorCog",
  'notification ecommerce icon'
);
replaceRequired(
  'src/components/notifications/NotificationItem.jsx',
  "  sync: 'Sincronización',\n  system: 'Sistema'",
  "  sync: 'Sincronización',\n  ecommerce: 'Pedidos online',\n  system: 'Sistema'",
  'notification ecommerce label'
);
replaceRequired(
  'src/components/notifications/NotificationItem.jsx',
  '  const navigate = useNavigate();\n',
  '  const navigate = useNavigate();\n  const closeNotificationCenter = useAppStore((state) => state.closeNotificationCenter);\n',
  'notification close selector'
);
replaceRequired(
  'src/components/notifications/NotificationItem.jsx',
  `  const handleRead = () => {
    if (id) {
      onRead?.(id);
    }

    if (typeof actionRoute === 'string' && actionRoute.startsWith('/')) {
      navigate(actionRoute);
    }
  };`,
  `  const handleRead = async () => {
    if (id) {
      await onRead?.(id);
    }

    if (typeof actionRoute === 'string' && actionRoute.startsWith('/')) {
      if (type === 'ecommerce') closeNotificationCenter?.();
      navigate(actionRoute);
    }
  };`,
  'notification ecommerce action'
);

replaceRequired(
  'src/services/notifications/notificationRealtimeService.js',
  "} from './notificationCapabilities';\n",
  "} from './notificationCapabilities';\nimport { canUseEcommerceOrderRealtime } from '../ecommerce/ecommerceOrderCapabilities';\n",
  'realtime ecommerce capability import'
);
replaceRequired(
  'src/services/notifications/notificationRealtimeService.js',
  `  return (
    isNotificationCenterEnabled(licenseDetails) &&
    isCloudNotificationsEnabled(licenseDetails) &&
    canStaffAccessNotifications(licenseDetails, staffSession) &&
    (isTrue(features.support_realtime) || isTrue(features.realtime_license_sync)) &&
    Boolean(getNotificationRealtimeTopic(licenseDetails))
  );`,
  `  const notificationRealtimeEnabled = (
    isNotificationCenterEnabled(licenseDetails) &&
    isCloudNotificationsEnabled(licenseDetails) &&
    canStaffAccessNotifications(licenseDetails, staffSession) &&
    (isTrue(features.support_realtime) || isTrue(features.realtime_license_sync))
  );
  const ecommerceRealtimeEnabled = canUseEcommerceOrderRealtime(licenseDetails, staffSession);

  return Boolean(getNotificationRealtimeTopic(licenseDetails)) && (
    notificationRealtimeEnabled || ecommerceRealtimeEnabled
  );`,
  'realtime capability'
);
replaceRequired(
  'src/services/notifications/notificationRealtimeService.js',
  `      if (event?.event !== 'notifications_changed') {
        Logger.log('[NotificationRealtime] Evento ignorado.', event?.event || 'unknown');
        return;
      }

      onNotificationEvent?.({
        event: event.event,
        notificationId: event.notification_id || event.notificationId || null,
        ticketId: event.ticket_id || event.ticketId || null,
        reason: event.reason || 'notification_created',
        createdAt: event.created_at || event.createdAt || null,
        metadata: event.metadata || {}
      });`,
  `      const normalizedEvent = {
        event: event.event,
        notificationId: event.notification_id || event.notificationId || null,
        ticketId: event.ticket_id || event.ticketId || null,
        reason: event.reason || 'notification_created',
        createdAt: event.created_at || event.createdAt || null,
        metadata: event.metadata || {}
      };

      if (event?.event === 'ecommerce_orders_changed') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lanzo:ecommerce-orders-changed', { detail: normalizedEvent }));
        }
        return;
      }

      if (event?.event !== 'notifications_changed') {
        Logger.log('[NotificationRealtime] Evento ignorado.', event?.event || 'unknown');
        return;
      }

      if (normalizedEvent.metadata?.category === 'ecommerce' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lanzo:ecommerce-orders-changed', { detail: normalizedEvent }));
      }

      onNotificationEvent?.(normalizedEvent);`,
  'realtime ecommerce event handling'
);

replaceRequired(
  'src/components/layout/Navbar.jsx',
  "import { isCloudPosSyncEnabled } from '../../services/sync/syncConstants';\n",
  "import { isCloudPosSyncEnabled } from '../../services/sync/syncConstants';\nimport { canAccessEcommerceOrders } from '../../services/ecommerce/ecommerceOrderCapabilities';\n",
  'navbar capability import'
);
replaceRequired(
  'src/components/layout/Navbar.jsx',
  '  FolderKey\n} from \'lucide-react\';',
  '  FolderKey,\n  ShoppingBag\n} from \'lucide-react\';',
  'navbar ecommerce icon'
);
replaceRequired(
  'src/components/layout/Navbar.jsx',
  `  const canAccess = useAppStore((state) => state.canAccess);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  useAppStore((state) => state.currentDeviceRole);
  useAppStore((state) => state.currentStaffUser);`,
  `  const canAccess = useAppStore((state) => state.canAccess);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const ecommerceOrderNewCount = useAppStore((state) => state.ecommerceOrderCounts?.new || 0);`,
  'navbar selectors'
);
replaceRequired(
  'src/components/layout/Navbar.jsx',
  `  const location = useLocation();
  const isAboutPage = location.pathname === '/acerca-de';`,
  `  const location = useLocation();
  const isAboutPage = location.pathname === '/acerca-de';
  const canAccessOnlineOrders = canAccessEcommerceOrders(licenseDetails, {
    currentDeviceRole,
    currentStaffUser
  });
  const onlineOrdersBadge = ecommerceOrderNewCount > 99 ? '99+' : String(ecommerceOrderNewCount);`,
  'navbar capability'
);
replaceRequired(
  'src/components/layout/Navbar.jsx',
  `  const drawerLinks = [
    { to: '/clientes', label: 'Clientes', description: 'Directorio, crédito y apartados', icon: <Users size={21} /> },`,
  `  const drawerLinks = [
    ...(canAccessOnlineOrders ? [{
      to: '/pedidos-online',
      label: 'Pedidos online',
      description: 'Pedidos de tu tienda online',
      icon: <ShoppingBag size={21} />,
      badge: ecommerceOrderNewCount > 0 ? onlineOrdersBadge : null
    }] : []),
    { to: '/clientes', label: 'Clientes', description: 'Directorio, crédito y apartados', icon: <Users size={21} /> },`,
  'navbar drawer link'
);
replaceRequired(
  'src/components/layout/Navbar.jsx',
  `                  <span className="drawer-link-label">{link.label}</span>
                  <span className="drawer-link-description">{link.description}</span>`,
  `                  <span className="drawer-link-label">
                    {link.label}
                    {link.badge && <span style={{ marginLeft: 8, borderRadius: 999, padding: '2px 7px', background: 'var(--error-color)', color: '#fff', fontSize: '.72rem' }}>{link.badge}</span>}
                  </span>
                  <span className="drawer-link-description">{link.description}</span>`,
  'navbar drawer badge'
);
replaceRequired(
  'src/components/layout/Navbar.jsx',
  `          <NavLink
            to="/caja"
            className={getDesktopClass}
            onClick={handleProtectedNavClick}
            hidden={!isRouteAllowed('/caja')}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <Inbox size={20} /> Caja
          </NavLink>

          {features.hasKDS && isRouteAllowed('/pedidos') && (`,
  `          <NavLink
            to="/caja"
            className={getDesktopClass}
            onClick={handleProtectedNavClick}
            hidden={!isRouteAllowed('/caja')}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <Inbox size={20} /> Caja
          </NavLink>

          {canAccessOnlineOrders && (
            <NavLink
              to="/pedidos-online"
              className={getDesktopClass}
              onClick={handleProtectedNavClick}
              aria-disabled={isBackupLoading}
              tabIndex={isBackupLoading ? -1 : 0}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><ShoppingBag size={20} /> Pedidos online</span>
              {ecommerceOrderNewCount > 0 && <span style={{ borderRadius: 999, padding: '2px 7px', background: 'var(--error-color)', color: '#fff', fontSize: '.72rem' }}>{onlineOrdersBadge}</span>}
            </NavLink>
          )}

          {features.hasKDS && isRouteAllowed('/pedidos') && (`,
  'navbar desktop link'
);

console.log('ECOM.ORDERS.1 transforms applied');
