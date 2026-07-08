import { useEffect, useId, useMemo, useReducer, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage, showMessageModal } from '../../services/utils';
import Logger from '../../services/Logger';
import {
  Building2,
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
  ShieldCheck,
  Sparkles,
  Sun,
  Upload
} from 'lucide-react';
import TermsAndConditionsModal from '../common/TermsAndConditionsModal';

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
  logoPreview: logoPlaceholder,
  pendingLogoFile: null,
  lockedFields: defaultLockedFields
};

const MQL = window.matchMedia('(prefers-color-scheme: dark)');

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
  const logoPreview = companyProfile.logo || logoPlaceholder;

  return {
    name,
    phone,
    address,
    logoPreview,
    pendingLogoFile: null,
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
      return { ...state, logoPreview: action.previewUrl, pendingLogoFile: action.file };
    case 'saved':
      return { ...state, pendingLogoFile: null };
    default:
      return state;
  }
}

function InputStatusIcon({ isLocked }) {
  if (!isLocked) return null;
  return (
    <span title="Bloqueado" className="settings-lock-icon">
      <Lock size={16} />
    </span>
  );
}

function SettingsHero({ completedFields, activeThemeLabel }) {
  return (
    <header className="settings-general-hero">
      <div className="settings-general-title">
        <span className="settings-general-kicker">
          <Sparkles size={15} />
          Datos y apariencia
        </span>
        <div>
          <h2>Identidad del negocio</h2>
          <p>Configura la informacion visible del punto de venta y el modo visual de trabajo.</p>
        </div>
      </div>

      <div className="settings-general-summary" aria-label="Resumen de configuracion">
        <div>
          <span>Perfil</span>
          <strong>{completedFields}/4</strong>
        </div>
        <div>
          <span>Tema</span>
          <strong>{activeThemeLabel}</strong>
        </div>
      </div>
    </header>
  );
}

function ProfilePanel({ fieldId, profileState, hasChanges, isProcessingLogo, onImageChange, onSubmit, dispatchProfile }) {
  const { name, phone, address, logoPreview, lockedFields } = profileState;
  const updateField = (fieldName) => (event) => dispatchProfile({ type: 'field', name: fieldName, value: event.target.value });

  return (
    <form onSubmit={onSubmit} className="settings-profile-panel">
      <div className="settings-panel-header">
        <div className="settings-title-row">
          <span className="settings-section-icon" aria-hidden="true">
            <Building2 size={18} />
          </span>
          <div>
            <h3 className="subtitle settings-title-inline">Datos de la empresa</h3>
            <p>Estos datos quedan protegidos despues de guardarlos.</p>
          </div>
        </div>

        <div className="settings-lock-note">
          <Info size={14} className="settings-icon-shrink" />
          <span>Para cambios posteriores, contacta a soporte.</span>
        </div>
      </div>

      <div className="settings-profile-grid">
        <div className="form-group settings-field-relative">
          <label className="form-label settings-label-icon" htmlFor={`${fieldId}-name`}>
            <Building2 size={16} /> Nombre del negocio
          </label>
          <input
            id={`${fieldId}-name`}
            type="text"
            className={`form-input ${lockedFields.name ? 'input-locked' : ''}`}
            value={name}
            onChange={updateField('name')}
            placeholder="Ej. Mi Tiendita"
            disabled={lockedFields.name}
            aria-label="Nombre del negocio"
          />
          <InputStatusIcon isLocked={lockedFields.name} />
        </div>

        <div className="form-group settings-field-relative">
          <label className="form-label settings-label-icon" htmlFor={`${fieldId}-phone`}>
            <Phone size={16} /> Telefono / WhatsApp
          </label>
          <input
            id={`${fieldId}-phone`}
            type="tel"
            className={`form-input ${lockedFields.phone ? 'input-locked' : ''}`}
            value={phone}
            onChange={updateField('phone')}
            placeholder="Ej. 55 1234 5678"
            disabled={lockedFields.phone}
            aria-label="Telefono o WhatsApp"
          />
          <InputStatusIcon isLocked={lockedFields.phone} />
        </div>

        <div className="form-group logo-upload-group">
          <label className="form-label settings-label-icon" htmlFor={`${fieldId}-logo`}>
            <ImageIcon size={16} /> Logo
          </label>
          <div className={`image-upload-wrapper ${lockedFields.logo ? 'locked' : ''}`}>
            {isProcessingLogo && (
              <div className="spinner-loader small settings-logo-spinner"></div>
            )}

            <img className="image-preview" src={logoPreview} alt="Logo del negocio" />

            {!lockedFields.logo && !isProcessingLogo && (
              <span className="settings-logo-upload-cue" aria-hidden="true">
                <Upload size={18} />
              </span>
            )}

            {lockedFields.logo && (
              <div className="settings-logo-lock-overlay">
                <Lock size={24} />
              </div>
            )}

            <input
              id={`${fieldId}-logo`}
              className="file-input-hidden"
              type="file"
              accept="image/*"
              onChange={onImageChange}
              disabled={isProcessingLogo || lockedFields.logo}
              aria-label="Subir logo del negocio"
            />
          </div>
        </div>

        <div className="form-group settings-field-relative settings-address-field">
          <label className="form-label settings-label-icon" htmlFor={`${fieldId}-address`}>
            <MapPin size={16} /> Direccion
          </label>
          <textarea
            id={`${fieldId}-address`}
            className={`form-textarea ${lockedFields.address ? 'input-locked' : ''}`}
            value={address}
            onChange={updateField('address')}
            rows="3"
            placeholder="Calle, numero, colonia..."
            disabled={lockedFields.address}
            aria-label="Direccion del negocio"
          ></textarea>
          <InputStatusIcon isLocked={lockedFields.address} />
        </div>
      </div>

      <div className="settings-submit-row">
        {hasChanges ? (
          <button type="submit" className="btn btn-save animate-fade-in settings-submit-button">
            <Save size={16} />
            Actualizar datos
          </button>
        ) : (
          <span className="settings-saved-state">
            <CheckCircle2 size={16} />
            Sin cambios pendientes
          </span>
        )}
      </div>
    </form>
  );
}

function AppearancePanel({ activeTheme, onThemeChange }) {
  return (
    <section className="settings-preference-panel">
      <div className="settings-preference-heading">
        <span className="settings-section-icon" aria-hidden="true">
          <Sun size={18} />
        </span>
        <div>
          <h3 className="subtitle">Apariencia</h3>
          <p>Elige el modo visual para esta terminal.</p>
        </div>
      </div>

      <div className="theme-toggle-container">
        {themeOptions.map(({ value, label, description, Icon }) => (
          <label key={value} className="theme-radio-label">
            <input
              type="radio"
              name="theme"
              value={value}
              checked={activeTheme === value}
              onChange={onThemeChange}
              aria-label={`Tema ${label}`}
            />
            <span className="theme-radio-text">
              <Icon size={17} />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

function LegalPanel({ onOpen }) {
  return (
    <section className="settings-preference-panel">
      <div className="settings-preference-heading">
        <span className="settings-section-icon" aria-hidden="true">
          <ShieldCheck size={18} />
        </span>
        <div>
          <h3 className="subtitle">Legal y privacidad</h3>
          <p>Consulta las politicas de uso y manejo de datos.</p>
        </div>
      </div>

      <button
        type="button"
        className="settings-legal-button"
        onClick={onOpen}
      >
        <span className="settings-icon-bubble settings-icon-bubble--info">
          <FileText size={20} />
        </span>
        <span>
          <strong>Terminos y condiciones de uso</strong>
          <small>Revisa permisos, privacidad y condiciones operativas.</small>
        </span>
      </button>
    </section>
  );
}

export default function GeneralSettings() {
  const companyProfile = useAppStore((state) => state.companyProfile);
  const updateCompanyProfile = useAppStore((state) => state.updateCompanyProfile);
  const fieldId = useId();
  const [profileState, dispatchProfile] = useReducer(profileReducer, initialProfileState);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);
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
      profileState.pendingLogoFile !== null
    );
  }, [profileState, companyProfile]);

  const completedFields = useMemo(() => (
    Object.values(profileState.lockedFields).reduce((count, isLocked) => count + (isLocked ? 1 : 0), 0)
  ), [profileState.lockedFields]);

  const activeThemeLabel = themeOptions.find((theme) => theme.value === activeTheme)?.label || 'Sistema';

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
    const newTheme = event.target.value;
    setActiveTheme(newTheme);
    localStorage.setItem('theme-preference', newTheme);
  };

  const handleImageChange = async (event) => {
    if (profileState.lockedFields.logo) return;

    const file = event.target.files[0];
    if (!file) return;

    try {
      setIsProcessingLogo(true);
      const compressedFile = await compressImage(file);
      const objectURL = URL.createObjectURL(compressedFile);

      dispatchProfile({ type: 'logo-selected', previewUrl: objectURL, file: compressedFile });
    } catch (error) {
      Logger.error('Error imagen:', error);
    } finally {
      setIsProcessingLogo(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      const updates = {
        name: profileState.name,
        phone: profileState.phone,
        address: profileState.address
      };
      if (profileState.pendingLogoFile) {
        updates.logo = profileState.pendingLogoFile;
      }

      await updateCompanyProfile({
        id: 'company',
        business_type: companyProfile?.business_type || [],
        ...updates
      });
      dispatchProfile({ type: 'saved' });
      showMessageModal('Datos actualizados correctamente. Los campos nuevos se han bloqueado.');
    } catch (error) {
      Logger.error(error);
      showMessageModal('Error al guardar.', null, { type: 'error' });
    }
  };

  return (
    <div className="settings-general-shell">
      <SettingsHero completedFields={completedFields} activeThemeLabel={activeThemeLabel} />

      <section className="settings-general-layout">
        <ProfilePanel
          fieldId={fieldId}
          profileState={profileState}
          hasChanges={hasChanges}
          isProcessingLogo={isProcessingLogo}
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
      />
    </div>
  );
}
