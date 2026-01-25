import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage } from '../../services/utils';
import Logger from '../../services/Logger';
import { Lock, Info, FileText } from 'lucide-react';
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

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);
  const [activeTheme, setActiveTheme] = useState(getInitialTheme);
  
  // Estado para detectar si hay un nuevo archivo de logo seleccionado para subir
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

      // Solo actualizamos el estado local si NO hay cambios pendientes (para no sobrescribir lo que escribe el usuario si el store se actualiza en segundo plano)
      // En este caso simple, reiniciamos al cargar el perfil para asegurar sincronía.
      setName(currentName);
      setPhone(currentPhone);
      setAddress(currentAddress);
      setLogoPreview(currentLogo);
      setPendingLogoFile(null); // Limpiamos logo pendiente al cargar datos frescos

      setLockedFields({
        name: !!(currentName && currentName.trim().length > 0),
        phone: !!(currentPhone && currentPhone.trim().length > 0),
        address: !!(currentAddress && currentAddress.trim().length > 0),
        logo: !!(currentLogo && !currentLogo.includes('placehold.co'))
      });
    }
  }, [companyProfile]);

  // DETECTAR CAMBIOS (Lógica del botón dinámico)
  const hasChanges = useMemo(() => {
    if (!companyProfile) return false;
    
    // Comparamos valor actual vs valor guardado
    const savedName = companyProfile.name || '';
    const savedPhone = companyProfile.phone || '';
    const savedAddress = companyProfile.address || '';

    const nameChanged = name.trim() !== savedName;
    const phoneChanged = phone.trim() !== savedPhone;
    const addressChanged = address.trim() !== savedAddress;
    const logoChanged = pendingLogoFile !== null; // Si hay un archivo en cola, hay cambios

    return nameChanged || phoneChanged || addressChanged || logoChanged;
  }, [name, phone, address, pendingLogoFile, companyProfile]);


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
    if (lockedFields.logo) return;

    const file = e.target.files[0];
    if (file) {
      // Solo mostramos preview, NO subimos todavía hasta que den click en Actualizar
      // Opcional: Si quieres subir al instante como antes, mantenlo. 
      // Pero para que el botón "Actualizar" tenga sentido, lo ideal es preparar el cambio.
      // Sin embargo, tu código anterior subía al instante.
      // Para cumplir "solo se muestre cuando detecte... en el logo", vamos a simular el cambio:
      
      try {
        setIsProcessingLogo(true);
        const compressedFile = await compressImage(file);
        const objectURL = URL.createObjectURL(compressedFile);
        
        setLogoPreview(objectURL);      // Mostramos preview
        setPendingLogoFile(compressedFile); // Guardamos para subir al guardar
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
      // Al finalizar, limpiamos el archivo pendiente pues ya se subió
      setPendingLogoFile(null);
    } catch (error) {
      Logger.error(error);
      alert("Error al guardar.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Preparamos actualizaciones
    const updates = { name, phone, address };
    
    // Si hay logo pendiente, lo mandamos (asumiendo que updateCompanyProfile maneja la subida o el store lo hace)
    // Nota: En tu código anterior `handleImageChange` subía directo. 
    // Ahora lo agrupamos. Si tu store espera un objeto File en 'logo', esto funcionará si ajustas el store,
    // o si el store ya maneja la subida en `updateCompanyProfile`.
    // Revisando tu código previo: GeneralSettings.jsx anterior subía directo en onChange.
    // Para que el botón funcione como "Guardar todo junto", enviamos el logo aquí si existe.
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
      {/* HEADER RESPONSIVO: flex-wrap permite que caiga en móvil */}
      <div style={{
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'flex-start', // Alineado arriba para mejor look si se rompe la línea
          flexWrap: 'wrap',         // CLAVE: Permite envolver elementos
          gap: '10px',              // Espacio entre título y span cuando se junten
          marginBottom: '20px'
      }}>
        <h3 className="subtitle" style={{ margin: 0, whiteSpace: 'nowrap' }}>Datos de la Empresa</h3>
        
        {/* Span Informativo */}
        <div style={{
            fontSize: '0.8rem', 
            color: 'var(--text-light)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '5px',
            backgroundColor: 'var(--bg-light)', // Un fondo suave ayuda a diferenciarlo
            padding: '4px 8px',
            borderRadius: '4px',
            maxWidth: '100%' // Asegura que no rompa el layout
        }}>
            <Info size={14} style={{flexShrink: 0}}/> 
            <span>Los datos registrados se bloquearán al guardar. Si requiere actualizar sus datos contacte a soporte</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="company-form">

        <div className="settings-grid">
          {/* 1. Nombre */}
          <div className="form-group" style={{position:'relative'}}>
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
          <div className="form-group" style={{position:'relative'}}>
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
                 <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(255,255,255,0.5)'}}>
                    <Lock size={24} color="#4A5568"/>
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
          <div className="form-group full-width" style={{position:'relative'}}>
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
          {/* Solo mostramos el botón si hay cambios detectados */}
          {hasChanges && (
              <button 
                type="submit" 
                className="btn btn-save animate-fade-in" // animate-fade-in es opcional si tienes la clase
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
        backgroundColor: 'var(--bg-light)', // O 'white' con borde
        border: '1px solid var(--border-color)',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary-color)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
    >
      <div style={{ 
        backgroundColor: '#EBF8FF', // Azul muy claro
        padding: '8px', 
        borderRadius: '50%',
        color: '#3182CE' // Azul
      }}>
        <FileText size={20} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Términos y Condiciones de Uso</span>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Consulta nuestras políticas de manejo de datos y privacidad.</span>
      </div>
    </div>
  </div>

  {/* Renderizar el Modal */}
  <TermsAndConditionsModal 
    isOpen={showTerms} 
    onClose={() => setShowTerms(false)} 
    readOnly={true}
  />
    </div>
  );
}