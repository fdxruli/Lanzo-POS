import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage, showMessageModal } from '../../services/utils';
import Logger from '../../services/Logger';
import { Lock, Info, FileText, Store, Phone, MapPin, Image as ImageIcon, Sun, Moon, Monitor } from 'lucide-react';
import TermsAndConditionsModal from '../common/TermsAndConditionsModal';

const logoPlaceholder = 'https://placehold.co/100x100/FFFFFF/4A5568?text=L';

function InputStatusIcon({ isLocked }) {
  if (!isLocked) return null;
  return (
    <span title="Bloqueado" className="settings-lock-icon">
      <Lock size={16} />
    </span>
  );
}

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

  const [pendingLogoFile, setPendingLogoFile] = useState(null);

  const [lockedFields, setLockedFields] = useState({
    name: false,
    phone: false,
    address: false,
    logo: false
  });

  const [showTerms, setShowTerms] = useState(false);

  useEffect(() => {
    if (companyProfile) {
      const currentName = companyProfile.name || '';
      const currentPhone = companyProfile.phone || '';
      const currentAddress = companyProfile.address || '';
      const currentLogo = companyProfile.logo || logoPlaceholder;

      setName(currentName);
      setPhone(currentPhone);
      setAddress(currentAddress);
      setLogoPreview(currentLogo);
      setPendingLogoFile(null);

      setLockedFields({
        name: !!(currentName && currentName.trim().length > 0),
        phone: !!(currentPhone && currentPhone.trim().length > 0),
        address: !!(currentAddress && currentAddress.trim().length > 0),
        logo: !!(currentLogo && !currentLogo.includes('placehold.co'))
      });
    }
  }, [companyProfile]);

  const hasChanges = useMemo(() => {
    if (!companyProfile) return false;

    const savedName = companyProfile.name || '';
    const savedPhone = companyProfile.phone || '';
    const savedAddress = companyProfile.address || '';

    const nameChanged = name.trim() !== savedName;
    const phoneChanged = phone.trim() !== savedPhone;
    const addressChanged = address.trim() !== savedAddress;
    const logoChanged = pendingLogoFile !== null;

    return nameChanged || phoneChanged || addressChanged || logoChanged;
  }, [name, phone, address, pendingLogoFile, companyProfile]);


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
    if (lockedFields.logo) return;

    const file = e.target.files[0];
    if (file) {
      try {
        setIsProcessingLogo(true);
        const compressedFile = await compressImage(file);
        const objectURL = URL.createObjectURL(compressedFile);

        setLogoPreview(objectURL);
        setPendingLogoFile(compressedFile);
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
      setPendingLogoFile(null);
    } catch (error) {
      Logger.error(error);
      showMessageModal("Error al guardar.", null, { type: 'error' });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const updates = { name, phone, address };
    if (pendingLogoFile) {
      updates.logo = pendingLogoFile;
    }

    await updateProfileWrapper(updates);
    showMessageModal('¡Datos actualizados correctamente! Los campos nuevos se han bloqueado.');
  };

  return (
    <div className="company-form-container">
      <div className="settings-panel-header">
        <h3 className="subtitle settings-title-inline">Datos de la Empresa</h3>

        <div className="settings-lock-note">
          <Info size={14} className="settings-icon-shrink" />
          <span>Los datos registrados se bloquearán al guardar. Si requiere actualizar sus datos contacte a soporte</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="company-form">

        <div className="settings-grid">
          {/* 1. Nombre */}
          <div className="form-group settings-field-relative">
            <label className="form-label settings-label-icon">
              <Store size={16} /> Nombre del Negocio
            </label>
            <input
              type="text"
              className={`form-input ${lockedFields.name ? 'input-locked' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Mi Tiendita"
              disabled={lockedFields.name}
            />
            <InputStatusIcon isLocked={lockedFields.name} />
          </div>

          {/* 2. Teléfono */}
          <div className="form-group settings-field-relative">
            <label className="form-label settings-label-icon">
              <Phone size={16} /> Teléfono / WhatsApp
            </label>
            <input
              type="tel"
              className={`form-input ${lockedFields.phone ? 'input-locked' : ''}`}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej. 55 1234 5678"
              disabled={lockedFields.phone}
            />
            <InputStatusIcon isLocked={lockedFields.phone} />
          </div>

          {/* 3. Logo */}
          <div className="form-group logo-upload-group">
            <label className="form-label settings-label-icon">
              <ImageIcon size={16} /> Logo
            </label>
            <div className={`image-upload-wrapper ${lockedFields.logo ? 'locked' : ''}`}>

              {isProcessingLogo && (
                <div className="spinner-loader small settings-logo-spinner"></div>
              )}

              <img className="image-preview" src={logoPreview} alt="Logo" />

              {lockedFields.logo && (
                <div className="settings-logo-lock-overlay">
                  <Lock size={24} />
                </div>
              )}

              <input
                className="file-input-hidden"
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                disabled={isProcessingLogo || lockedFields.logo}
              />
            </div>
          </div>

          {/* 4. Dirección */}
          <div className="form-group full-width settings-field-relative">
            <label className="form-label settings-label-icon">
              <MapPin size={16} /> Dirección
            </label>
            <textarea
              className={`form-textarea ${lockedFields.address ? 'input-locked' : ''}`}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows="2"
              placeholder="Calle, número, colonia..."
              disabled={lockedFields.address}
            ></textarea>
            {lockedFields.address && (
              <span title="Bloqueado" className="settings-lock-icon">
                <Lock size={16} />
              </span>
            )}
          </div>
        </div>

        {/* Botón Dinámico */}
        <div className="settings-submit-row">
          {hasChanges && (
            <button
              type="submit"
              className="btn btn-save animate-fade-in settings-submit-button"
            >
              Actualizar datos
            </button>
          )}
        </div>
      </form>

      {/* SECCIÓN APARIENCIA */}
      <div className="settings-subsection">
        <h3 className="subtitle">Apariencia</h3>
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
              {/* Aquí se reemplazaron los Emojis por los Iconos de Lucide */}
              <span className="theme-radio-text settings-label-icon">
                {theme === 'light' ? <><Sun size={16} /> Claro</> : 
                 theme === 'dark' ? <><Moon size={16} /> Oscuro</> : 
                 <><Monitor size={16} /> Sistema</>}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* SECCIÓN LEGAL */}
      <div className="settings-subsection">
        <h3 className="subtitle">Legal y Privacidad</h3>

        <div
          className="settings-option-row settings-option-row--clickable settings-option-row--legal"
          onClick={() => setShowTerms(true)}
        >
          <div className="settings-icon-bubble settings-icon-bubble--info">
            <FileText size={20} />
          </div>
          <div className="settings-option-copy">
            <span className="settings-option-title">Términos y Condiciones de Uso</span>
            <span className="settings-option-meta">Consulta nuestras políticas de manejo de datos y privacidad.</span>
          </div>
        </div>
      </div>

      <TermsAndConditionsModal
        isOpen={showTerms}
        onClose={() => setShowTerms(false)}
        readOnly={true}
      />
    </div>
  );
}
