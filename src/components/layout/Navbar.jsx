// src/components/layout/Navbar.jsx
import React, { useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
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
  TrendingUp
} from 'lucide-react';
import './Navbar.css';

function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const companyProfile = useAppStore((state) => state.companyProfile);
  const features = useFeatureConfig();
  const location = useLocation();

  const toggleMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);
  const closeMenu = () => setIsMobileMenuOpen(false);

  // Enlaces del Menú Desplegable ("Más")
  const drawerLinks = [
    { to: '/clientes', label: 'Clientes', icon: <Users size={20} /> },
    ...(features.hasKDS ? [{ to: '/pedidos', label: 'Pedidos KDS', icon: <ChefHat size={20} /> }] : []),
    { to: '/configuracion', label: 'Configuración', icon: <Settings size={20} /> },
    { to: '/acerca-de', label: 'Acerca de', icon: <Info size={20} /> },
  ];

  return (
    <>
      {/* 1. BARRA SUPERIOR MÓVIL (Solo Logo, SIN botón de menú) */}
      <div className="mobile-top-bar">
        <div className="mobile-brand">
          <Logo style={{ height: '30px', width: 'auto' }} />
          <span className="brand-name">{companyProfile?.name || 'Lanzo'}</span>
        </div>
        {/* ¡Aquí NO debe haber ningún botón! */}
      </div>

      {/* 2. BARRA INFERIOR FLOTANTE (Aquí están los botones ahora) */}
      <nav className="mobile-bottom-nav">
        <NavLink to="/caja" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`} onClick={closeMenu}>
          <Inbox size={22} />
          <span>Caja</span>
        </NavLink>

        <NavLink to="/productos" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`} onClick={closeMenu}>
          <Package size={22} />
          <span>Prod.</span>
        </NavLink>

        {/* Botón Central POS */}
        <div className="bottom-nav-center">
          <Link to="/" className="fab-pos-button" onClick={closeMenu}>
            <Store size={28} strokeWidth={2.5} />
          </Link>
        </div>

        <NavLink to="/ventas" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`} onClick={closeMenu}>
          <TrendingUp size={22} />
          <span>Ventas</span>
        </NavLink>

        {/* Botón Menú (Abre el drawer) */}
        <button className={`bottom-nav-item ${isMobileMenuOpen ? 'active' : ''}`} onClick={toggleMenu}>
          <Menu size={22} />
          <span>Menú</span>
        </button>
      </nav>

      {/* 3. DRAWER (Menú desplegable) */}
      <div className={`mobile-drawer-overlay ${isMobileMenuOpen ? 'open' : ''}`} onClick={closeMenu}></div>
      <div className={`mobile-drawer ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <h3>Menú Principal</h3>
          <button onClick={closeMenu} className="btn-close-drawer"><X /></button>
        </div>
        <div className="drawer-links">
          {drawerLinks.map((link) => (
            <NavLink key={link.to} to={link.to} className="drawer-link" onClick={closeMenu}>
              {link.icon} {link.label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* 4. SIDEBAR ESCRITORIO (Solo visible en PC) */}
      <nav className="desktop-sidebar">
        <div className="sidebar-header">
          <Logo />
          <h1 className="nav-title">{companyProfile?.name || 'Lanzo'}</h1>
        </div>
        <div className="sidebar-links">
          <NavLink to="/" className="nav-link" end><Store size={20} /> Punto de Venta</NavLink>
          <NavLink to="/caja" className="nav-link"><Inbox size={20} /> Caja</NavLink>
          <NavLink to="/productos" className="nav-link"><Package size={20} /> Productos</NavLink>
          <NavLink to="/ventas" className="nav-link"><TrendingUp size={20} /> Ventas</NavLink>
          <NavLink to="/clientes" className="nav-link"><Users size={20} /> Clientes</NavLink>
          <div className="sidebar-divider"></div>
          <NavLink to="/configuracion" className="nav-link"><Settings size={20} /> Configuración</NavLink>
        </div>
      </nav>
    </>
  );
}

export default Navbar;