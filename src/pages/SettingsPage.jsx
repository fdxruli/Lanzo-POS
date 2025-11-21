// src/pages/SettingsPage.jsx
import React, { useState, useEffect } from 'react';
import { saveData, STORES } from '../services/database';
import { compressImage } from '../services/utils';
import { useAppStore } from '../store/useAppStore';
import DeviceManager from '../components/common/DeviceManager';
import './SettingsPage.css';

const logoPlaceholder = 'https://placehold.co/100x100/FFFFFF/4A5568?text=L';

// 1. Definimos los rubros disponibles (Igual que en SetupModal)
const BUSINESS_RUBROS = [
  { id: 'food_service', label: 'Restaurante / Cocina' },
  { id: 'abarrotes', label: 'Abarrotes' },
  { id: 'farmacia', label: 'Farmacia' },
  { id: 'verduleria/fruteria', label: 'Frutería / Verdulería' },
  { id: 'apparel', label: 'Ropa / Calzado' },
  { id: 'hardware', label: 'Ferretería' },
  { id: 'otro', label: 'Otro' },
];

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
  const companyProfile = useAppStore((state) => state.companyProfile);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const updateCompanyProfile = useAppStore((state) => state.updateCompanyProfile);
  const logout = useAppStore((state) => state.logout);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  // 2. CAMBIO: businessType ahora se inicializa como un array vacío []
  const [businessType, setBusinessType] = useState([]);

  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [logoData, setLogoData] = useState(null);
  const [activeTheme, setActiveTheme] = useState(getInitialTheme);
  const [logoObjectURL, setLogoObjectURL] = useState(null);

  useEffect(() => {
    if (companyProfile) {
      setName(companyProfile.name || 'Lanzo Negocio');
      setPhone(companyProfile.phone || '');
      setAddress(companyProfile.address || '');

      // 3. LÓGICA DE CARGA: Aseguramos que sea un array
      let types = companyProfile.business_type || [];
      // Si viene como string (legado), lo convertimos a array
      if (typeof types === 'string') {
        types = types.split(',').map(s => s.trim());
      }
      setBusinessType(types);

      setLogoPreview(companyProfile.logo || logoPlaceholder);
      setLogoData(companyProfile.logo || null);
    }
  }, [companyProfile]);

  // Cleanup: Revocar Object URLs al desmontar o cambiar
  useEffect(() => {
    return () => {
      if (logoObjectURL) {
        URL.revokeObjectURL(logoObjectURL);
      }
    };
  }, [logoObjectURL]);

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

  // 4. NUEVO HANDLER: Para seleccionar/deseleccionar rubros
  const handleRubroToggle = (rubroId) => {
    setBusinessType(prev => {
      if (prev.includes(rubroId)) {
        return prev.filter(id => id !== rubroId); // Quitar
      } else {
        return [...prev, rubroId]; // Añadir
      }
    });
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        // Revocar el URL anterior si existe
        if (logoObjectURL) {
          URL.revokeObjectURL(logoObjectURL);
        }

        const compressedFile = await compressImage(file);
        const objectURL = URL.createObjectURL(compressedFile);
        setLogoObjectURL(objectURL);
        setLogoPreview(objectURL);
        setLogoData(compressedFile);
      } catch (error) {
        console.error("Error al comprimir imagen:", error);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // ESTANDARIZACIÓN: Aquí construimos el objeto con el formato interno de la App ('name')
      const companyData = {
        id: 'company',
        name: name,           // Usamos la variable de estado del input
        phone: phone,         // Usamos la variable de estado del input
        address: address,     // Usamos la variable de estado del input
        logo: logoData,       // El archivo o URL
        business_type: businessType // Array de rubros
      };

      // Enviamos 'name'. El Store o el Servicio se encargarán de traducirlo si es necesario.
      await updateCompanyProfile(companyData);

      alert('¡Configuración guardada! Los formularios se han actualizado.');

    } catch (error) {
      console.error("Error al guardar configuración:", error);
      alert('Hubo un error al guardar.'); // Feedback visual simple
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
    const { license_key, product_name, expires_at, max_devices } = licenseDetails;
    const statusText = 'Activa y Verificada';

    return (
      <div className="license-info-container">
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
          <div className="license-detail">
            <span className="license-label">Límite de Dispositivos:</span>
            <span className="license-value">{max_devices || 'N/A'}</span>
          </div>
        </div>

        <h4 className="device-manager-title">Dispositivos Activados</h4>
        <DeviceManager licenseKey={license_key} />

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
              disabled
            />
            <small className="form-help-text">
              Para cambiar el nombre, contacta a soporte.
            </small>
          </div>

          {/* ... (Teléfono y Dirección sin cambios) ... */}
          <div className="form-group">
            <label className="form-label" htmlFor="company-phone">Teléfono de Contacto</label>
            <input
              className="form-input"
              id="company-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled
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

          {/* 6. NUEVA UI: Selector de Rubros (Grid) */}
          <div className="form-group">
            <label className="form-label">Rubros del Negocio (Selecciona múltiples)</label>
            <div className="rubro-selector-grid">
              {BUSINESS_RUBROS.map(rubro => (
                <div
                  key={rubro.id}
                  className={`rubro-box ${businessType.includes(rubro.id) ? 'selected' : ''}`}
                  onClick={() => handleRubroToggle(rubro.id)}
                >
                  {rubro.label}
                </div>
              ))}
            </div>
            <small className="form-help-text">
              Esto adaptará los formularios de productos a tus necesidades.
            </small>
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
          {/* ... (Selector de tema sin cambios) ... */}
          <label className="theme-radio-label">
            <input type="radio" name="theme" value="light" checked={activeTheme === 'light'} onChange={handleThemeChange} />
            <span className="theme-radio-text">Claro</span>
          </label>
          <label className="theme-radio-label">
            <input type="radio" name="theme" value="dark" checked={activeTheme === 'dark'} onChange={handleThemeChange} />
            <span className="theme-radio-text">Oscuro</span>
          </label>
          <label className="theme-radio-label">
            <input type="radio" name="theme" value="system" checked={activeTheme === 'system'} onChange={handleThemeChange} />
            <span className="theme-radio-text">Por Defecto</span>
          </label>
        </div>

        <h3 className="subtitle">Licencia del Software</h3>
        {renderLicenseInfo()}
      </div>
    </>
  );
}