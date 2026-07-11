import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useBackupManager } from '../../hooks/useBackupManager';
import usePersistentStorage from '../../hooks/usePersistentStorage';
import { useBackupRiskStore } from '../../services/BackupRiskEvaluator';
import { canAccessEcommerceOrders } from '../../services/ecommerce/ecommerceOrderCapabilities';
import { isCloudPosSyncEnabled } from '../../services/sync/syncConstants';
import { getBackupRuntimeNotice } from '../../utils/backupRuntimeNotice';
import Logo from '../common/Logo';
import NotificationBell from '../notifications/NotificationBell';
import {
  Store,
  Package,
  Menu,
  X,
  Inbox,
  Users,
  Settings,
  Info,
  ChefHat,
  TrendingUp,
  Download,
  RefreshCw,
  ShieldAlert,
  AlertCircle,
  FolderKey,
  ShoppingBag
} from 'lucide-react';
import './Navbar.css';
import './NavbarEcommerce.css';

function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);
  const features = useFeatureConfig();
  const { status: backupStatus } = useBackupManager();

  const { isVolatile } = usePersistentStorage();
  const isVolatileDismissed = useAppStore((state) => state.isVolatileDismissed);
  const setVolatileDismissed = useAppStore((state) => state.setVolatileDismissed);
  const backupRiskLevel = useBackupRiskStore((state) => state.riskLevel);

  const companyName = useAppStore((state) => state.companyProfile?.name);
  const updateAvailable = useAppStore((state) => state.updateAvailable);
  const isInstallable = useAppStore((state) => state.isInstallable);
  const isIOS = useAppStore((state) => state.isIOS);
  const isUpdating = useAppStore((state) => state.isUpdating);
  const isInstalling = useAppStore((state) => state.isInstalling);
  const isBackupLoading = useAppStore((state) => state.isBackupLoading);
  const runUpdate = useAppStore((state) => state.runUpdate);
  const requestInstall = useAppStore((state) => state.requestInstall);
  const needsDriveReauth = useAppStore((state) => state.needsDriveReauth);
  const dismissedBackupNotice = useAppStore((state) => state.dismissedBackupNotice);
  const showBackupNotice = useAppStore((state) => state.showBackupNotice);
  const canAccess = useAppStore((state) => state.canAccess);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const ecommerceNewCount = useAppStore((state) => state.ecommerceOrderCounts?.new || 0);

  const location = useLocation();
  const isAboutPage = location.pathname === '/acerca-de';
  const canAccessOnlineOrders = canAccessEcommerceOrders(licenseDetails, {
    currentDeviceRole,
    currentStaffUser
  });
  const normalizedEcommerceNewCount = Math.max(Number(ecommerceNewCount) || 0, 0);
  const ecommerceBadge = normalizedEcommerceNewCount > 99
    ? '99+'
    : String(normalizedEcommerceNewCount);

  const toggleMenu = () => setIsMobileMenuOpen((prev) => !prev);
  const closeMenu = () => setIsMobileMenuOpen(false);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobileMenuOpen) return undefined;

    const menuButton = menuButtonRef.current;
    const drawer = drawerRef.current;
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    document.body.classList.add('mobile-menu-open');
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        return;
      }

      if (event.key !== 'Tab' || !drawer) return;

      const focusableElements = [...drawer.querySelectorAll(focusableSelector)];
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (!firstElement || !lastElement) return;

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.classList.remove('mobile-menu-open');
      document.removeEventListener('keydown', handleKeyDown);
      menuButton?.focus();
    };
  }, [isMobileMenuOpen]);

  const preventNavigationWhileBackup = (event) => {
    if (!isBackupLoading) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  const handleProtectedNavClick = (event) => {
    if (preventNavigationWhileBackup(event)) return;
    closeMenu();
  };

  const handleProtectedMenuToggle = (event) => {
    if (preventNavigationWhileBackup(event)) return;
    toggleMenu();
  };

  const drawerLinks = [
    ...(canAccessOnlineOrders ? [{
      to: '/pedidos-online',
      label: 'Pedidos online',
      description: 'Pedidos recibidos desde la tienda',
      icon: <ShoppingBag size={21} />,
      badge: normalizedEcommerceNewCount > 0 ? ecommerceBadge : null
    }] : []),
    {
      to: '/clientes',
      label: 'Clientes',
      description: 'Directorio, crédito y apartados',
      icon: <Users size={21} />
    },
    ...(features.hasKDS ? [{
      to: '/pedidos',
      label: 'Monitor Cocina',
      description: 'Seguimiento de pedidos activos',
      icon: <ChefHat size={21} />
    }] : []),
    {
      to: '/configuracion',
      label: 'Configuración',
      description: 'Preferencias, respaldos y negocio',
      icon: <Settings size={21} />
    },
    {
      to: '/acerca-de',
      label: 'Acerca de',
      description: 'Información y versión de Lanzo',
      icon: <Info size={21} />
    }
  ];

  const routePermissions = {
    '/': 'pos',
    '/caja': 'cash_register',
    '/pedidos': 'orders',
    '/productos': 'products',
    '/clientes': 'customers',
    '/ventas': 'reports',
    // Configuración es la entrada general: requiere admin/settings.
    // license/devices/sync/inventory solo habilitan tabs internos tras entrar.
    '/configuracion': 'settings'
  };
  const isRouteAllowed = (to) => !routePermissions[to] || canAccess(routePermissions[to]);
  const visibleDrawerLinks = drawerLinks.filter((link) => isRouteAllowed(link.to));

  const isSectionFromMenu = visibleDrawerLinks.some((link) => location.pathname.startsWith(link.to));
  const isCloudLicense = isCloudPosSyncEnabled(licenseDetails);
  const showLocalBackupIndicators = !isCloudLicense;
  const effectiveBackupRiskLevel = showLocalBackupIndicators ? backupRiskLevel : 0;
  const backupNotice = showLocalBackupIndicators
    ? getBackupRuntimeNotice(backupStatus, needsDriveReauth)
    : null;
  const hasDismissedBackupNotice = (
    showLocalBackupIndicators &&
    backupNotice?.key === dismissedBackupNotice
  );
  const hasMenuAction = updateAvailable || isInstallable || hasDismissedBackupNotice;
  const installButtonLabel = isIOS ? 'Instalar App (iOS)' : 'Instalar App';

  const getDesktopClass = ({ isActive }) => (
    `nav-link ${isActive ? 'active' : ''} ${isBackupLoading ? 'disabled' : ''}`
  );
  const getBottomClass = ({ isActive }) => (
    `bottom-nav-item ${isActive ? 'active' : ''} ${isBackupLoading ? 'disabled' : ''}`
  );
  const getDrawerClass = ({ isActive }) => (
    `drawer-link ${isActive ? 'active' : ''} ${isBackupLoading ? 'disabled' : ''}`
  );

  const pwaActionBaseStyle = {
    width: '100%',
    justifyContent: 'flex-start',
    border: 'none',
    padding: '12px 14px',
    borderRadius: '10px',
    fontWeight: 700,
    color: '#fff'
  };

  const updateButtonStyle = {
    ...pwaActionBaseStyle,
    backgroundColor: 'var(--error-color)'
  };

  const installButtonStyle = {
    ...pwaActionBaseStyle,
    backgroundColor: 'var(--secondary-color)'
  };

  const backupButtonStyle = {
    ...pwaActionBaseStyle,
    backgroundColor: '#b45309'
  };

  const menuBadgeStyle = {
    position: 'absolute',
    top: '8px',
    right: '20px',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: 'var(--error-color)',
    boxShadow: '0 0 0 2px var(--card-background-color)'
  };

  const handleUpdateClick = async () => {
    await runUpdate();
    closeMenu();
  };

  const handleInstallClick = async () => {
    await requestInstall();
    closeMenu();
  };

  const handleBackupNoticeClick = () => {
    showBackupNotice();
    closeMenu();
  };

  return (
    <>
      {!isAboutPage && (
        <div className="mobile-top-bar">
          <div
            className="mobile-brand"
            style={{ width: '100%', justifyContent: 'center', position: 'relative' }}
          >
            <Logo style={{ height: '40px', width: 'auto' }} />
            <div className="mobile-notification-slot">
              <NotificationBell className="notification-bell--mobile" />
            </div>
          </div>
        </div>
      )}

      <nav className="mobile-bottom-nav">
        <NavLink
          to="/caja"
          className={getBottomClass}
          onClick={handleProtectedNavClick}
          hidden={!isRouteAllowed('/caja')}
          aria-disabled={isBackupLoading}
          tabIndex={isBackupLoading ? -1 : 0}
        >
          <Inbox size={22} />
          <span>Caja</span>
        </NavLink>

        <NavLink
          to="/productos"
          className={getBottomClass}
          onClick={handleProtectedNavClick}
          hidden={!isRouteAllowed('/productos')}
          aria-disabled={isBackupLoading}
          tabIndex={isBackupLoading ? -1 : 0}
        >
          <Package size={22} />
          <span>Productos</span>
        </NavLink>

        <NavLink
          to="/"
          className={getBottomClass}
          onClick={handleProtectedNavClick}
          hidden={!isRouteAllowed('/')}
          aria-disabled={isBackupLoading}
          tabIndex={isBackupLoading ? -1 : 0}
          end
        >
          <Store size={22} />
          <span>Punto V</span>
        </NavLink>

        <NavLink
          to="/ventas"
          className={getBottomClass}
          onClick={handleProtectedNavClick}
          hidden={!isRouteAllowed('/ventas')}
          aria-disabled={isBackupLoading}
          tabIndex={isBackupLoading ? -1 : 0}
        >
          <TrendingUp size={22} />
          <span>Ventas</span>
        </NavLink>

        <button
          ref={menuButtonRef}
          type="button"
          className={`bottom-nav-item ${isMobileMenuOpen || isSectionFromMenu ? 'active' : ''} ${isBackupLoading ? 'disabled' : ''}`}
          onClick={handleProtectedMenuToggle}
          disabled={isBackupLoading}
          aria-expanded={isMobileMenuOpen}
          aria-controls="mobile-main-menu"
          aria-label={isMobileMenuOpen ? 'Cerrar menú principal' : 'Abrir menú principal'}
        >
          {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
          <span>Menú</span>
          {hasMenuAction && <span style={menuBadgeStyle} aria-hidden="true" />}
          {hasMenuAction && (
            <span className="sr-only">Hay acciones pendientes en el menú</span>
          )}
        </button>
      </nav>

      <button
        type="button"
        className={`mobile-drawer-overlay ${isMobileMenuOpen ? 'open' : ''}`}
        onClick={closeMenu}
        aria-hidden="true"
        tabIndex={-1}
      />

      <div
        id="mobile-main-menu"
        ref={drawerRef}
        className={`mobile-drawer ${isMobileMenuOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-menu-title"
        aria-hidden={!isMobileMenuOpen}
        inert={!isMobileMenuOpen}
      >
        <div className="drawer-handle" aria-hidden="true" />
        <div className="drawer-header">
          <div>
            <p className="drawer-eyebrow">Navegación</p>
            <h2 id="mobile-menu-title">Menú principal</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeMenu}
            className="btn-close-drawer"
            aria-label="Cerrar menú"
          >
            <X size={20} strokeWidth={2.5} />
          </button>
        </div>

        <div className="drawer-links">
          {visibleDrawerLinks.map((link) => (
            <div className="drawer-link-row" key={link.to}>
              <NavLink
                to={link.to}
                className={getDrawerClass}
                onClick={handleProtectedNavClick}
                aria-disabled={isBackupLoading}
                tabIndex={isBackupLoading ? -1 : 0}
              >
                <span className="drawer-link-icon">{link.icon}</span>
                <span className="drawer-link-copy">
                  <span className="drawer-link-label">{link.label}</span>
                  <span className="drawer-link-description">{link.description}</span>
                </span>
                {link.badge && (
                  <span
                    className="ecommerce-nav-badge"
                    aria-label={`${link.badge} pedidos nuevos`}
                  >
                    {link.badge}
                  </span>
                )}
                {link.to === '/configuracion' && effectiveBackupRiskLevel === 1 && (
                  <span className="drawer-link-alert" title="Respaldo recomendado">
                    <AlertCircle size={19} />
                    <span className="sr-only">Respaldo recomendado</span>
                  </span>
                )}
              </NavLink>

              {link.to === '/configuracion' &&
                showLocalBackupIndicators &&
                isVolatile &&
                isVolatileDismissed && (
                  <button
                    type="button"
                    className="drawer-warning-action"
                    onClick={() => {
                      setVolatileDismissed(false);
                      closeMenu();
                    }}
                    aria-label="Mostrar aviso de riesgo de pérdida de datos"
                    title="Riesgo de pérdida de datos"
                  >
                    <ShieldAlert size={20} />
                  </button>
                )}
            </div>
          ))}

          {hasMenuAction && (
            <section className="drawer-system-actions" aria-labelledby="drawer-system-title">
              <div className="drawer-section-heading">
                <span id="drawer-system-title">Acciones del sistema</span>
                <span>Pendientes</span>
              </div>

              {hasDismissedBackupNotice && (
                <button
                  type="button"
                  onClick={handleBackupNoticeClick}
                  disabled={isBackupLoading}
                  className="drawer-system-action drawer-system-action--backup"
                  aria-label={backupNotice.navbarLabel}
                >
                  <span className="drawer-system-action-icon">
                    <FolderKey size={18} />
                  </span>
                  {backupNotice.navbarLabel}
                </button>
              )}

              {updateAvailable && (
                <button
                  type="button"
                  onClick={handleUpdateClick}
                  disabled={isUpdating || isBackupLoading}
                  className="drawer-system-action drawer-system-action--update"
                  aria-label="Actualizar sistema"
                >
                  <span className="drawer-system-action-icon">
                    <RefreshCw size={18} />
                  </span>
                  {isUpdating ? 'Actualizando...' : 'Actualizar Sistema'}
                </button>
              )}

              {isInstallable && (
                <button
                  type="button"
                  onClick={handleInstallClick}
                  disabled={isInstalling || isBackupLoading}
                  className="drawer-system-action drawer-system-action--install"
                  aria-label="Instalar app"
                >
                  <span className="drawer-system-action-icon">
                    <Download size={18} />
                  </span>
                  {isInstalling ? 'Instalando...' : installButtonLabel}
                </button>
              )}
            </section>
          )}
        </div>
      </div>

      <nav className="desktop-sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand" title={companyName || 'Tu negocio'}>
            <span className="sidebar-brand-mark">
              <Logo markOnly />
            </span>
            <span className="sidebar-brand-copy">
              <span className="sidebar-brand-product">Lanzo POS</span>
              <strong className="sidebar-business-name">
                {companyName || 'Tu negocio'}
              </strong>
            </span>
          </div>
          <div className="sidebar-notification-slot">
            <NotificationBell className="notification-bell--desktop" />
          </div>
        </div>

        <div className="sidebar-links">
          <NavLink
            to="/"
            className={getDesktopClass}
            end
            onClick={handleProtectedNavClick}
            hidden={!isRouteAllowed('/')}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <Store size={20} /> Punto de Venta
          </NavLink>

          {canAccessOnlineOrders && (
            <NavLink
              to="/pedidos-online"
              className={({ isActive }) => (
                `${getDesktopClass({ isActive })} ecommerce-nav-link`
              )}
              onClick={handleProtectedNavClick}
              aria-disabled={isBackupLoading}
              tabIndex={isBackupLoading ? -1 : 0}
            >
              <ShoppingBag size={20} />
              <span className="ecommerce-nav-link-label">Pedidos online</span>
              {normalizedEcommerceNewCount > 0 && (
                <span
                  className="ecommerce-nav-badge"
                  aria-label={`${ecommerceBadge} pedidos nuevos`}
                >
                  {ecommerceBadge}
                </span>
              )}
            </NavLink>
          )}

          <NavLink
            to="/caja"
            className={getDesktopClass}
            onClick={handleProtectedNavClick}
            hidden={!isRouteAllowed('/caja')}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <Inbox size={20} /> Caja
          </NavLink>

          {features.hasKDS && isRouteAllowed('/pedidos') && (
            <NavLink
              to="/pedidos"
              className={getDesktopClass}
              onClick={handleProtectedNavClick}
              aria-disabled={isBackupLoading}
              tabIndex={isBackupLoading ? -1 : 0}
            >
              <ChefHat size={20} /> Pedidos-Rest.
            </NavLink>
          )}

          <NavLink
            to="/productos"
            className={getDesktopClass}
            onClick={handleProtectedNavClick}
            hidden={!isRouteAllowed('/productos')}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <Package size={20} /> Productos
          </NavLink>

          <NavLink
            to="/clientes"
            className={getDesktopClass}
            onClick={handleProtectedNavClick}
            hidden={!isRouteAllowed('/clientes')}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <Users size={20} /> Clientes
          </NavLink>

          <NavLink
            to="/ventas"
            className={getDesktopClass}
            onClick={handleProtectedNavClick}
            hidden={!isRouteAllowed('/ventas')}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <TrendingUp size={20} /> Ventas y Reportes
          </NavLink>

          <div className="sidebar-divider" />

          <NavLink
            to="/configuracion"
            className={getDesktopClass}
            onClick={handleProtectedNavClick}
            hidden={!isRouteAllowed('/configuracion')}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Settings size={20} /> Configuracion
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {effectiveBackupRiskLevel === 1 && (
                <span
                  title="Respaldo recomendado"
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <AlertCircle size={18} color="#ff4444" />
                </span>
              )}
              {showLocalBackupIndicators && isVolatile && isVolatileDismissed && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    setVolatileDismissed(false);
                  }}
                  title="Riesgo de pérdida de datos"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  <ShieldAlert size={18} color="#d97706" />
                </button>
              )}
            </div>
          </NavLink>

          <NavLink
            to="/acerca-de"
            className={getDesktopClass}
            onClick={handleProtectedNavClick}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <Info size={20} /> Acerca de
          </NavLink>

          {hasMenuAction && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                marginTop: '6px'
              }}
            >
              {hasDismissedBackupNotice && (
                <button
                  type="button"
                  onClick={showBackupNotice}
                  disabled={isBackupLoading}
                  style={backupButtonStyle}
                  aria-label={`${backupNotice.navbarLabel} en barra lateral`}
                >
                  <FolderKey size={16} />
                  {backupNotice.navbarLabel}
                </button>
              )}

              {updateAvailable && (
                <button
                  type="button"
                  onClick={runUpdate}
                  disabled={isUpdating || isBackupLoading}
                  style={updateButtonStyle}
                  aria-label="Actualizar sistema"
                >
                  <RefreshCw size={16} />
                  {isUpdating ? 'Actualizando...' : 'Actualizar Sistema'}
                </button>
              )}

              {isInstallable && (
                <button
                  type="button"
                  onClick={requestInstall}
                  disabled={isInstalling || isBackupLoading}
                  style={installButtonStyle}
                  aria-label="Instalar app"
                >
                  <Download size={16} />
                  {isInstalling ? 'Instalando...' : installButtonLabel}
                </button>
              )}
            </div>
          )}
        </div>
      </nav>
    </>
  );
}

export default Navbar;
