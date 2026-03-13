import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import Logo from '../common/Logo';
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
  RefreshCw
} from 'lucide-react';
import './Navbar.css';

function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const features = useFeatureConfig();

  const updateAvailable = useAppStore((state) => state.updateAvailable);
  const isInstallable = useAppStore((state) => state.isInstallable);
  const isIOS = useAppStore((state) => state.isIOS);
  const isUpdating = useAppStore((state) => state.isUpdating);
  const isInstalling = useAppStore((state) => state.isInstalling);
  const isBackupLoading = useAppStore((state) => state.isBackupLoading);
  const runUpdate = useAppStore((state) => state.runUpdate);
  const requestInstall = useAppStore((state) => state.requestInstall);

  const location = useLocation();
  const isAboutPage = location.pathname === '/acerca-de';

  const toggleMenu = () => setIsMobileMenuOpen((prev) => !prev);
  const closeMenu = () => setIsMobileMenuOpen(false);

  const preventNavigationWhileBackup = (e) => {
    if (!isBackupLoading) return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  };

  const handleProtectedNavClick = (e) => {
    if (preventNavigationWhileBackup(e)) return;
    closeMenu();
  };

  const handleProtectedMenuToggle = (e) => {
    if (preventNavigationWhileBackup(e)) return;
    toggleMenu();
  };

  const drawerLinks = [
    { to: '/clientes', label: 'Clientes', icon: <Users size={20} /> },
    ...(features.hasKDS ? [{ to: '/pedidos', label: 'Monitor Cocina', icon: <ChefHat size={20} /> }] : []),
    { to: '/configuracion', label: 'Configuracion', icon: <Settings size={20} /> },
    { to: '/acerca-de', label: 'Acerca de', icon: <Info size={20} /> }
  ];

  const isSectionFromMenu = drawerLinks.some((link) => location.pathname.startsWith(link.to));
  const hasPwaAction = updateAvailable || isInstallable;
  const installButtonLabel = isIOS ? 'Instalar App (iOS)' : 'Instalar App';

  const getDesktopClass = ({ isActive }) => `nav-link ${isActive ? 'active' : ''} ${isBackupLoading ? 'disabled' : ''}`;
  const getBottomClass = ({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''} ${isBackupLoading ? 'disabled' : ''}`;
  const getDrawerClass = ({ isActive }) => `drawer-link ${isActive ? 'active' : ''} ${isBackupLoading ? 'disabled' : ''}`;

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

  return (
    <>
      {!isAboutPage && (
        <div className="mobile-top-bar">
          <div className="mobile-brand" style={{ width: '100%', justifyContent: 'center' }}>
            <Logo style={{ height: '40px', width: 'auto' }} />
          </div>
        </div>
      )}

      <nav className="mobile-bottom-nav">
        <NavLink
          to="/caja"
          className={getBottomClass}
          onClick={handleProtectedNavClick}
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
          aria-disabled={isBackupLoading}
          tabIndex={isBackupLoading ? -1 : 0}
        >
          <TrendingUp size={22} />
          <span>Ventas</span>
        </NavLink>

        <button
          className={`bottom-nav-item ${isMobileMenuOpen || isSectionFromMenu ? 'active' : ''} ${isBackupLoading ? 'disabled' : ''}`}
          onClick={handleProtectedMenuToggle}
          disabled={isBackupLoading}
        >
          <Menu size={22} />
          <span>Menu</span>
          {hasPwaAction && <span style={menuBadgeStyle} aria-hidden="true" />}
        </button>
      </nav>

      <div className={`mobile-drawer ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <h3>Menu principal</h3>
          <button onClick={closeMenu} className="btn-close-drawer" aria-label="Cerrar menu">
            <X size={20} strokeWidth={2.5} />
          </button>
        </div>

        <div className="drawer-links">
          {drawerLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={getDrawerClass}
              onClick={handleProtectedNavClick}
              aria-disabled={isBackupLoading}
              tabIndex={isBackupLoading ? -1 : 0}
            >
              {link.icon}
              {link.label}
            </NavLink>
          ))}

          {hasPwaAction && (
            <div style={{ gridColumn: '1 / -1', display: 'grid', gap: '10px', marginTop: '4px' }}>
              {updateAvailable && (
                <button
                  onClick={handleUpdateClick}
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
                  onClick={handleInstallClick}
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
      </div>

      <nav className="desktop-sidebar">
        <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Logo style={{ width: '100%', height: 'auto', maxHeight: '120px' }} vertical={true} />
        </div>

        <div className="sidebar-links">
          <NavLink
            to="/"
            className={getDesktopClass}
            end
            onClick={handleProtectedNavClick}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <Store size={20} /> Punto de Venta
          </NavLink>

          <NavLink
            to="/caja"
            className={getDesktopClass}
            onClick={handleProtectedNavClick}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <Inbox size={20} /> Caja
          </NavLink>

          {features.hasKDS && (
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
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <Package size={20} /> Productos
          </NavLink>

          <NavLink
            to="/clientes"
            className={getDesktopClass}
            onClick={handleProtectedNavClick}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <Users size={20} /> Clientes
          </NavLink>

          <NavLink
            to="/ventas"
            className={getDesktopClass}
            onClick={handleProtectedNavClick}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <TrendingUp size={20} /> Ventas y Reportes
          </NavLink>

          {hasPwaAction && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
              {updateAvailable && (
                <button onClick={runUpdate} disabled={isUpdating || isBackupLoading} style={updateButtonStyle} aria-label="Actualizar sistema">
                  <RefreshCw size={16} />
                  {isUpdating ? 'Actualizando...' : 'Actualizar Sistema'}
                </button>
              )}

              {isInstallable && (
                <button
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

          <div className="sidebar-divider" />

          <NavLink
            to="/configuracion"
            className={getDesktopClass}
            onClick={handleProtectedNavClick}
            aria-disabled={isBackupLoading}
            tabIndex={isBackupLoading ? -1 : 0}
          >
            <Settings size={20} /> Configuracion
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
        </div>
      </nav>
    </>
  );
}

export default Navbar;
