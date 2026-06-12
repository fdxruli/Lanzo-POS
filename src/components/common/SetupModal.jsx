// src/components/common/SetupModal.jsx
import { useState, useMemo, useEffect, useRef } from 'react';
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
  Hammer,
  FolderKey
} from 'lucide-react';
import './SetupModal.css';
import Logger from '../../services/Logger';
import { fetchLegalTerms, acceptLegalTerms } from '../../services/supabase';
import { backupManager } from '../../services/backup/backupManager';

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
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [logoData, setLogoData] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('info');
  const [showTerms, setShowTerms] = useState(false);
  const [backupPin, setBackupPin] = useState('');
  const [backupPinConfirm, setBackupPinConfirm] = useState('');
  const [backupDirectory, setBackupDirectory] = useState(null);
  const nameInputRef = useRef(null);
  const supportsDirectoryPicker = typeof window.showDirectoryPicker === 'function';

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

  const isStep1Complete = useMemo(() => name.trim().length > 0, [name]);
  const isStep2Complete = selectedTypes.length > 0;
  const isPinValid = /^\d{8,}$/.test(backupPin) && backupPin === backupPinConfirm;
  const isBackupStepComplete = isPinValid && (!supportsDirectoryPicker || Boolean(backupDirectory));

  const handleSectionToggle = (section) => {
    if (section === 'type' && !isStep1Complete) return;
    if (section === 'backup' && !isStep2Complete) return;
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
    if (!isBackupStepComplete) {
      setError('Configura un PIN válido y selecciona la carpeta de respaldo.');
      setActiveSection('backup');
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

      await backupManager.configure(backupPin, backupDirectory);
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

  const handleContinueToBackup = () => {
    if (isStep2Complete) setActiveSection('backup');
  };

  const handleChooseBackupDirectory = async () => {
    setError('');
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setBackupDirectory(handle);
    } catch (directoryError) {
      if (directoryError.name !== 'AbortError') {
        Logger.error('Error seleccionando carpeta de respaldo:', directoryError);
        setError('No se pudo abrir la carpeta seleccionada.');
      }
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
                        ref={nameInputRef}
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
              <div className={`accordion-item ${activeSection === 'type' ? 'open' : ''} ${!isStep1Complete ? 'locked' : ''} ${isStep2Complete ? 'completed' : ''}`}>
                <div className="accordion-header" onClick={() => !isSubmitting && handleSectionToggle('type')}>
                  <div className="header-title">
                    <span className="step-number">2</span>
                    <span>Giro del Negocio</span>
                  </div>
                  <div className="header-status">
                    {isStep2Complete && <CheckCircle size={20} className="icon-success" />}
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
                        type="button"
                        className="btn btn-primary btn-next"
                        disabled={isSubmitting || !isStep2Complete}
                        onClick={handleContinueToBackup}
                      >
                        Continuar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className={`accordion-item ${activeSection === 'backup' ? 'open' : ''} ${!isStep2Complete ? 'locked' : ''} ${isBackupStepComplete ? 'completed' : ''}`}>
                <div className="accordion-header" onClick={() => !isSubmitting && handleSectionToggle('backup')}>
                  <div className="header-title">
                    <span className="step-number">3</span>
                    <span>Respaldo Cifrado</span>
                  </div>
                  <div className="header-status">
                    {isBackupStepComplete && <CheckCircle size={20} className="icon-success" />}
                    {!isStep2Complete ? <Lock size={18} className="icon-locked" /> : <ChevronDown size={20} className="icon-chevron" />}
                  </div>
                </div>

                {activeSection === 'backup' && (
                  <div className="accordion-body">
                    <div className="setup-backup-notice">
                      <FolderKey size={22} />
                      <p>Usa un PIN de al menos 8 dígitos. Si lo pierdes, no será posible recuperar tus respaldos.</p>
                    </div>

                    <div className="form-row-split setup-pin-row">
                      <div className="form-group flex-grow">
                        <label className="form-label" htmlFor="setup-backup-pin">PIN de respaldo *</label>
                        <input
                          id="setup-backup-pin"
                          className="form-input"
                          type="password"
                          inputMode="numeric"
                          minLength="8"
                          required
                          value={backupPin}
                          onChange={(event) => setBackupPin(event.target.value.replace(/\D/g, ''))}
                          placeholder="Mínimo 8 dígitos"
                          disabled={isSubmitting}
                        />
                      </div>
                      <div className="form-group flex-grow">
                        <label className="form-label" htmlFor="setup-backup-pin-confirm">Confirmar PIN *</label>
                        <input
                          id="setup-backup-pin-confirm"
                          className="form-input"
                          type="password"
                          inputMode="numeric"
                          minLength="8"
                          required
                          value={backupPinConfirm}
                          onChange={(event) => setBackupPinConfirm(event.target.value.replace(/\D/g, ''))}
                          placeholder="Repite el PIN"
                          disabled={isSubmitting}
                        />
                      </div>
                    </div>

                    {backupPinConfirm && backupPin !== backupPinConfirm && (
                      <div className="error-message">Los PIN no coinciden.</div>
                    )}

                    {supportsDirectoryPicker ? (
                      <button
                        type="button"
                        className="btn btn-secondary setup-directory-button"
                        onClick={handleChooseBackupDirectory}
                        disabled={isSubmitting}
                      >
                        <FolderKey size={18} />
                        {backupDirectory ? `Carpeta: ${backupDirectory.name}` : 'Seleccionar carpeta de respaldo *'}
                      </button>
                    ) : (
                      <div className="setup-backup-compatibility">
                        Tu navegador no permite respaldos invisibles. Los archivos cifrados se descargarán manualmente.
                      </div>
                    )}

                    {error && <div className="error-message">{error}</div>}

                    <div className="step-actions end">
                      <button
                        type="submit"
                        className="btn btn-save btn-finish"
                        disabled={isSubmitting || !isBackupStepComplete}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="animate-spin" size={20} />
                            Configurando...
                          </>
                        ) : (
                          <>Finalizar y Empezar</>
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
