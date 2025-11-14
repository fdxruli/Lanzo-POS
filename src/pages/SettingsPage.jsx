// src/pages/SettingsPage.jsx
import React, { useState, useEffect } from 'react';
import { loadData, saveData, STORES } from '../services/database';
import { compressImage } from '../services/utils';
import { useAppStore } from '../store/useAppStore'; // 1. Importa el store
import './SettingsPage.css'; // Importa el CSS

const logoPlaceholder = 'https://placehold.co/100x100/FFFFFF/4A5568?text=L';

const MQL = window.matchMedia('(prefers-color-scheme: dark)');

const applyTheme = (theme) => {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
};

const getInitialTheme = () => {
  return localStorage.getItem('theme-preference') || 'system';
};

export default function SettingsPage() {

  // ======================================================
  // ¡AQUÍ ESTÁ LA CORRECCIÓN!
  // Seleccionamos cada valor del store de forma individual.
  // ======================================================
  const companyProfile = useAppStore((state) => state.companyProfile);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const updateCompanyProfile = useAppStore((state) => state.updateCompanyProfile);
  const logout = useAppStore((state) => state.logout);

  // Estado local del formulario
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [logoData, setLogoData] = useState(null);

  const [activeTheme, setActiveTheme] = useState(getInitialTheme);

  // Este useEffect ahora es seguro, porque 'companyProfile'
  // solo cambiará si de verdad cambia en el store.
  useEffect(() => {
    if (companyProfile) {
      setName(companyProfile.name || 'Lanzo Negocio');
      setPhone(companyProfile.phone || '');
      setAddress(companyProfile.address || '');
      setBusinessType(companyArrayToString(companyProfile.business_type) || '');
      setLogoPreview(companyProfile.logo || logoPlaceholder);
      setLogoData(companyProfile.logo || null);
    }
  }, [
    companyProfile?.name,
    companyProfile?.phone,
    companyProfile?.address,
    companyProfile?.business_type,
    companyProfile?.logo
  ]);

  useEffect(() => {
    const systemThemeListener = (e) => {
      if (activeTheme === 'system') {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    };
    MQL.addEventListener('change', systemThemeListener);
    return () => {
      MQL.removeEventListener('change', systemThemeListener);
    };
  }, [activeTheme]);

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressed = await compressImage(file);
        setLogoPreview(compressed);
        setLogoData(compressed);
      } catch (error) {
        console.error("Error al comprimir imagen:", error);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const companyData = {
        id: 'company',
        name: name,
        phone: phone,
        address: address,
        business_type: stringToArray(businessType),
        logo: logoData
      };

      await updateCompanyProfile(companyData);

      alert('¡Configuración guardada!');

    } catch (error) {
      console.error("Error al guardar configuración:", error);
    }
  };

  const handleThemeChange = (e) => {
    const newTheme = e.target.value;
    setActiveTheme(newTheme);
    localStorage.setItem('theme-preference', newTheme);
    if (newTheme === 'system') {
      applyTheme(MQL.matches ? 'dark' : 'light');
    } else {
      applyTheme(newTheme);
    }
  }

  const renderLicenseInfo = () => {
    if (!licenseDetails || !licenseDetails.valid) {
      return <p>No hay una licencia activa.</p>;
    }
    const { license_key, product_name, expires_at } = licenseDetails;
    const statusText = 'Activa y Verificada';

    return (
      <div className="license-info">
        <div className="license-detail">
          <span className="license-label">Clave:</span>
          <span className="license-value">{license_key || 'N/A'}</span>
        </div>
        <div className="license-detail">
          <span className="license-label">Producto:</span>
          <span className="license-value">{product_name || 'N/A'}</span>
        </div>
        <div className="license-detail">
          <span className="license-label">Expira:</span>
          <span className="license-value">{expires_at ? new Date(expires_at).toLocaleDateString() : 'Nunca'}</span>
        </div>
        <div className="license-detail">
          <span className="license-label">Estado:</span>
          <span className="license-status-active">{statusText}</span>
        </div>
        <button
          id="delete-license-btn"
          className="btn btn-cancel"
          style={{ width: 'auto', marginTop: '1rem' }}
          onClick={logout}
        >
          Desactivar en este dispositivo
        </button>
      </div>
    );
  };

  const stringToArray = (str) => (str ? str.split(',').map(s => s.trim()) : []);
  const companyArrayToString = (arr) => (Array.isArray(arr) ? arr.join(', ') : arr);

  return (
    <>
      <h2 className="section-title">Configuración del Negocio</h2>
      <div className="company-form-container">
        <h3 className="subtitle">Datos de la Empresa</h3>
        <form id="company-form" className="company-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="company-name">Nombre del Negocio</label>
            <input
              className="form-input"
              id="company-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="company-phone">Teléfono de Contacto</label>
            <input
              className="form-input"
              id="company-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="company-address">Dirección del Negocio</label>
            <textarea
              className="form-textarea"
              id="company-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            ></textarea>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="business-type">Rubro del Negocio</label>
            <select
              className="form-input"
              id="business-type"
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
            >
              <option value="" disabled>Selecciona un rubro</option>
              <option value="farmacia">Farmacia</option>
              <option value="abarrotes">Abarrotes</option>
              <option value="verduleria/fruteria">Verdulería/Frutería</option>
              <option value="antojitos">Antojitos</option>
              <option value="darkitchen">Dark Kitchen</option>
              <option value="restaurante">Restaurante</option>
              <option value="otro">Otro</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="company-logo-file">Logo del Negocio</label>
            <div className="image-upload-container">
              <img
                id="company-logo-preview"
                className="image-preview"
                src={logoPreview}
                alt="Vista previa del logo"
              />
              <input
                className="file-input"
                id="company-logo-file"
                type="file"
                accept="image/*"
                onChange={handleImageChange}
              />
            </div>
          </div>
          <button type="submit" className="btn btn-save">Guardar Cambios</button>
        </form>

        <h3 className="subtitle">Tema de la Aplicación</h3>
        <div className="theme-toggle-container" role="radiogroup" aria-label="Seleccionar tema">
          <label className="theme-radio-label">
            <input
              type="radio"
              name="theme"
              value="light"
              checked={activeTheme === 'light'}
              onChange={handleThemeChange}
            />
            <span className="theme-radio-text">Claro</span>
          </label>
          <label className="theme-radio-label">
            <input
              type="radio"
              name="theme"
              value="dark"
              checked={activeTheme === 'dark'}
              onChange={handleThemeChange}
            />
            <span className="theme-radio-text">Oscuro</span>
          </label>
          <label className="theme-radio-label">
            <input
              type="radio"
              name="theme"
              value="system"
              checked={activeTheme === 'system'}
              onChange={handleThemeChange}
            />
            <span className="theme-radio-text">Por Defecto</span>
          </label>
        </div>

        <h3 className="subtitle">Licencia del Software</h3>
        {renderLicenseInfo()}
      </div>
    </>
  );
}