// src/components/common/SetupModal.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage } from '../../services/utils';
import LazyImage from './LazyImage';
import TermsAndConditionsModal from './TermsAndConditionsModal';
import { 
  ChevronDown, 
  CheckCircle, 
  Lock, 
  Loader2, 
  Camera, 
  Rocket, 
  Info,
  Utensils,     // Restaurante
  Store,        // Abarrotes
  Pill,         // Farmacia
  Apple,        // Frutería
  Shirt,        // Ropa
  Hammer        // Ferretería
} from 'lucide-react'; 
import './SetupModal.css';
import Logger from '../../services/Logger';
import { fetchLegalTerms, acceptLegalTerms } from '../../services/supabase';

const logoPlaceholder = 'https://placehold.co/100x100/FFFFFF/4A5568?text=L';

// [Modificado] Usamos componentes en lugar de emojis en la propiedad 'icon'
// Nota: Renombramos la propiedad a 'Icon' (Mayúscula) para indicar que es un componente
const BUSINESS_RUBROS = [
  { id: 'food_service', label: 'Restaurante / Cocina', Icon: Utensils },
  { id: 'abarrotes', label: 'Abarrotes / Tienda', Icon: Store },
  { id: 'farmacia', label: 'Farmacia', Icon: Pill },
  { id: 'verduleria/fruteria', label: 'Frutería / Verdulería', Icon: Apple },
  { id: 'apparel', label: 'Ropa / Calzado', Icon: Shirt },
  { id: 'hardware', label: 'Ferretería', Icon: Hammer },
];

export default function SetupModal() {
  const handleSetup = useAppStore((state) => state.handleSetup);
  const licenseDetails = useAppStore((state) => state.licenseDetails);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const [setupError, setSetupError] = useState('');

  useEffect(() => {
    if (!isAllAllowed && allowedRubrosList.length === 1) {
      const rubroForzado = allowedRubrosList[0];
      setSelectedTypes([rubroForzado]);
    }
  }, [licenseDetails]);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [logoData, setLogoData] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('info');

  const licenseFeatures = licenseDetails?.features || {};
  const maxRubrosAllowed = licenseFeatures.max_rubros || 1;
  const allowedRubrosList = licenseFeatures.allowed_rubros || ['*'];
  const isAllAllowed = allowedRubrosList.includes('*');
  const [showTerms, setShowTerms] = useState(false);

  const isStep1Complete = useMemo(() => name.trim().length > 0, [name]);

  const handleSectionToggle = (section) => {
    if (section === 'type' && !isStep1Complete) return; 
    setActiveSection(activeSection === section ? '' : section);
  };

  const handleTypeClick = (value) => {
    setError('');
    
    if (!isAllAllowed && !allowedRubrosList.includes(value)) {
        setError("Tu licencia no incluye acceso a este rubro específico.");
        return;
    }
    
    setSelectedTypes(prev => {
      if (prev.includes(value)) {
        return prev.filter(t => t !== value);
      }
      if (maxRubrosAllowed === 1) {
        return [value];
      }
      if (prev.length < maxRubrosAllowed) {
        return [...prev, value];
      }
      setError(`Tu licencia permite máximo ${maxRubrosAllowed} rubros.`);
      return prev;
    });
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressedFile = await compressImage(file);
        setLogoPreview(URL.createObjectURL(compressedFile));
        setLogoData(compressedFile);
      } catch (error) {
        Logger.error("Error imagen:", error);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (selectedTypes.length === 0) {
      setError('⚠️ Debes seleccionar al menos un rubro.');
      if (activeSection !== 'type') setActiveSection('type');
      return;
    }

    setIsSubmitting(true);
    setError(''); 

    try {
      // --- PASO 1: ACEPTACIÓN DE TÉRMINOS SILENCIOSA ---
      // Obtenemos el ID del término vigente
      const terms = await fetchLegalTerms('terms_of_use');
      
      if (!terms || !terms.id) {
         throw new Error("No se pudieron verificar los términos y condiciones. Revisa tu conexión.");
      }

      // Obtenemos la licencia actual (del store o props)
      const currentLicenseKey = licenseDetails?.license_key; 
      
      if (currentLicenseKey) {
          // Enviamos la aceptación a la BD
          const acceptResult = await acceptLegalTerms(currentLicenseKey, terms.id);
          if (!acceptResult.success && acceptResult.message !== 'ALREADY_ACCEPTED') {
             throw new Error("Error registrando la aceptación de términos.");
          }
      }
      // --------------------------------------------------

      // --- PASO 2: GUARDAR PERFIL (Lógica original) ---
      await handleSetup({
        name,
        phone,
        address,
        logo: logoData,
        business_type: selectedTypes
      });

    } catch (err) {
      Logger.error("Error en setup:", err);
      // Mostrar el error en la UI
      setError(err.message || "Ocurrió un error al procesar. Intenta de nuevo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContinue = (e) => {
    e.preventDefault(); 
    if (isStep1Complete) {
      setActiveSection('type');
    } else {
        const nameInput = document.getElementById('setup-name-input');
        if(nameInput) nameInput.focus();
    }
  };

  return (
    <div id="business-setup-modal" className="modal" style={{ display: 'flex' }}>
      <div className="modal-content setup-content">
        <div className="setup-header">
          <h2>Configura tu Negocio</h2>
          <p>Completa estos pasos para personalizar tu sistema.</p>
        </div>

        <form id="business-setup-form" onSubmit={handleSubmit}>
          
          {/* --- ACORDEÓN 1: INFORMACIÓN --- */}
          <div className={`accordion-item ${activeSection === 'info' ? 'open' : ''} ${isStep1Complete ? 'completed' : ''}`}>
            <div className="accordion-header" onClick={() => !isSubmitting && handleSectionToggle('info')}>
              <div className="header-title">
                <span className="step-number">1</span>
                <span>Información General</span>
              </div>
              <div className="header-status">
                {isStep1Complete && <CheckCircle size={20} className="icon-success" />}
                <ChevronDown size={20} className="icon-chevron" />
              </div>
            </div>

            {activeSection === 'info' && (
              <div className="accordion-body">
                <div className="form-group">
                  <label className="form-label">Nombre del Negocio *</label>
                  <input 
                    id="setup-name-input"
                    className="form-input" 
                    type="text" 
                    required
                    value={name} 
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej: Mi Tiendita" 
                    autoFocus 
                    disabled={isSubmitting}
                  />
                </div>

                <div className="form-row-split">
                  <div className="form-group">
                    <label className="form-label">Teléfono</label>
                    <input className="form-input" type="tel"
                      value={phone} onChange={(e) => setPhone(e.target.value)}
                      placeholder="Ej: 961..." 
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="form-group logo-group">
                    <label className="form-label">Logo</label>
                    <div className="mini-logo-upload">
                        <label htmlFor="logo-upload" className={`logo-preview-wrapper ${isSubmitting ? 'disabled' : ''}`}>
                            <LazyImage src={logoPreview} alt="Logo" />
                            {/* [Modificado] Reemplazo de emoji de cámara por Icono */}
                            {!isSubmitting && (
                              <div className="overlay">
                                <Camera size={24} color="white" />
                              </div>
                            )}
                        </label>
                        <input id="logo-upload" type="file" accept="image/*" 
                            onChange={handleImageChange} style={{display:'none'}} 
                            disabled={isSubmitting}
                        />
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Dirección</label>
                  <textarea className="form-textarea" rows="2"
                    value={address} onChange={(e) => setAddress(e.target.value)}
                    placeholder="Dirección del local..." 
                    disabled={isSubmitting}
                  />
                </div>

                <div className="step-actions">
                  <button 
                    type="button" 
                    className="btn btn-primary btn-next" 
                    onClick={handleContinue}
                    disabled={!isStep1Complete || isSubmitting}
                  >
                    Continuar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* --- ACORDEÓN 2: RUBROS --- */}
          <div className={`accordion-item ${activeSection === 'type' ? 'open' : ''} ${!isStep1Complete ? 'locked' : ''}`}>
            <div className="accordion-header" onClick={() => !isSubmitting && handleSectionToggle('type')}>
              <div className="header-title">
                <span className="step-number">2</span>
                <span>Giro del Negocio</span>
              </div>
              <div className="header-status">
                {!isStep1Complete ? <Lock size={18} className="icon-locked"/> : <ChevronDown size={20} className="icon-chevron" />}
              </div>
            </div>

            {activeSection === 'type' && (
              <div className="accordion-body">
                <p className="rubro-intro">
                  Selecciona a qué se dedica tu empresa. Esto activará funciones especiales.
                </p>

                {maxRubrosAllowed === 1 && (
                  <div className="trial-badge" style={{marginBottom: '10px', fontSize: '0.9rem', color: 'var(--primary-color)', backgroundColor: 'var(--light-background)', padding: '10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px'}}>
                    {/* [Modificado] Reemplazo de emoji info */}
                    <Info size={18} />
                    <span>Tu plan actual permite seleccionar <strong>1 rubro</strong> principal.</span>
                  </div>
                )}

                <div className={`rubro-grid ${isSubmitting ? 'disabled-grid' : ''}`}>
                  {BUSINESS_RUBROS.map(rubro => {
                    const isLockedByLicense = !isAllAllowed && !allowedRubrosList.includes(rubro.id);
                    const isSelected = selectedTypes.includes(rubro.id);
                    // Obtenemos el componente Icon
                    const IconComponent = rubro.Icon;

                    return (
                      <div
                        key={rubro.id}
                        className={`rubro-card ${isSelected ? 'selected' : ''} ${isLockedByLicense ? 'disabled' : ''}`}
                        onClick={() => !isLockedByLicense && !isSubmitting && handleTypeClick(rubro.id)}
                        style={isLockedByLicense || isSubmitting ? { opacity: 0.5, cursor: 'not-allowed', filter: isLockedByLicense ? 'grayscale(1)' : 'none' } : {}}
                        title={isLockedByLicense ? "No incluido en tu licencia" : ""}
                      >
                        {/* [Modificado] Renderizado del componente Icono */}
                        <div className="rubro-icon-wrapper">
                          <IconComponent size={32} strokeWidth={1.5} />
                        </div>
                        <span className="rubro-label">{rubro.label}</span>
                        {isLockedByLicense && <span style={{fontSize:'0.65rem', color:'var(--error-color)', marginTop:'2px'}}>Bloqueado</span>}
                      </div>
                    );
                  })}
                </div>

                {error && <div className="error-message">{error}</div>}

                <div style={{ margin: '15px 0', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
  Al hacer clic en finalizar, aceptas nuestros{' '}
  <span 
    className="terms-link" 
    onClick={() => setShowTerms(true)}
  >
    Términos y Condiciones
  </span>{' '}
  y política de manejo de datos.
</div>

                <div className="step-actions end">
                  <button 
                    type="submit" 
                    className="btn btn-save btn-finish"
                    disabled={isSubmitting} 
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="animate-spin" size={20} />
                        Configurando...
                      </>
                    ) : (
                      // [Modificado] Reemplazo de emoji cohete
                      <>
                        ¡Finalizar y Empezar! 
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

        </form>
      </div>
      <TermsAndConditionsModal 
        isOpen={showTerms} 
        onClose={() => setShowTerms(false)} 
        readOnly={true} 
      />
    </div>
  );
}