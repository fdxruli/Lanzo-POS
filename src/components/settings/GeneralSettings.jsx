import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage } from '../../services/utils';
import Logger from '../../services/Logger';

const logoPlaceholder = 'https://placehold.co/100x100/FFFFFF/4A5568?text=L';

// Lógica del tema
const MQL = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = (theme) => {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
};
const getInitialTheme = () => localStorage.getItem('theme-preference') || 'system';

export default function GeneralSettings() {
  const companyProfile = useAppStore((state) => state.companyProfile);
  const updateCompanyProfile = useAppStore((state) => state.updateCompanyProfile);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);
  const [activeTheme, setActiveTheme] = useState(getInitialTheme);

  useEffect(() => {
    if (companyProfile) {
      setName(companyProfile.name || 'Lanzo Negocio');
      setPhone(companyProfile.phone || '');
      setAddress(companyProfile.address || '');
      setLogoPreview(companyProfile.logo || logoPlaceholder);
    }
  }, [companyProfile]);

  // Manejo del Tema
  useEffect(() => {
    const systemThemeListener = (e) => {
      if (activeTheme === 'system') applyTheme(e.matches ? 'dark' : 'light');
    };
    MQL.addEventListener('change', systemThemeListener);

    if (activeTheme === 'system') applyTheme(MQL.matches ? 'dark' : 'light');
    else applyTheme(activeTheme);

    return () => MQL.removeEventListener('change', systemThemeListener);
  }, [activeTheme]);

  const handleThemeChange = (e) => {
    const newTheme = e.target.value;
    setActiveTheme(newTheme);
    localStorage.setItem('theme-preference', newTheme);
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      setIsProcessingLogo(true);
      try {
        const compressedFile = await compressImage(file);
        const objectURL = URL.createObjectURL(compressedFile);
        setLogoPreview(objectURL);
        // Guardamos directamente al cambiar la imagen
        await updateProfileWrapper({ logo: compressedFile });
      } catch (error) {
        Logger.error("Error imagen:", error);
      } finally {
        setIsProcessingLogo(false);
      }
    }
  };

  const updateProfileWrapper = async (updates) => {
    try {
      const currentType = companyProfile?.business_type || [];
      const dataToSave = {
        id: 'company',
        name, phone, address,
        business_type: currentType,
        ...updates
      };
      await updateCompanyProfile(dataToSave);
    } catch (error) {
      Logger.error(error);
      alert("Error al guardar.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await updateProfileWrapper({ name, phone, address });
    alert('¡Datos de la empresa actualizados!');
  };

  return (
    <div className="company-form-container">
      <h3 className="subtitle">Datos de la Empresa</h3>

      {/* CAMBIO: Usamos onSubmit en el form y quitamos la estructura antigua */}
      <form onSubmit={handleSubmit} className="company-form">

        {/* GRID CONTAINER: Aquí ocurre la magia responsiva */}
        <div className="settings-grid">

          {/* 1. Nombre */}
          <div className="form-group">
            <label className="form-label">Nombre del Negocio</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Mi Tiendita"
            />
          </div>

          {/* 2. Teléfono */}
          <div className="form-group">
            <label className="form-label">Teléfono / WhatsApp</label>
            <input
              type="tel"
              className="form-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej. 55 1234 5678"
            />
          </div>

          {/* 3. Logo (Columna automática) */}
          <div className="form-group logo-upload-group">
            <label className="form-label">Logo</label>
            <div className="image-upload-wrapper">
              {isProcessingLogo && (
                <div className="spinner-loader small" style={{ position: 'absolute', inset: 0, margin: 'auto' }}></div>
              )}
              <img className="image-preview" src={logoPreview} alt="Logo" />
              {/* Input invisible que cubre todo el cuadro */}
              <input
                className="file-input-hidden"
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                disabled={isProcessingLogo}
              />
            </div>
          </div>

          {/* 4. Dirección (Ocupa todo el ancho en desktop) */}
          <div className="form-group full-width">
            <label className="form-label">Dirección</label>
            <textarea
              className="form-textarea"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows="2"
              placeholder="Calle, número, colonia..."
            ></textarea>
          </div>

        </div>

        {/* Botón Guardar */}
        <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-save" style={{ minWidth: '150px' }}>
            Guardar Cambios
          </button>
        </div>
      </form>

      {/* SECCIÓN APARIENCIA (Mejorada visualmente) */}
      <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
        <h3 className="subtitle">Apariencia</h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-light)', marginBottom: '10px' }}>
          Elige cómo quieres ver la aplicación.
        </p>

        <div className="theme-toggle-container">
          {['light', 'dark', 'system'].map(theme => (
            <label key={theme} className="theme-radio-label">
              <input
                type="radio"
                name="theme"
                value={theme}
                checked={activeTheme === theme}
                onChange={handleThemeChange}
              />
              <span className="theme-radio-text">
                {theme === 'light' ? '☀️ Claro' : theme === 'dark' ? '🌙 Oscuro' : '💻 Sistema'}
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}