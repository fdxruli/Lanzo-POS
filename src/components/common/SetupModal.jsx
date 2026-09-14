// src/components/common/SetupModal.jsx
import { useState, useMemo, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage } from '../../services/utils';
import AdminEnrollmentModal from './AdminEnrollmentModal';
import { actorRuntimeController } from '../../services/auth/actorRuntimeController';
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

const normalizeCandidateTypes = (candidate) => {
  const types = candidate?.business_type;
  if (Array.isArray(types)) return types.filter(Boolean);
  if (typeof types === 'string') {
    return types
      .replace(/[{}"]/g, '')
      .split(',')
      .flatMap((item) => {
        const trimmedItem = item.trim();
        return trimmedItem ? [trimmedItem] : [];
      });
  }
  return [];
};

export default function SetupModal() {
  const appStatus = useAppStore((state) => state.appStatus);
  const currentAdminUser = useAppStore((state) => state.currentAdminUser);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const needsOwner = appStatus === 'admin_enrollment_required';
  // App keeps this component mounted across enrollment/setup, keyed by license.
  // Business data stays here in memory; only handleSetup can persist it.
  const [includesOwner] = useState(needsOwner);
  const [enrolling, setEnrolling] = useState(false);
  const handleSetup = useAppStore((state) => state.handleSetup);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const logout = useAppStore((state) => state.logout);
  const profileImportCandidate = useAppStore((state) => state.profileImportCandidate);
  const dismissProfileImportCandidate = useAppStore((state) => state.dismissProfileImportCandidate);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [logoData, setLogoData] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('info');
  const [showTerms, setShowTerms] = useState(false);
  const nameInputRef = useRef(null);

  const licenseFeatures = licenseDetails?.features || {};
  const maxRubrosAllowed = licenseFeatures.max_rubros || 1;
  const allowedRubrosList = useMemo(
    () => licenseFeatures.allowed_rubros || ['*'],
    [licenseFeatures.allowed_rubros]
  );
  const isAllAllowed = allowedRubrosList.includes('*');

  useEffect(() => {
    if (!isAllAllowed && allowedRubrosList.length === 1) {
      const rubroForzado = allowedRubrosList[0];
      setSelectedTypes([rubroForzado]);
    }
  }, [licenseDetails, isAllAllowed, allowedRubrosList]);

  const handleImportCandidate = () => {
    if (!profileImportCandidate) return;

    setName(profileImportCandidate.name || '');
    setPhone(profileImportCandidate.phone || '');
    setAddress(profileImportCandidate.address || '');
    setSelectedTypes(normalizeCandidateTypes(profileImportCandidate));

    if (profileImportCandidate.logo) {
      setLogoPreview(profileImportCandidate.logo);
      setLogoData(profileImportCandidate.logo);
    }

    dismissProfileImportCandidate();
    setActiveSection('info');
  };

  const handleSkipImportCandidate = () => {
    dismissProfileImportCandidate();
    setActiveSection('info');
  };

  const isStep1Complete = useMemo(() => name.trim().length > 0, [name]);
  const isStep2Complete = selectedTypes.length > 0
    && selectedTypes.length <= maxRubrosAllowed
    && selectedTypes.every((type) => isAllAllowed || allowedRubrosList.includes(type));
  const isBusy = isSubmitting || enrolling;

  const handleSectionToggle = (section) => {
    if (section === 'type' && !isStep1Complete) return;
    if (section === 'owner' && (!isStep1Complete || !isStep2Complete)) return;
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

    if (!isStep1Complete || !isStep2Complete) {
      setError('Debes seleccionar al menos un rubro.');
      if (activeSection !== 'type') setActiveSection('type');
      return;
    }
    if (needsOwner || currentDeviceRole !== 'admin' || !currentAdminUser) {
      setError('Inicia sesión como propietario antes de guardar tu negocio.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const actorHandle = actorRuntimeController.capture('settings');
      const terms = await fetchLegalTerms('terms_of_use');
      actorHandle.assertCurrent('settings');

      if (!terms || !terms.id) {
        throw new Error("No se pudieron verificar los términos y condiciones. Revisa tu conexión.");
      }

      const currentLicenseKey = licenseDetails?.license_key;

      if (!currentLicenseKey) {
        throw new Error('No hay una licencia activa para finalizar la configuracion.');
      }

      const acceptResult = await acceptLegalTerms(currentLicenseKey, terms.id);
      if (!acceptResult.success && acceptResult.message !== 'ALREADY_ACCEPTED') {
        const reason = acceptResult.message || acceptResult.error;

        if (reason === 'LICENSE_NOT_FOUND_OR_INACTIVE' || reason === 'DEVICE_NOT_AUTHORIZED') {
          await logout();
          throw new Error(
            'La licencia local ya no existe o este dispositivo no esta autorizado. Ingresa una licencia valida para continuar.'
          );
        }

        if (reason === 'TERM_NOT_FOUND') {
          throw new Error('No se encontro la version actual de terminos. Intenta de nuevo.');
        }

        throw new Error('Error registrando la aceptacion de terminos.');
      }
      actorHandle.assertCurrent('settings');
      if (useAppStore.getState().licenseDetails?.license_key !== currentLicenseKey) {
        throw new Error('La licencia cambió. Vuelve a iniciar la configuración.');
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
      nameInputRef.current?.focus();
    }
  };

  const handleContinueToOwner = () => {
    if (isStep1Complete && isStep2Complete) setActiveSection('owner');
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
              {activeSection === 'owner' && (
                <p className="fade-in-text">
                  Tu cuenta personal identifica quién administra el negocio. Al finalizar guardaremos su configuración.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* LADO DERECHO EN DESKTOP / ABAJO EN MÓVIL */}
        <div className="setup-form-wrapper">
          <div id="business-setup-form">
            <div className="form-inner-container">
              {profileImportCandidate && (
                <div className="profile-import-panel">
                  <div className="profile-import-copy">
                    <strong>Configuracion anterior encontrada</strong>
                    <span>
                      Puedes copiar los datos de {profileImportCandidate.name || 'tu negocio anterior'} a esta licencia.
                      No se guardara nada hasta finalizar la configuracion.
                    </span>
                  </div>
                  <div className="profile-import-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleImportCandidate}
                      disabled={isBusy}
                    >
                      Copiar datos
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleSkipImportCandidate}
                      disabled={isBusy}
                    >
                      Empezar desde cero
                    </button>
                  </div>
                </div>
              )}

              {/* --- ACORDEÓN 1: INFORMACIÓN --- */}
              <div className={`accordion-item ${activeSection === 'info' ? 'open' : ''} ${isStep1Complete ? 'completed' : ''}`}>
                <button type="button" className="accordion-header" disabled={isBusy} aria-expanded={activeSection === 'info'} onClick={() => handleSectionToggle('info')}>
                  <span className="header-title">
                    <span className="step-number">1</span>
                    <span>Tu negocio</span>
                  </span>
                  <span className="header-status">
                    {isStep1Complete && <CheckCircle size={20} className="icon-success" />}
                    <ChevronDown size={20} className="icon-chevron" />
                  </span>
                </button>

                {activeSection === 'info' && (
                  <div className="accordion-body">
                    <div className="form-group">
                      <label className="form-label" htmlFor="setup-name-input">Nombre del Negocio *</label>
                      <input
                        ref={nameInputRef}
                        id="setup-name-input"
                        className="form-input"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ej: Mi Tiendita"
                        autoFocus
                        disabled={isBusy}
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
                          disabled={isBusy}
                        />
                      </div>
                      <div className="form-group logo-group">
                        <label className="form-label text-center" htmlFor="logo-upload">Logo</label>
                        <div className="mini-logo-upload">
                          <label htmlFor="logo-upload" className={`logo-preview-wrapper ${isBusy ? 'disabled' : ''}`}>
                            <LazyImage src={logoPreview} alt="Logo del negocio" />
                            {!isBusy && (
                              <div className="overlay">
                                <Camera size={24} color="white" />
                              </div>
                            )}
                          </label>
                          <input id="logo-upload" type="file" accept="image/*"
                            onChange={handleImageChange} className="hidden-input"
                            disabled={isBusy}
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
                        disabled={isBusy}
                      />
                    </div>

                    <div className="step-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-next"
                        onClick={handleContinue}
                        disabled={!isStep1Complete || isBusy}
                      >
                        Continuar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* --- ACORDEÓN 2: RUBROS --- */}
              <div className={`accordion-item ${activeSection === 'type' ? 'open' : ''} ${!isStep1Complete ? 'locked' : ''} ${isStep2Complete ? 'completed' : ''}`}>
                <button type="button" className="accordion-header" disabled={isBusy || !isStep1Complete} aria-expanded={activeSection === 'type'} onClick={() => handleSectionToggle('type')}>
                  <span className="header-title">
                    <span className="step-number">2</span>
                    <span>Giro del Negocio</span>
                  </span>
                  <span className="header-status">
                    {isStep2Complete && <CheckCircle size={20} className="icon-success" />}
                    {!isStep1Complete ? <Lock size={18} className="icon-locked" /> : <ChevronDown size={20} className="icon-chevron" />}
                  </span>
                </button>

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

                    <div className={`rubro-grid ${isBusy ? 'disabled-grid' : ''}`}>
                      {BUSINESS_RUBROS.map(rubro => {
                        const isLockedByLicense = !isAllAllowed && !allowedRubrosList.includes(rubro.id);
                        const isSelected = selectedTypes.includes(rubro.id);
                        const IconComponent = rubro.Icon;

                        return (
                          <button
                            type="button"
                            disabled={isLockedByLicense || isBusy}
                            aria-pressed={isSelected}
                            key={rubro.id}
                            className={`rubro-card ${isSelected ? 'selected' : ''} ${isLockedByLicense ? 'locked-by-license' : ''} ${isBusy ? 'disabled' : ''}`}
                            onClick={() => !isLockedByLicense && !isBusy && handleTypeClick(rubro.id)}
                            title={isLockedByLicense ? "No incluido en tu licencia" : ""}
                          >
                            <div className="rubro-icon-wrapper">
                              <IconComponent size={32} strokeWidth={1.5} />
                            </div>
                            <span className="rubro-label">{rubro.label}</span>
                            {isLockedByLicense && <span className="locked-badge-text">Bloqueado</span>}
                          </button>
                        );
                      })}
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <div className="step-actions end">
                      <button type="button" className="btn btn-secondary" disabled={isBusy} onClick={() => setActiveSection('info')}>Atrás</button>
                      <button
                        type="button"
                        className="btn btn-primary btn-next"
                        disabled={isBusy || !isStep2Complete}
                        onClick={handleContinueToOwner}
                      >
                        Continuar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className={`accordion-item ${activeSection === 'owner' ? 'open' : ''} ${!isStep1Complete || !isStep2Complete ? 'locked' : ''}`}>
                <button type="button" className="accordion-header" aria-expanded={activeSection === 'owner'} disabled={isBusy || !isStep1Complete || !isStep2Complete} onClick={() => handleSectionToggle('owner')}>
                  <span className="header-title"><span className="step-number">3</span>{includesOwner ? 'Tu acceso como propietario' : 'Finalizar configuración'}</span>
                  <ChevronDown size={20} />
                </button>
                {activeSection === 'owner' && (
                  <div className="accordion-body">
                    {needsOwner && currentDeviceRole !== 'staff' ? (
                      <AdminEnrollmentModal embedded onBusyChange={setEnrolling} />
                    ) : (
                      <form onSubmit={handleSubmit}>
                        <h3>{includesOwner ? '4. Todo listo' : 'Todo listo'}</h3>
                        <p>{includesOwner ? 'Tu acceso como propietario está creado. ' : ''}Guarda la configuración de {name} para entrar a Lanzo.</p>
                        <p className="terms-agreement-text">Al finalizar aceptas nuestros <button type="button" className="terms-link" onClick={() => setShowTerms(true)}>Términos y Condiciones</button> y política de manejo de datos.</p>
                        {error && <div className="error-message" role="alert">{error}</div>}
                        <button type="submit" className="btn btn-save btn-finish" disabled={isBusy || !isStep1Complete || !isStep2Complete || currentDeviceRole !== 'admin' || !currentAdminUser}>
                          {isSubmitting ? <><Loader2 className="animate-spin" size={20} />Guardando...</> : 'Finalizar y Empezar'}
                        </button>
                      </form>
                    )}
                    <div className="step-actions">
                      <button type="button" className="btn btn-secondary" disabled={isBusy} onClick={() => setActiveSection('type')}>Atrás</button>
                    </div>
                  </div>
                )}
              </div>

            </div>
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
