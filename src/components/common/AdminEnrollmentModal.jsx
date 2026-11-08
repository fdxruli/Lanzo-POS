import { useState } from 'react';
import { ShieldPlus } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { classifyActorAuthorityError } from '../../services/auth/actorAuthorityErrors';
import { classifyDatabaseError } from '../../services/db/databaseRecoveryState';
import AuthPageLayout, { AuthPageFooter } from './AuthPageLayout';
import LicenseContextSummary from './LicenseContextSummary';
import PasswordField from './PasswordField';
import './AdminAuthModal.css';
import './SetupModal.onboarding.css';

const SAFE_ENROLLMENT_MESSAGES = Object.freeze({
  ADMIN_ONBOARDING_INVALID: 'El código de primera configuración no es válido. Revisa el código entregado por LANZO.',
  ADMIN_ENROLLMENT_NOT_ALLOWED: 'Este dispositivo no está autorizado para configurar la cuenta propietaria. Contacta con soporte.',
  ADMIN_OWNER_ALREADY_ENROLLED: 'Ya existe una cuenta propietaria. Inicia sesión con esa cuenta.',
  ADMIN_ENROLLMENT_RATE_LIMITED: 'Se realizaron demasiados intentos. Espera un momento antes de volver a intentarlo.',
  ADMIN_LOGIN_RATE_LIMITED: 'Se realizaron demasiados intentos. Espera un momento antes de volver a intentarlo.',
  RATE_LIMITED: 'Se realizaron demasiados intentos. Espera un momento antes de volver a intentarlo.',
  ONLINE_REQUIRED: 'Necesitas conexión para configurar la cuenta propietaria.',
  DEVICE_TOKEN_REQUIRED: 'No pudimos validar este dispositivo. Revisa su autorización o contacta con soporte.',
  DEVICE_TOKEN_INVALID: 'No pudimos validar este dispositivo. Revisa su autorización o contacta con soporte.'
});

const describeEnrollmentError = (value, preserveMessage = false) => {
  if (preserveMessage && typeof value?.message === 'string' && value.message) return value.message;
  const code = value?.code || value?.error?.code;
  if (SAFE_ENROLLMENT_MESSAGES[code]) return SAFE_ENROLLMENT_MESSAGES[code];
  const authority = classifyActorAuthorityError(value);
  if (authority) return authority.message;
  const database = classifyDatabaseError(value);
  if (database.code === 'DB_BLOCKED') {
    return 'La base local está abierta en otra pestaña. Cierra las demás pestañas de Lanzo y vuelve a intentarlo.';
  }
  if (database.requiresMigration) {
    return 'El almacenamiento local necesita recuperarse antes de completar el registro. Revisa las operaciones locales antes de volver a intentarlo.';
  }
  if (!navigator.onLine) return 'Necesitas conexión para configurar la cuenta propietaria.';
  return 'No pudimos confirmar la creación de la cuenta propietaria. Verifica si el acceso quedó configurado antes de intentarlo de nuevo.';
};

export default function AdminEnrollmentModal({
  embedded = false,
  requiresInvitation = false,
  onBusyChange,
  onEnrollmentSuccess,
  submitLabel = 'Crear cuenta propietaria',
  loadingLabel = 'Creando cuenta...'
}) {
  const [invitationCode, setInvitationCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const enroll = useAppStore((state) => state.handleAdminEnrollment);
  const logout = useAppStore((state) => state.logout);
  const discoverAdminAccess = useAppStore((state) => state.discoverAdminAccess);
  const licenseKey = useAppStore((state) => state.adminLoginLicenseKey);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const companyProfile = useAppStore((state) => state.companyProfile);
  const ownerEnrollmentContext = useAppStore((state) => state.ownerEnrollmentContext);

  const submit = async (event) => {
    event.preventDefault();
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (requiresInvitation && !invitationCode.trim()) {
      setError('Introduce el código de primera configuración.');
      return;
    }

    setLoading(true);
    setError('');
    onBusyChange?.(true);

    try {
      const result = await enroll({
        displayName: displayName.trim(),
        username: username.trim(),
        password,
        ...(requiresInvitation ? { invitationCode: invitationCode.trim() } : {})
      });

      if (!result?.success) {
        setError(describeEnrollmentError(result, embedded));
        return;
      }

      await onEnrollmentSuccess?.(result);
    } catch (err) {
      setError(describeEnrollmentError(err, embedded));
    } finally {
      if (requiresInvitation) {
        setInvitationCode('');
        setPassword('');
        setConfirmation('');
      }
      setLoading(false);
      onBusyChange?.(false);
    }
  };

  const continueWithExistingAccount = async () => {
    if (!licenseKey || !discoverAdminAccess) return;
    setLoading(true);
    setError('');
    try {
      await discoverAdminAccess(licenseKey);
      if (useAppStore.getState().appStatus === 'admin_initial_setup_required') {
        setError('No pudimos verificar si ya existe una cuenta propietaria. Vuelve a intentarlo o contacta con soporte.');
      }
    } catch {
      if (useAppStore.getState().appStatus === 'admin_initial_setup_required') {
        setError('No pudimos verificar si ya existe una cuenta propietaria. Vuelve a intentarlo o contacta con soporte.');
      }
    } finally {
      setLoading(false);
    }
  };

  const content = (
      <section
        className={embedded ? undefined : 'admin-auth-panel admin-auth-panel--enrollment'}
        aria-labelledby="admin-enroll-title"
      >
        {!embedded && (
          <LicenseContextSummary
            licenseDetails={licenseDetails}
            licenseKey={licenseKey}
            businessName={companyProfile?.business_name || companyProfile?.name || ''}
            showBusiness
          />
        )}
        <div className="admin-auth-heading">
          <ShieldPlus size={30} aria-hidden="true" />
          <div>
            <h1 id="admin-enroll-title">{embedded || ownerEnrollmentContext === 'existing_license' ? 'Tu acceso como propietario' : 'Crea tu cuenta de propietario'}</h1>
            <p>
              {requiresInvitation
                ? 'Configura el acceso administrativo de este negocio con el código de primera configuración que te entregó LANZO.'
                : 'Crea tu cuenta personal para administrar Lanzo. La licencia identifica a tu negocio; esta cuenta identifica que eres tú quien lo administra.'}
            </p>
          </div>
        </div>
        <p>Esta contraseña es para administrar Lanzo. No es un PIN de respaldo ni sustituye la clave de tu licencia.</p>
        <form onSubmit={submit} className="admin-auth-form admin-auth-form--enrollment" aria-busy={loading}>
          {requiresInvitation && (
            <label>
              Código de primera configuración
              <input
                className="form-input"
                autoComplete="one-time-code"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                value={invitationCode}
                onChange={(e) => setInvitationCode(e.target.value.trim().toLowerCase())}
                minLength={64}
                maxLength={64}
                required
                disabled={loading}
                aria-describedby="admin-onboarding-code-help"
              />
              <small id="admin-onboarding-code-help">Pega el código de 64 caracteres recibido para este negocio.</small>
            </label>
          )}
          <label>
            Nombre del propietario
            <input
              className="form-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={120}
              required
              disabled={loading}
            />
          </label>
          <label>
            Usuario
            <input
              className="form-input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              minLength={3}
              maxLength={64}
              required
              disabled={loading}
            />
          </label>
          <div>
            <PasswordField
              id="admin-enrollment-password"
              label="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              describedBy="admin-enrollment-password-help"
              disabled={loading}
              fieldClassName="admin-auth-field"
            />
            <small id="admin-enrollment-password-help">Mínimo 8 caracteres, una letra y un número.</small>
          </div>
          <PasswordField
            id="admin-enrollment-password-confirmation"
            label="Confirmar contraseña"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="new-password"
            disabled={loading}
            fieldClassName="admin-auth-field"
          />
          {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
          <button className="ui-button ui-button--primary" disabled={loading || !navigator.onLine}>
            {loading ? loadingLabel : submitLabel}
          </button>
        </form>
        {requiresInvitation && (
          <button
            type="button"
            className="ui-button ui-button--ghost"
            onClick={continueWithExistingAccount}
            disabled={loading || !navigator.onLine}
          >
            Ya configuré mi cuenta: iniciar sesión
          </button>
        )}
      </section>
  );

  if (embedded) return <div className="setup-owner-access">{content}</div>;

  return (
    <AuthPageLayout
      footer={(
        <AuthPageFooter screen="Registro de cuenta propietaria">
          <button type="button" className="auth-page__footer-link" onClick={logout} disabled={loading}>
            Cambiar licencia
          </button>
          <span className="auth-page__footer-separator" aria-hidden="true">·</span>
        </AuthPageFooter>
      )}
    >
      {content}
    </AuthPageLayout>
  );
}
