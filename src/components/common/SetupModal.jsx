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
  Utensils,
  Store,
  Pill,
  Apple,
  Shirt,
  Hammer
} from 'lucide-react';
import './SetupModal.css';
import Logger from '../../services/Logger';
import { fetchLegalTerms, acceptLegalTerms } from '../../services/supabase';

const logoPlaceholder = 'https://placehold.co/150x150/FFFFFF/4A5568?text=L'; // Aumenté un poco la resolución del placeholder

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

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [logoData, setLogoData] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('info');
  const [showTerms, setShowTerms] = useState(false);

  const licenseFeatures = licenseDetails?.features || {};
  const maxRubrosAllowed = licenseFeatures.max_rubros || 1;
  const allowedRubrosList = licenseFeatures.allowed_rubros || ['*'];
  const isAllAllowed = allowedRubrosList.includes('*');

  useEffect(() => {
    if (!isAllAllowed && allowedRubrosList.length === 1) {
      const rubroForzado = allowedRubrosList[0];
      setSelectedTypes([rubroForzado]);
    }
  }, [licenseDetails, isAllAllowed, allowedRubrosList]);

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
      setError('Debes seleccionar al menos un rubro.');
      if (activeSection !== 'type') setActiveSection('type');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const terms = await fetchLegalTerms('terms_of_use');

      if (!terms || !terms.id) {
        throw new Error("No se pudieron verificar los términos y condiciones. Revisa tu conexión.");
      }

      const currentLicenseKey = licenseDetails?.license_key;

      if (currentLicenseKey) {
        const acceptResult = await acceptLegalTerms(currentLicenseKey, terms.id);
        if (!acceptResult.success && acceptResult.message !== 'ALREADY_ACCEPTED') {
          throw new Error("Error registrando la aceptación de términos.");
        }
      }

      await handleSetup({
        name,
        phone,
        address,
        logo: logoData,
        business_type: selectedTypes
      });

    } catch (err) {
      Logger.error("Error en setup:", err);
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
      if (nameInput) nameInput.focus();
    }
  };

  return (
    <div id="business-setup-modal" className="modal fullscreen-modal">
      <div className="modal-content setup-content">

        {/* LADO IZQUIERDO EN DESKTOP / ARRIBA EN MÓVIL */}
        <div className="setup-header">
          <div className="setup-header-content">
            <div className="setup-header-icon">
              <Rocket className="header-icon-svg" />
            </div>
            <h2>Configura tu Negocio</h2>

            {/* Texto estático para Móvil */}
            <p className="header-text-mobile">
              Completa estos simples pasos para personalizar tu sistema y adaptarlo a tus necesidades operativas. Estamos listos para empezar.
            </p>

            {/* Texto dinámico para Escritorio */}
            <div className="header-text-desktop">
              {activeSection === 'info' && (
                <p className="fade-in-text">
                  Necesitamos tus datos básicos para personalizar tu experiencia y brindarte un soporte técnico eficiente en caso de fallas. <strong>Nota:</strong> Solo el nombre del negocio es obligatorio para continuar.
                </p>
              )}
              {activeSection === 'type' && (
                <p className="fade-in-text">
                  Elige el giro principal de tu operación. Esta selección es vital porque configurará tu entorno, habilitando los módulos y herramientas específicas que realmente necesitas.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* LADO DERECHO EN DESKTOP / ABAJO EN MÓVIL */}
        <div className="setup-form-wrapper">
          <form id="business-setup-form" onSubmit={handleSubmit}>
            <div className="form-inner-container">

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
                      <label className="form-label" htmlFor="setup-name-input">Nombre del Negocio *</label>
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
                      <div className="form-group flex-grow">
                        <label className="form-label" htmlFor="setup-phone-input">Teléfono</label>
                        <input
                          id="setup-phone-input"
                          className="form-input"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="Ej: 961..."
                          disabled={isSubmitting}
                        />
                      </div>
                      <div className="form-group logo-group">
                        <label className="form-label text-center">Logo</label>
                        <div className="mini-logo-upload">
                          <label htmlFor="logo-upload" className={`logo-preview-wrapper ${isSubmitting ? 'disabled' : ''}`}>
                            <LazyImage src={logoPreview} alt="Logo del negocio" />
                            {!isSubmitting && (
                              <div className="overlay">
                                <Camera size={24} color="white" />
                              </div>
                            )}
                          </label>
                          <input id="logo-upload" type="file" accept="image/*"
                            onChange={handleImageChange} className="hidden-input"
                            disabled={isSubmitting}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="setup-address-input">Dirección</label>
                      <textarea
                        id="setup-address-input"
                        className="form-textarea"
                        rows="2"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
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
                    {!isStep1Complete ? <Lock size={18} className="icon-locked" /> : <ChevronDown size={20} className="icon-chevron" />}
                  </div>
                </div>

                {activeSection === 'type' && (
                  <div className="accordion-body">
                    <p className="rubro-intro">
                      Selecciona a qué se dedica tu empresa. Esto activará funciones especiales.
                    </p>

                    {maxRubrosAllowed === 1 && (
                      <div className="trial-badge">
                        <Info size={20} className="trial-badge-icon" />
                        <span>Tu plan actual permite seleccionar <strong>1 rubro</strong> principal.</span>
                      </div>
                    )}

                    <div className={`rubro-grid ${isSubmitting ? 'disabled-grid' : ''}`}>
                      {BUSINESS_RUBROS.map(rubro => {
                        const isLockedByLicense = !isAllAllowed && !allowedRubrosList.includes(rubro.id);
                        const isSelected = selectedTypes.includes(rubro.id);
                        const IconComponent = rubro.Icon;

                        return (
                          <div
                            key={rubro.id}
                            className={`rubro-card ${isSelected ? 'selected' : ''} ${isLockedByLicense ? 'locked-by-license' : ''} ${isSubmitting ? 'disabled' : ''}`}
                            onClick={() => !isLockedByLicense && !isSubmitting && handleTypeClick(rubro.id)}
                            title={isLockedByLicense ? "No incluido en tu licencia" : ""}
                          >
                            <div className="rubro-icon-wrapper">
                              <IconComponent size={32} strokeWidth={1.5} />
                            </div>
                            <span className="rubro-label">{rubro.label}</span>
                            {isLockedByLicense && <span className="locked-badge-text">Bloqueado</span>}
                          </div>
                        );
                      })}
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <div className="terms-agreement-text">
                      Al hacer clic en finalizar, aceptas nuestros{' '}
                      <span className="terms-link" onClick={() => setShowTerms(true)}>
                        Términos y Condiciones
                      </span>{' '}
                      y política de manejo de datos.
                    </div>

                    <div className="step-actions end">
                      <button
                        type="submit"
                        className="btn btn-save btn-finish"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="animate-spin" size={20} />
                            Configurando...
                          </>
                        ) : (
                          <>¡Finalizar y Empezar!</>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </form>
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