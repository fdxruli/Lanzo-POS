// src/components/layout/Navbar.jsx
import React, { useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import Logo from '../common/Logo';
import {
  Store,      // POS / Tienda
  Package,    // Productos
  Menu,       // Botón Menú
  X,          // Cerrar
  Inbox,      // Caja
  Users,      // Clientes
  Settings,   // Configuración
  Info,       // Acerca de
  ChefHat,    // Pedidos KDS
  TrendingUp, // Ventas/Dashboard
  LayoutGrid  // Icono genérico
} from 'lucide-react';
import './Navbar.css';

function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const companyProfile = useAppStore((state) => state.companyProfile);
  const features = useFeatureConfig();
  
  // Obtenemos la ubicación actual para saber en qué página estamos
  const location = useLocation();
  const isAboutPage = location.pathname === '/acerca-de';

  const toggleMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);
  const closeMenu = () => setIsMobileMenuOpen(false);

  // Enlaces que irán en el "Menú Más" (Drawer deslizable)
  const drawerLinks = [
    { to: '/clientes', label: 'Clientes', icon: <Users size={20} /> },
    ...(features.hasKDS ? [{ to: '/pedidos', label: 'Monitor Cocina', icon: <ChefHat size={20} /> }] : []),
    { to: '/configuracion', label: 'Configuración', icon: <Settings size={20} /> },
    { to: '/acerca-de', label: 'Acerca de', icon: <Info size={20} /> },
  ];

  return (
    <>
      {/* ==============================================
          1. BARRA SUPERIOR MÓVIL (Solo Branding)
          OCULTA EN 'ACERCA DE' para evitar redundancia
         ============================================== */}
      {!isAboutPage && (
        <div className="mobile-top-bar">
          <div className="mobile-brand" style={{ width: '100%', justifyContent: 'center' }}>
            <Logo style={{ height: '40px', width: 'auto' }} />
          </div>
        </div>
      )}

      {/* ==============================================
          2. BARRA DE NAVEGACIÓN INFERIOR (App Bar)
         ============================================== */}
      <nav className="mobile-bottom-nav">
        <NavLink to="/caja" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`} onClick={closeMenu}>
          <Inbox size={22} />
          <span>Caja</span>
        </NavLink>

        <NavLink to="/productos" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`} onClick={closeMenu}>
          <Package size={22} />
          <span>Productos</span>
        </NavLink>

        <NavLink to="/" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`} onClick={closeMenu} end>
          <Store size={22} />
          <span>Punto V</span>
        </NavLink>

        <NavLink to="/ventas" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`} onClick={closeMenu}>
          <TrendingUp size={22} />
          <span>Ventas</span>
        </NavLink>

        <button className={`bottom-nav-item ${isMobileMenuOpen ? 'active' : ''}`} onClick={toggleMenu}>
          <Menu size={22} />
          <span>Menú</span>
        </button>
      </nav>

      {/* ==============================================
          3. MENÚ LATERAL DESLIZABLE (DRAWER)
         ============================================== */}
      <div className={`mobile-drawer-overlay ${isMobileMenuOpen ? 'open' : ''}`} onClick={closeMenu}></div>
      <div className={`mobile-drawer ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <h3>Menú Principal</h3>
          <button onClick={closeMenu} className="btn-close-drawer">
            <X size={24} /> 
          </button>
        </div>
        <div className="drawer-links">
          {drawerLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `drawer-link ${isActive ? 'active' : ''}`}
              onClick={closeMenu}
            >
              {link.icon}
              {link.label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* ==============================================
          4. SIDEBAR (SOLO ESCRITORIO PC/LAPTOP)
         ============================================== */}
      <nav className="desktop-sidebar">
        <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Logo
            style={{ width: '100%', height: 'auto', maxHeight: '120px' }}
            vertical={true}
          />
        </div>

        <div className="sidebar-links">
          <NavLink to="/" className="nav-link" end> <Store size={20} /> Punto de Venta</NavLink>
          <NavLink to="/caja" className="nav-link"> <Inbox size={20} /> Caja</NavLink>
          {features.hasKDS && (
            <NavLink to="/pedidos" className="nav-link"> <ChefHat size={20} /> Pedidos-Rest.</NavLink>
          )}
          <NavLink to="/productos" className="nav-link"> <Package size={20} /> Productos</NavLink>
          <NavLink to="/clientes" className="nav-link"> <Users size={20} /> Clientes</NavLink>
          <NavLink to="/ventas" className="nav-link"> <TrendingUp size={20} /> Ventas y Reportes</NavLink>

          <div className="sidebar-divider"></div>

          <NavLink to="/configuracion" className="nav-link"> <Settings size={20} /> Configuración</NavLink>
          <NavLink to="/acerca-de" className="nav-link"> <Info size={20} /> Acerca de</NavLink>
        </div>
      </nav>
    </>
  );
}

export default Navbar;