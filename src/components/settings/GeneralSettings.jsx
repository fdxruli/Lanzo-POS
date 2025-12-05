import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage } from '../../services/utils';

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
        console.error("Error imagen:", error);
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
      console.error(error);
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
      <h3 className="subtitle">Identidad del Negocio</h3>
      <form onSubmit={handleSubmit} className="company-form">
        <div className="form-group">
          <label className="form-label">Nombre del Negocio</label>
          <input className="form-input" type="text" value={name} onChange={(e) => setName(e.target.value)} disabled />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="form-group">
                <label className="form-label">Teléfono</label>
                <input className="form-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled />
                <small className="form-help-text">Para cambiar el nombre y/o numero, contacta a soporte.</small>
            </div>
            
            <div className="form-group">
                <label className="form-label">Logo</label>
                <div className="image-upload-container" style={{ position: 'relative' }}>
                    {isProcessingLogo && <div className="spinner-loader small" style={{position:'absolute'}}></div>}
                    <img className="image-preview" src={logoPreview} alt="Logo" style={{ width: '60px', height: '60px' }} />
                    <input className="file-input" type="file" accept="image/*" onChange={handleImageChange} disabled={isProcessingLogo} />
                </div>
            </div>
        </div>

        <div className="form-group">
          <label className="form-label">Dirección</label>
          <textarea className="form-textarea" value={address} onChange={(e) => setAddress(e.target.value)} rows="2"></textarea>
        </div>

        <button type="submit" className="btn btn-save">Guardar Cambios</button>
      </form>

      <h3 className="subtitle" style={{ marginTop: '2rem' }}>Apariencia</h3>
      <div className="theme-toggle-container">
        {['light', 'dark', 'system'].map(theme => (
            <label key={theme} className="theme-radio-label">
                <input type="radio" name="theme" value={theme} checked={activeTheme === theme} onChange={handleThemeChange} />
                <span className="theme-radio-text">
                    {theme === 'light' ? '☀️ Claro' : theme === 'dark' ? '🌙 Oscuro' : '💻 Sistema'}
                </span>
            </label>
        ))}
      </div>
    </div>
  );
}