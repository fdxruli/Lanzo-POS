import React, { useState, useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import './Navbar.css';

// Importamos el logo desde la carpeta public
// (Asegúrate de que tus íconos estén en /public/)
const logoPlaceholder = '/icono.png'; 

function Navbar() {
  // 1. Lógica del menú móvil (de app.js) movida a React
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const companyProfile = useAppStore((state) => state.companyProfile);

  const toggleMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const companyLogo = companyProfile?.logo || logoPlaceholder;
  const companyName = companyProfile?.name || 'Lanzo';

  // 3. Convertimos el HTML de index.html a JSX
  return (
    <>
      <nav className="navbar">
        <div className="nav-container">
          {/* El logo ahora es un <Link> de React Router
            que te lleva a la página principal.
          */}
          <Link to="/" className="nav-logo-container">
            <img
              id="nav-company-logo"
              className="nav-logo"
              src={companyLogo}
              alt="Logo de Lanzo POS"
            />
            <h1 id="nav-company-name" className="nav-title">
              {companyName}
            </h1>
          </Link>

          {/* ¡La magia de React Router!
            Usamos <NavLink> en lugar de <button>.
            - `to` define la ruta.
            - `className={({ isActive }) => ...}` reemplaza
              automáticamente tu lógica de `link.classList.toggle('active')`.
          */}
          <div
            id="main-nav-links"
            className={`nav-links ${isMobileMenuOpen ? 'open' : ''}`}
            onClick={isMobileMenuOpen ? toggleMenu : undefined} // Cierra al hacer clic en un enlace
          >
            <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>
              Punto de Venta
            </NavLink>
            <NavLink to="/caja" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Caja
            </NavLink>
            <NavLink to="/productos" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Productos
            </NavLink>
            <NavLink to="/clientes" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Clientes
            </NavLink>
            <NavLink to="/ventas" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Ventas
            </NavLink>
            <NavLink to="/configuracion" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Configuración
            </NavLink>
            <NavLink to="/acerca-de" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Acerca de
            </NavLink>
          </div>

          {/* El botón de hamburguesa ahora usa el estado de React */}
          <div className="nav-mobile-toggle">
            <button
              id="mobile-menu-button"
              className="mobile-menu-btn"
              aria-label="Abrir menú móvil"
              onClick={toggleMenu}
            >
              <svg className="mobile-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round" // Nota el cambio a camelCase
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 6h16M4 12h16m-7 6h7"
                />
              </svg>
            </button>
          </div>
        </div>
        
        {/* El fondo oscuro también usa el estado de React */}
        <div
          id="backdrop"
          className={`backdrop ${isMobileMenuOpen ? 'open' : ''}`}
          onClick={toggleMenu}
        ></div>
      </nav>
    </>
  );
}

export default Navbar;