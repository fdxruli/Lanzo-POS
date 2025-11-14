// src/pages/SettingsPage.jsx
import React, { useState, useEffect } from 'react';
import { loadData, saveData, STORES } from '../services/database';
import { compressImage } from '../services/utils'; // Importamos tu compresor de imágenes
import './SettingsPage.css'

const logoPlaceholder = 'https://placehold.co/100x100/FFFFFF/4A5568?text=L';

const MQL = window.matchMedia('(preders-color-scheme: dark)');

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

  // 1. ESTADO
  // Estado para los campos del formulario
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [businessType, setBusinessType] = useState(''); // Manejo simple
  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [logoData, setLogoData] = useState(null); // La imagen comprimida en base64

  const [activeTheme, setActiveTheme] = useState(getInitialTheme);

  // 2. EFECTO DE CARGA
  // Reemplaza tu lógica 'renderCompanyData'
  useEffect(() => {
    const loadSettings = async () => {
      const companyData = await loadData(STORES.COMPANY, 'company');
      if (companyData) {
        setName(companyData.name || 'Lanzo Negocio');
        setPhone(companyData.phone || '');
        setAddress(companyData.address || '');
        setBusinessType(companyData.business_type || ''); // Carga el tipo de negocio
        setLogoPreview(companyData.logo || logoPlaceholder);
        setLogoData(companyData.logo || null);
      }
    };
    loadSettings();
  }, []); // Se ejecuta 1 vez al cargar la página

  useEffect(() => {
    const systemThemeListener = (e) => {
      if (activeTheme === 'system') {
        // Si el usuario tiene "system" seleccionado, actualizamos al instante
        applyTheme(e.matches ? 'dark' : 'light');
      }
    };

    MQL.addEventListener('change', systemThemeListener);

    return () => {
      MQL.removeEventListener('change', systemThemeListener);
    };
  }, [activeTheme]);

  /**
   * Maneja la subida y compresión del logo
   * Reemplaza tu listener 'companyLogoFileInput'
   */
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

  /**
   * Guarda los datos de la empresa
   * Reemplaza tu 'saveCompanyData'
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const companyData = {
        id: 'company',
        name: name,
        phone: phone,
        address: address,
        business_type: businessType,
        logo: logoData
      };

      await saveData(STORES.COMPANY, companyData);

      // Opcional: Actualizar el Navbar
      // (Por ahora, el Navbar no está conectado a este estado,
      // pero podemos arreglarlo en el Paso 6)

      alert('¡Configuración guardada!'); // Reemplazamos showMessageModal por simplicidad

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

  // 4. VISTA
  // HTML de 'company-section' (sin el theme-form)
  return (
    <>
      <h2 className="section-title">Configuración del Negocio</h2>
      <div className="company-form-container">

        {/* --- Formulario de Empresa --- */}
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

        {/* --- Contenedor de Licencia --- */}
        {/* Como pediste, omitimos el 'theme-form' */}
        <h3 className="subtitle">Licencia del Software</h3>
        <div id="license-info-container" className="license-info">
          {/* La lógica de la licencia (Paso 6) irá aquí */}
          <p>La información de la licencia aparecerá aquí...</p>
        </div>

      </div>
    </>
  );
}