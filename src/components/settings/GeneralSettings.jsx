import { useEffect, useId, useMemo, useReducer, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage, showMessageModal } from '../../services/utils';
import Logger from '../../services/Logger';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Info,
  Lock,
  MapPin,
  Monitor,
  Moon,
  Phone,
  Save,
  Sun,
  Upload
} from 'lucide-react';
import TermsAndConditionsModal, { LEGAL_DOCUMENT_TYPES } from '../common/TermsAndConditionsModal';
import BusinessTimezoneField from '../common/BusinessTimezoneField';
import './GeneralSettings.css';
import NoPermission from '../common/NoPermission';
import { isValidBusinessTimezone } from '../../utils/layawayCalendar';
import {
  useSettingsAccess,
  useSettingsActionGuard
} from '../../services/auth/useSettingsAccess';

const logoPlaceholder = 'https://placehold.co/100x100/FFFFFF/4A5568?text=L';

const defaultLockedFields = {
  name: false,
  phone: false,
  address: false,
  logo: false
};

const initialProfileState = {
  name: '',
  phone: '',
  address: '',
  timezone: '',
  logoPreview: logoPlaceholder,
  pendingLogoFile: null,
  pendingLogoUploadSource: null,
  lockedFields: defaultLockedFields
};

const MQL = (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
)
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : {
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

const applyTheme = (theme) => {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
};

const getInitialTheme = () => localStorage.getItem('theme-preference') || 'system';

const themeOptions = [
  {
    value: 'light',
    label: 'Claro',
    description: 'Interfaz luminosa para mostrador y oficina.',
    Icon: Sun
  },
  {
    value: 'dark',
    label: 'Oscuro',
    description: 'Menos brillo para jornadas largas.',
    Icon: Moon
  },
  {
    value: 'system',
    label: 'Sistema',
    description: 'Sigue la preferencia del dispositivo.',
    Icon: Monitor
  }
];

function getProfileState(companyProfile) {
  if (!companyProfile) return initialProfileState;

  const name = companyProfile.name || '';
  const phone = companyProfile.phone || '';
  const address = companyProfile.address || '';
  const timezone = companyProfile.timezone || '';
  const logoPreview = companyProfile.logo || logoPlaceholder;

  return {
    name,
    phone,
    address,
    timezone,
    logoPreview,
    pendingLogoFile: null,
    pendingLogoUploadSource: null,
    lockedFields: {
      name: !!(name && name.trim().length > 0),
      phone: !!(phone && phone.trim().length > 0),
      address: !!(address && address.trim().length > 0),
      logo: !!(logoPreview && !logoPreview.includes('placehold.co'))
    }
  };
}

function profileReducer(state, action) {
  switch (action.type) {
    case 'hydrate':
      return getProfileState(action.companyProfile);
    case 'field':
      return { ...state, [action.name]: action.value };
    case 'logo-selected':
      return { ...state, logoPreview: action.previewUrl, pendingLogoFile: action.file, pendingLogoUploadSource: action.uploadSource };
    case 'saved':
      return { ...state, pendingLogoFile: null, pendingLogoUploadSource: null };
    default:
      return state;
  }
}

function ProfilePanel({ fieldId, profileState, hasChanges, isProcessingLogo, isSaving, onImageChange, onSubmit, dispatchProfile }) {
  const { name, phone, address, timezone, logoPreview, lockedFields } = profileState;
  const [showProtectedDetails, setShowProtectedDetails] = useState(false);
  const allIdentityProtected = Object.values(lockedFields).every(Boolean);
  const someIdentityProtected = Object.values(lockedFields).some(Boolean);
  const showIdentity = !allIdentityProtected || showProtectedDetails;
  const updateField = (fieldName) => (event) => dispatchProfile({ type: 'field', name: fieldName, value: event.target.value });

  return (
    <form onSubmit={onSubmit} className="settings-profile-panel">
      <header className="settings-panel-header">
        <div className="settings-title-row">
          <span className="settings-section-icon" aria-hidden="true"><Building2 size={18} /></span>
          <div>
            <h3 className="subtitle settings-title-inline">Datos del negocio</h3>
            <p>Completa la información pendiente.</p>
          </div>
        </div>
        {someIdentityProtected && (
          <p className="settings-lock-note">
            <Info size={14} aria-hidden="true" /> Para cambiar datos confirmados, contacta a soporte.
          </p>
        )}
      </header>

      {allIdentityProtected && (
        <div className="settings-identity-summary">
          <img src={logoPreview} alt="" className="settings-identity-logo" />
          <div className="settings-identity-label">
            <strong>{name}</strong>
            <small><Lock size={13} aria-hidden="true" /> Datos protegidos</small>
          </div>
          <button
            type="button" className="settings-identity-toggle"
            aria-expanded={showIdentity} aria-controls={fieldId + '-details'}
            onClick={() => setShowProtectedDetails((current) => !current)}
          >
            {showIdentity ? 'Ocultar datos protegidos' : 'Ver datos protegidos'}
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <div id={fieldId + '-details'} className={'settings-identity-details' + (showIdentity ? '' : ' is-collapsed')}>
        <div className="settings-profile-grid">
          <div className="form-group settings-field-relative">
            <label className="form-label settings-label-icon" htmlFor={lockedFields.name ? undefined : fieldId + '-name'}>
              <Building2 size={16} /> Nombre del negocio
            </label>
            {lockedFields.name ? (
              <div className="settings-readonly-value">
                <span>{name}</span><Lock size={15} aria-label="Protegido" />
              </div>
            ) : (
              <input id={fieldId + '-name'} type="text" className="form-input" value={name}
                onChange={updateField('name')} placeholder="Ej. Mi Tiendita" aria-label="Nombre del negocio" />
            )}
          </div>
          <div className="form-group settings-field-relative">
            <label className="form-label settings-label-icon" htmlFor={lockedFields.phone ? undefined : fieldId + '-phone'}>
              <Phone size={16} /> Teléfono / WhatsApp
            </label>
            {lockedFields.phone ? (
              <div className="settings-readonly-value">
                <span>{phone}</span><Lock size={15} aria-label="Protegido" />
              </div>
            ) : (
              <input id={fieldId + '-phone'} type="tel" className="form-input" value={phone}
                onChange={updateField('phone')} placeholder="Ej. 55 1234 5678" aria-label="Telefono o WhatsApp" />
            )}
          </div>
          <div className="form-group settings-field-relative settings-address-field">
            <label className="form-label settings-label-icon" htmlFor={lockedFields.address ? undefined : fieldId + '-address'}>
              <MapPin size={16} /> Dirección
            </label>
            {lockedFields.address ? (
              <div className="settings-readonly-value">
                <span>{address}</span><Lock size={15} aria-label="Protegido" />
              </div>
            ) : (
              <textarea id={fieldId + '-address'} className="form-textarea" value={address}
                onChange={updateField('address')} rows={2} placeholder="Calle, número, colonia..."
                aria-label="Direccion del negocio" />
            )}
          </div>
          <div className="form-group logo-upload-group">
            <label className="form-label settings-label-icon" htmlFor={fieldId + '-logo'}>
              <ImageIcon size={16} /> Logo {lockedFields.logo && <Lock size={13} aria-label="Protegido" />}
            </label>
            <div className={'image-upload-wrapper' + (lockedFields.logo ? ' locked' : '')}>
              {isProcessingLogo && <div className="spinner-loader small settings-logo-spinner" />}
              <img className="image-preview" src={logoPreview} alt="Logo del negocio" />
              {!lockedFields.logo && !isProcessingLogo && (
                <span className="settings-logo-upload-cue" aria-hidden="true"><Upload size={18} /></span>
              )}
              {lockedFields.logo && <div className="settings-logo-lock-overlay"><Lock size={16} /></div>}
              <input id={fieldId + '-logo'} className="file-input-hidden" type="file"
                accept="image/*" onChange={onImageChange}
                disabled={isProcessingLogo || lockedFields.logo} aria-label="Subir logo del negocio" />
            </div>
          </div>
        </div>
      </div>

      <div className="settings-timezone-section">
        <BusinessTimezoneField
          value={timezone} compactHelp
          onChange={(value) => dispatchProfile({ type: 'field', name: 'timezone', value })}
          disabled={isSaving}
        />
      </div>

      <div className="settings-submit-row">
        {hasChanges ? (
          <button type="submit" className="btn btn-save animate-fade-in settings-submit-button" disabled={isSaving}>
            <Save size={16} /> Actualizar datos
          </button>
        ) : (
          <span className="settings-saved-state"><CheckCircle2 size={16} /> Sin cambios pendientes</span>
        )}
      </div>
    </form>
  );
}

function AppearancePanel({ activeTheme, onThemeChange }) {
  return (
    <section className="settings-preference-panel">
      <div className="settings-preference-heading">
        <span className="settings-section-icon" aria-hidden="true"><Sun size={18} /></span>
        <div><h3 className="subtitle">Apariencia</h3><p>Tema de esta terminal</p></div>
      </div>
      <fieldset className="settings-theme-fieldset">
        <legend className="settings-visually-hidden">Seleccionar tema</legend>
        <div className="theme-toggle-container">
          {themeOptions.map(({ value, label, description, Icon }) => (
            <label key={value} className="theme-radio-label" title={description}>
              <input type="radio" name="theme" value={value} checked={activeTheme === value}
                onChange={onThemeChange} aria-label={'Tema ' + label} />
              <span className="theme-radio-text">
                <Icon size={17} aria-hidden="true" />
                <strong>{label}</strong>
                <small className="settings-visually-hidden">{description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

function LegalPanel({ onOpen }) {
  return (
    <section className="settings-preference-panel settings-legal-panel" aria-label="Legal y privacidad">
      <button type="button" className="settings-legal-button" onClick={onOpen}>
        <FileText size={19} aria-hidden="true" />
        <span><strong>Legal y privacidad</strong><small>Políticas, condiciones y avisos</small></span>
        <ChevronRight size={18} className="settings-legal-chevron" aria-hidden="true" />
      </button>
    </section>
  );
}

export default function GeneralSettings() {
  const settingsAccess = useSettingsAccess();
  if (!settingsAccess.canAccessSection('general')) return <NoPermission />;
  return <GeneralSettingsContent />;
}

function GeneralSettingsContent() {
  const companyProfile = useAppStore((state) => state.companyProfile);
  const updateCompanyProfile = useAppStore((state) => state.updateCompanyProfile);
  const captureSettingsAction = useSettingsActionGuard();
  const fieldId = useId();
  const [profileState, dispatchProfile] = useReducer(profileReducer, initialProfileState);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTheme, setActiveTheme] = useState(getInitialTheme);
  const [showTerms, setShowTerms] = useState(false);

  useEffect(() => {
    dispatchProfile({ type: 'hydrate', companyProfile });
  }, [companyProfile]);

  const hasChanges = useMemo(() => {
    if (!companyProfile) return false;

    return (
      profileState.name.trim() !== (companyProfile.name || '') ||
      profileState.phone.trim() !== (companyProfile.phone || '') ||
      profileState.address.trim() !== (companyProfile.address || '') ||
      profileState.timezone.trim() !== (companyProfile.timezone || '') ||
      profileState.pendingLogoFile !== null
    );
  }, [profileState, companyProfile]);

  useEffect(() => {
    const systemThemeListener = (event) => {
      if (activeTheme === 'system') applyTheme(event.matches ? 'dark' : 'light');
    };

    MQL.addEventListener('change', systemThemeListener);

    if (activeTheme === 'system') applyTheme(MQL.matches ? 'dark' : 'light');
    else applyTheme(activeTheme);

    return () => MQL.removeEventListener('change', systemThemeListener);
  }, [activeTheme]);

  const handleThemeChange = (event) => {
    try {
      const actorHandle = captureSettingsAction('settings_data');
      actorHandle.assertCurrent();
      const newTheme = event.target.value;
      setActiveTheme(newTheme);
      localStorage.setItem('theme-preference', newTheme);
    } catch {
      // The protected subtree may have been revoked between render and click.
    }
  };

  const handleImageChange = async (event) => {
    if (profileState.lockedFields.logo) return;

    let actorHandle;
    try {
      actorHandle = captureSettingsAction('settings_data');
      actorHandle.assertCurrent();
    } catch {
      return;
    }

    const file = event.target.files[0];
    if (!file) return;

    try {
      setIsProcessingLogo(true);
      const compressedFile = await compressImage(file);
      actorHandle.assertCurrent();
      const objectURL = URL.createObjectURL(compressedFile);

      dispatchProfile({ type: 'logo-selected', previewUrl: objectURL, file: compressedFile, uploadSource: file });
    } catch (error) {
      Logger.error('Error imagen:', error);
    } finally {
      setIsProcessingLogo(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) return;

    let actorHandle;
    try {
      actorHandle = captureSettingsAction('settings_data');
      actorHandle.assertCurrent();
      const businessTimezone = profileState.timezone.trim();
      if (!businessTimezone && companyProfile?.timezone) {
        showMessageModal('No se puede quitar una zona horaria confirmada desde este formulario.', null, { type: 'warning' });
        return;
      }
      if (businessTimezone && !isValidBusinessTimezone(businessTimezone)) {
        showMessageModal('La zona horaria no es válida. Usa un identificador IANA como America/Merida.', null, { type: 'warning' });
        return;
      }
      const updates = {
        name: profileState.name,
        phone: profileState.phone,
        address: profileState.address,
        ...(businessTimezone ? { timezone: businessTimezone } : {})
      };
      if (profileState.pendingLogoFile) {
        updates.logo = profileState.pendingLogoFile;
        updates.logoUploadSource = profileState.pendingLogoUploadSource;
      }

      setIsSaving(true);
      const savedProfile = await updateCompanyProfile({
        ...companyProfile,
        id: 'company',
        business_type: companyProfile?.business_type || [],
        ...updates
      });
      actorHandle.assertCurrent();
      if (!savedProfile || (companyProfile?.license_key && savedProfile.license_key !== companyProfile.license_key)) return;
      if (businessTimezone && savedProfile.timezone !== businessTimezone) {
        throw new Error('No se confirmó la zona horaria guardada.');
      }
      dispatchProfile({ type: 'saved' });
      showMessageModal(businessTimezone && businessTimezone !== companyProfile?.timezone
        ? 'Zona horaria del negocio guardada.'
        : 'Datos actualizados correctamente. Los campos nuevos se han bloqueado.');
    } catch (error) {
      if (!actorHandle) return;
      try {
        actorHandle.assertCurrent();
      } catch {
        return;
      }
      Logger.error(error);
      const imagePrivacyError = error?.code === 'IMAGE_PROCESSING_FAILED'
        || error?.code === 'IMAGE_PRIVACY_UNSUPPORTED';
      showMessageModal(
        error?.message || (imagePrivacyError ? 'No se pudo procesar el logotipo.' : 'Error al guardar.'),
        null,
        { type: 'error' }
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="settings-general-shell">
      <section className="settings-general-layout">
        <ProfilePanel
          fieldId={fieldId}
          profileState={profileState}
          hasChanges={hasChanges}
          isProcessingLogo={isProcessingLogo}
          isSaving={isSaving}
          onImageChange={handleImageChange}
          onSubmit={handleSubmit}
          dispatchProfile={dispatchProfile}
        />

        <aside className="settings-preferences-column">
          <AppearancePanel activeTheme={activeTheme} onThemeChange={handleThemeChange} />
          <LegalPanel onOpen={() => setShowTerms(true)} />
        </aside>
      </section>

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
