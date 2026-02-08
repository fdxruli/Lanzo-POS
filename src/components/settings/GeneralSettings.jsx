import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage } from '../../services/utils';
import Logger from '../../services/Logger';
// CORRECCIÓN 1: 'FileText' estaba escrito como 'FileTex'
import { Lock, Info, FileText, Bot } from 'lucide-react';
import TermsAndConditionsModal from '../common/TermsAndConditionsModal';

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

  const showAssistantBot = useAppStore((state) => state.showAssistantBot);
  const setShowAssistantBot = useAppStore((state) => state.setShowAssistantBot);

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
      alert("Error al guardar.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const updates = { name, phone, address };
    if (pendingLogoFile) {
      updates.logo = pendingLogoFile;
    }

    await updateProfileWrapper(updates);
    alert('¡Datos actualizados correctamente! Los campos nuevos se han bloqueado.');
  };

  const InputStatusIcon = ({ isLocked }) => {
    if (!isLocked) return null;
    return (
      <span title="Bloqueado" style={{ position: 'absolute', right: '10px', top: '38px', color: '#718096' }}>
        <Lock size={16} />
      </span>
    );
  };

  return (
    <div className="company-form-container">
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: '10px',
        marginBottom: '20px'
      }}>
        <h3 className="subtitle" style={{ margin: 0, whiteSpace: 'nowrap' }}>Datos de la Empresa</h3>

        <div style={{
          fontSize: '0.8rem',
          color: 'var(--text-light)',
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          backgroundColor: 'var(--bg-light)',
          padding: '4px 8px',
          borderRadius: '4px',
          maxWidth: '100%'
        }}>
          <Info size={14} style={{ flexShrink: 0 }} />
          <span>Los datos registrados se bloquearán al guardar. Si requiere actualizar sus datos contacte a soporte</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="company-form">

        <div className="settings-grid">
          {/* 1. Nombre */}
          <div className="form-group" style={{ position: 'relative' }}>
            <label className="form-label">Nombre del Negocio</label>
            <input
              type="text"
              className={`form-input ${lockedFields.name ? 'input-locked' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Mi Tiendita"
              disabled={lockedFields.name}
              style={lockedFields.name ? { backgroundColor: '#f7fafc', cursor: 'not-allowed', color: '#718096' } : {}}
            />
            <InputStatusIcon isLocked={lockedFields.name} />
          </div>

          {/* 2. Teléfono */}
          <div className="form-group" style={{ position: 'relative' }}>
            <label className="form-label">Teléfono / WhatsApp</label>
            <input
              type="tel"
              className={`form-input ${lockedFields.phone ? 'input-locked' : ''}`}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej. 55 1234 5678"
              disabled={lockedFields.phone}
              style={lockedFields.phone ? { backgroundColor: '#f7fafc', cursor: 'not-allowed', color: '#718096' } : {}}
            />
            <InputStatusIcon isLocked={lockedFields.phone} />
          </div>

          {/* 3. Logo */}
          <div className="form-group logo-upload-group">
            <label className="form-label">Logo</label>
            <div className={`image-upload-wrapper ${lockedFields.logo ? 'locked' : ''}`}
              style={lockedFields.logo ? { opacity: 0.7, cursor: 'not-allowed' } : {}}>

              {isProcessingLogo && (
                <div className="spinner-loader small" style={{ position: 'absolute', inset: 0, margin: 'auto' }}></div>
              )}

              <img className="image-preview" src={logoPreview} alt="Logo" />

              {lockedFields.logo && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.5)' }}>
                  <Lock size={24} color="#4A5568" />
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
          <div className="form-group full-width" style={{ position: 'relative' }}>
            <label className="form-label">Dirección</label>
            <textarea
              className={`form-textarea ${lockedFields.address ? 'input-locked' : ''}`}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows="2"
              placeholder="Calle, número, colonia..."
              disabled={lockedFields.address}
              style={lockedFields.address ? { backgroundColor: '#f7fafc', cursor: 'not-allowed', color: '#718096' } : {}}
            ></textarea>
            {lockedFields.address && (
              <span title="Bloqueado" style={{ position: 'absolute', right: '10px', top: '38px', color: '#718096' }}>
                <Lock size={16} />
              </span>
            )}
          </div>
        </div>

        {/* Botón Dinámico */}
        <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', height: '40px' }}>
          {hasChanges && (
            <button
              type="submit"
              className="btn btn-save animate-fade-in"
              style={{ minWidth: '150px' }}
            >
              Actualizar datos
            </button>
          )}
        </div>
      </form>

      {/* SECCIÓN APARIENCIA */}
      <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
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
              <span className="theme-radio-text">
                {theme === 'light' ? '☀️ Claro' : theme === 'dark' ? '🌙 Oscuro' : '💻 Sistema'}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* SECCIÓN ASISTENTE VIRTUAL */}
      <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
        <h3 className="subtitle">Asistente Virtual</h3>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px',
          backgroundColor: 'var(--bg-light)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              backgroundColor: showAssistantBot ? '#EBF8FF' : '#EDF2F7',
              padding: '8px',
              borderRadius: '50%',
              color: showAssistantBot ? '#3182CE' : '#A0AEC0',
              transition: 'all 0.3s ease'
            }}>
              <Bot size={24} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Lanzo Bot (experimental)</span>
              <p>Estamos enseñando a nuestro BOT a ser mejor. <br/>Mientras puedes utilizarlo pero revisa los movimientos</p>
              <br />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {showAssistantBot ? 'El asistente está activo y te dará sugerencias.' : 'El asistente está desactivado.'}
              </span>
            </div>
          </div>

          {/* Toggle Switch Personalizado - CORREGIDO */}
          <label style={{
            position: 'relative',
            display: 'inline-block',
            width: '50px',
            height: '26px',
            cursor: 'pointer',
            flexShrink: 0, /* IMPORTANTE: Esto evita que el switch se aplaste y la bolita se salga */
            userSelect: 'none'
          }}>
            <input
              type="checkbox"
              checked={!!showAssistantBot}
              onChange={(e) => setShowAssistantBot(e.target.checked)}
              /* Añadido position: absolute para asegurar que el input no ocupe espacio fantasma */
              style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
            />

            {/* Fondo (Píldora) */}
            <span style={{
              position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: showAssistantBot ? 'var(--primary-color)' : '#CBD5E0',
              transition: 'background-color .4s',
              borderRadius: '34px'
            }}></span>

            {/* Bolita (Knob) */}
            <span style={{
              position: 'absolute', content: '""', height: '20px', width: '20px',
              /* Ajuste de simetría: 3px de margen en todos los lados (Arriba, Abajo, Izquierda) */
              left: '3px',
              bottom: '3px',
              backgroundColor: 'white',
              transition: 'transform .4s', /* Usamos transform para un movimiento más suave */
              borderRadius: '50%',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              /* MATEMÁTICA DEL MOVIMIENTO: 
                 Ancho Contenedor (50px) - Ancho Bolita (20px) - Margen Izq (3px) - Margen Der (3px) = 24px de viaje 
              */
              transform: showAssistantBot ? 'translateX(24px)' : 'translateX(0)'
            }}></span>
          </label>
        </div>
      </div>

      {/* SECCIÓN LEGAL */}
      <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
        <h3 className="subtitle">Legal y Privacidad</h3>

        <div
          onClick={() => setShowTerms(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-light)',
            border: '1px solid var(--border-color)',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary-color)'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
        >
          <div style={{
            backgroundColor: '#EBF8FF',
            padding: '8px',
            borderRadius: '50%',
            color: '#3182CE'
          }}>
            {/* Usamos el icono importado correctamente */}
            <FileText size={20} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Términos y Condiciones de Uso</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Consulta nuestras políticas de manejo de datos y privacidad.</span>
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