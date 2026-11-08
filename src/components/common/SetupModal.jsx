// src/components/common/SetupModal.jsx
import { useState, useMemo, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage } from '../../services/utils';
import AdminEnrollmentModal from './AdminEnrollmentModal';
import { actorRuntimeController } from '../../services/auth/actorRuntimeController';
import LazyImage from './LazyImage';
import TermsAndConditionsModal, { LEGAL_DOCUMENT_TYPES } from './TermsAndConditionsModal';
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
import PreloginSupportAccess from './PreloginSupportAccess';
import './SetupModal.css';
import Logger from '../../services/Logger';
import { fetchLegalTerms, acceptLegalTerms, fetchLegalPolicyState } from '../../services/supabase';

const logoPlaceholder = 'https://placehold.co/150x150/FFFFFF/4A5568?text=L';

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
  const [logoUploadSource, setLogoUploadSource] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('info');
  const [showTerms, setShowTerms] = useState(false);
  const [legalDocuments, setLegalDocuments] = useState([]);
  const [legalLoading, setLegalLoading] = useState(false);
  const [legalLoadAttempt, setLegalLoadAttempt] = useState(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (activeSection !== 'complete') return;
    let cancelled = false;
    setLegalLoading(true);
    Promise.all(LEGAL_DOCUMENT_TYPES.map(async (document) => ({
      ...document, data: await fetchLegalTerms(document.fetchType)
    }))).then((documents) => {
      if (cancelled) return;
      setLegalDocuments(documents);
      if (documents.some(({ data }) => !data?.id || !data?.version)) {
        setError('No se pudieron cargar todos los documentos legales. Revisa tu conexión y reintenta.');
      }
    }).catch(() => {
      if (!cancelled) setError('No se pudieron cargar los documentos legales. Reintenta.');
    }).finally(() => { if (!cancelled) setLegalLoading(false); });
    return () => { cancelled = true; };
  }, [activeSection, legalLoadAttempt]);
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
  const isOwnerComplete = currentDeviceRole === 'admin' && Boolean(currentAdminUser);
  const isBusy = isSubmitting || enrolling;
  const selectedRubroLabels = selectedTypes
    .map((type) => BUSINESS_RUBROS.find((rubro) => rubro.id === type)?.label || type)
    .join(', ');

  const handleSectionToggle = (section) => {
    if (section === 'type' && !isStep1Complete) return;
    if (section === 'owner' && (!isStep1Complete || !isStep2Complete)) return;
    if (section === 'complete' && (!isStep1Complete || !isStep2Complete || !isOwnerComplete)) return;
    setActiveSection(activeSection === section ? '' : section);
  };

  const handleTypeClick = (value) => {
    setError('');

    if (!isAllAllowed && !allowedRubrosList.includes(value)) {
      setError('Tu licencia no incluye acceso a este rubro específico.');
      return;
    }

    setSelectedTypes((prev) => {
      if (prev.includes(value)) {
        return prev.filter((type) => type !== value);
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
        setLogoUploadSource(file);
      } catch (imageError) {
        Logger.error('Error imagen:', imageError);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;

    if (!isStep1Complete || !isStep2Complete) {
      setError('Debes seleccionar al menos un rubro.');
      if (activeSection !== 'type') setActiveSection('type');
      return;
    }
    if (currentDeviceRole !== 'admin' || !currentAdminUser) {
      setError('Inicia sesión como propietario antes de guardar tu negocio.');
      return;
    }

    if (legalLoading || legalDocuments.length !== LEGAL_DOCUMENT_TYPES.length
      || legalDocuments.some(({ data }) => !data?.id || !data?.version)) {
      setError('Espera a que se verifiquen los documentos legales o reintenta su carga.');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setError('');

    try {
      const actorHandle = actorRuntimeController.capture('settings');
      const documents = await Promise.all(LEGAL_DOCUMENT_TYPES.map(async (document) => ({
        ...document, data: await fetchLegalTerms(document.fetchType)
      })));
      actorHandle.assertCurrent('settings');
      if (documents.some(({ data }) => !data?.id || !data?.version)) {
        throw new Error('No se pudieron verificar los documentos legales. Revisa tu conexión e intenta de nuevo.');
      }
      if (documents.some(({ type, data }) => legalDocuments.find((item) => item.type === type)?.data?.id !== data.id)) {
        setLegalDocuments(documents);
        throw new Error('Los documentos legales cambiaron. Revisa las nuevas versiones y vuelve a aceptarlas.');
      }

      const currentLicenseKey = licenseDetails?.license_key;

      if (!currentLicenseKey) {
        throw new Error('No hay una licencia activa para finalizar la configuracion.');
      }

      const policyState = await fetchLegalPolicyState(currentLicenseKey);
      actorHandle.assertCurrent('settings');
      if (!policyState?.success || !Array.isArray(policyState.accepted_documents)) {
        throw new Error('No se pudieron verificar las aceptaciones guardadas. Revisa tu conexión e intenta de nuevo.');
      }
      const acceptedIds = new Set(policyState.accepted_documents.map((item) => item.term_id || item.id));
      for (const document of documents) {
        actorHandle.assertCurrent('settings');
        if (useAppStore.getState().licenseDetails?.license_key !== currentLicenseKey) {
          throw new Error('La licencia cambió. Vuelve a iniciar la configuración.');
        }
        if (acceptedIds.has(document.data.id)) continue;
        const acceptResult = await acceptLegalTerms(currentLicenseKey, document.data.id);
        if (!acceptResult?.success && acceptResult?.message !== 'ALREADY_ACCEPTED') {
          const reason = acceptResult?.message || acceptResult?.error;

          if (reason === 'LICENSE_NOT_FOUND_OR_INACTIVE' || reason === 'DEVICE_NOT_AUTHORIZED') {
            await logout();
            throw new Error(
              'La licencia local ya no existe o este dispositivo no esta autorizado. Ingresa una licencia valida para continuar.'
            );
          }

          if (reason === 'TERM_NOT_FOUND') {
            throw new Error('No se encontro la version actual de terminos. Intenta de nuevo.');
          }

          throw new Error(`No se pudo registrar la aceptación de ${document.data.title || document.label}. Intenta de nuevo.`);
        }

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
        logoUploadSource,
        business_type: selectedTypes
      });
    } catch (err) {
      Logger.error('Error en setup:', err);
      setError(err.message || 'Ocurrió un error al procesar. Intenta de nuevo.');
    } finally {
      submittingRef.current = false;
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
    if (!isStep1Complete || !isStep2Complete) return;
    setActiveSection(includesOwner && !isOwnerComplete ? 'owner' : 'complete');
  };

  const handleOwnerEnrollmentSuccess = () => {
    setActiveSection('complete');
  };

  return (
    <div id="business-setup-modal" className="modal fullscreen-modal">
      <div className="modal-content setup-content">
        <div className="setup-header">
          <div className="setup-header-content">
            <div className="setup-header-icon">
              <Rocket className="header-icon-svg" />
            </div>
            <h2>Configura tu Negocio</h2>

            <p className="header-text-mobile">
              Completa estos simples pasos para personalizar tu sistema y adaptarlo a tus necesidades operativas. Estamos listos para empezar.
            </p>

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
                  Tu cuenta personal identifica quién administra el negocio. Al continuar crearemos tu acceso de propietario antes de la confirmación final.
                </p>
              )}
              {activeSection === 'complete' && (
                <p className="fade-in-text">
                  Revisa la información final. Al crear el negocio registraremos las aceptaciones de los documentos legales y guardaremos tu configuración.
                </p>
              )}
            </div>
          </div>
        </div>

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
                    <button type="button" className="btn btn-primary" onClick={handleImportCandidate} disabled={isBusy}>
                      Copiar datos
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={handleSkipImportCandidate} disabled={isBusy}>
                      Empezar desde cero
                    </button>
                  </div>
                </div>
              )}

              <div className={`accordion-item ${activeSection === 'info' ? 'open' : ''} ${isStep1Complete ? 'completed' : ''}`}>
                <button
                  type="button"
                  className="accordion-header"
                  disabled={isBusy}
                  aria-expanded={activeSection === 'info'}
                  onClick={() => handleSectionToggle('info')}
                >
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
                          <input
                            id="logo-upload"
                            type="file"
                            accept="image/*"
                            onChange={handleImageChange}
                            className="hidden-input"
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

              <div className={`accordion-item ${activeSection === 'type' ? 'open' : ''} ${!isStep1Complete ? 'locked' : ''} ${isStep2Complete ? 'completed' : ''}`}>
                <button
                  type="button"
                  className="accordion-header"
                  disabled={isBusy || !isStep1Complete}
                  aria-expanded={activeSection === 'type'}
                  onClick={() => handleSectionToggle('type')}
                >
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
                    <p className="rubro-intro">Selecciona a qué se dedica tu empresa. Esto activará funciones especiales.</p>

                    {maxRubrosAllowed === 1 && (
                      <div className="trial-badge">
                        <Info size={20} className="trial-badge-icon" />
                        <span>Tu plan actual permite seleccionar <strong>1 rubro</strong> principal.</span>
                      </div>
                    )}

                    <div className={`rubro-grid ${isBusy ? 'disabled-grid' : ''}`}>
                      {BUSINESS_RUBROS.map((rubro) => {
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
                            title={isLockedByLicense ? 'No incluido en tu licencia' : ''}
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

              {includesOwner && (
                <div className={`accordion-item ${activeSection === 'owner' ? 'open' : ''} ${!isStep1Complete || !isStep2Complete ? 'locked' : ''} ${isOwnerComplete ? 'completed' : ''}`}>
                  <button
                    type="button"
                    className="accordion-header"
                    aria-expanded={activeSection === 'owner'}
                    disabled={isBusy || !isStep1Complete || !isStep2Complete}
                    onClick={() => handleSectionToggle('owner')}
                  >
                    <span className="header-title">
                      <span className="step-number">3</span>
                      <span>Tu acceso como propietario</span>
                    </span>
                    <span className="header-status">
                      {isOwnerComplete && <CheckCircle size={20} className="icon-success" />}
                      <ChevronDown size={20} />
                    </span>
                  </button>

                  {activeSection === 'owner' && (
                    <div className="accordion-body">
                      {needsOwner && currentDeviceRole !== 'staff' ? (
                        <AdminEnrollmentModal
                          embedded
                          onBusyChange={setEnrolling}
                          onEnrollmentSuccess={handleOwnerEnrollmentSuccess}
                          submitLabel="Continuar"
                          loadingLabel="Creando acceso..."
                        />
                      ) : (
                        <div className="setup-owner-complete-note">
                          <CheckCircle size={20} className="icon-success" />
                          <span>Tu acceso como propietario ya está creado.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className={`accordion-item ${activeSection === 'complete' ? 'open' : ''} ${!isStep1Complete || !isStep2Complete || !isOwnerComplete ? 'locked' : ''}`}>
                <button
                  type="button"
                  className="accordion-header"
                  aria-expanded={activeSection === 'complete'}
                  disabled={isBusy || !isStep1Complete || !isStep2Complete || !isOwnerComplete}
                  onClick={() => handleSectionToggle('complete')}
                >
                  <span className="header-title">
                    <span className="step-number">{includesOwner ? '4' : '3'}</span>
                    <span>Todo listo</span>
                  </span>
                  <ChevronDown size={20} />
                </button>

                {activeSection === 'complete' && (
                  <div className="accordion-body">
                    <form onSubmit={handleSubmit}>
                      <div className="setup-final-summary">
                        <div className="setup-final-summary__item">
                          <span className="setup-final-summary__label">Negocio</span>
                          <strong>{name}</strong>
                        </div>
                        <div className="setup-final-summary__item">
                          <span className="setup-final-summary__label">Giro</span>
                          <strong>{selectedRubroLabels}</strong>
                        </div>
                        <div className="setup-final-summary__item">
                          <span className="setup-final-summary__label">Acceso</span>
                          <strong>Propietario creado</strong>
                        </div>
                      </div>

                      <p className="terms-agreement-text">
                        Al hacer clic en <strong>Crear negocio</strong>, aceptas los{' '}
                        <a href="#setup-legal-documents" className="terms-link" aria-haspopup="dialog" onClick={(event) => {
                          event.preventDefault();
                          setShowTerms(true);
                        }}>Términos de uso y demás documentos legales de Lanzo POS</a>, en sus versiones vigentes indicadas en cada documento.
                      </p>
                      {legalLoading && <p role="status">Verificando documentos legales...</p>}
                      {!legalLoading && (legalDocuments.length !== LEGAL_DOCUMENT_TYPES.length || legalDocuments.some(({ data }) => !data?.id || !data?.version)) && (
                        <button type="button" className="terms-link" disabled={isBusy} onClick={() => setLegalLoadAttempt((value) => value + 1)}>Reintentar carga</button>
                      )}

                      {error && <div className="error-message" role="alert">{error}</div>}

                      <button
                        type="submit"
                        className="btn btn-save btn-finish"
                        disabled={isBusy || !isStep1Complete || !isStep2Complete || !isOwnerComplete}
                      >
                        {isSubmitting ? (
                          <><Loader2 className="animate-spin" size={20} />Creando negocio...</>
                        ) : (
                          'Crear negocio'
                        )}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="setup-external-actions">
            <PreloginSupportAccess screen="Configuración del negocio">
              <button type="button" className="ui-button ui-button--ghost setup-change-license" onClick={logout} disabled={isBusy}>
                Cambiar licencia
              </button>
            </PreloginSupportAccess>
          </div>
        </div>
      </div>

      <TermsAndConditionsModal
        isOpen={showTerms}
        onClose={() => setShowTerms(false)}
        readOnly={true}
        showDocumentIndex={true}
        documentTypes={LEGAL_DOCUMENT_TYPES}
      />
    </div>
  );
}
