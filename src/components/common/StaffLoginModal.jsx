import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, KeyRound, LockKeyhole, LogIn, WifiOff } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import AuthPageLayout, { AuthPageFooter } from './AuthPageLayout';
import LicenseContextSummary from './LicenseContextSummary';
import PasswordField from './PasswordField';
import { classifyActorAuthorityError } from '../../services/auth/actorAuthorityErrors';
import { isProLicense } from '../../store/slices/license/licenseGuards';
import {
  STAFF_DEVICE_AUTH_MESSAGE,
  STAFF_ONLY_MODE_LOGIN_MESSAGE,
  STAFF_SESSION_CLOSED_MESSAGE,
  STAFF_SESSION_CLOSED_REMOTE_CONFIRMED_MESSAGE,
  STAFF_SESSION_CLOSED_REMOTE_NOT_ATTEMPTED_MESSAGE,
  STAFF_SESSION_CLOSED_REMOTE_UNCONFIRMED_MESSAGE
} from '../../store/slices/license/licenseConstants';
import './StaffLoginModal.css';

const SAFE_LOGIN_MESSAGES = Object.freeze({
  INVALID_STAFF_CREDENTIALS: 'Usuario o contraseña incorrectos.',
  INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos.',
  STAFF_ACCOUNT_INACTIVE: 'Esta cuenta de personal está desactivada. Solicita al administrador que la habilite para poder ingresar.',
  ONLINE_REQUIRED: 'Necesitas internet para iniciar sesión staff.',
  STAFF_LOGIN_RATE_LIMITED: 'Se realizaron demasiados intentos. Espera un momento y vuelve a intentar.',
  RATE_LIMITED: 'Se realizaron demasiados intentos. Espera un momento y vuelve a intentar.',
  STAFF_NOT_ACTIVE: 'Tu acceso staff no está activo. Pide al administrador revisarlo.',
  STAFF_DISABLED: 'Tu acceso staff no está activo. Pide al administrador revisarlo.',
  DEVICE_MODE_STAFF_NOT_ALLOWED: 'Este dispositivo no está habilitado para el acceso staff.'
});

const describeStaffLoginError = (error) => {
  const authority = classifyActorAuthorityError(error);
  if (authority) return authority.message;
  if (SAFE_LOGIN_MESSAGES[error?.code]) return SAFE_LOGIN_MESSAGES[error.code];
  if (!navigator.onLine) return 'Necesitas conexión para iniciar sesión staff.';
  return 'No se pudo iniciar sesión staff. Tus datos permanecen intactos. Vuelve a intentarlo.';
};

export default function StaffLoginModal() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [errorMessage, setErrorMessage] = useState('');
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [recoveryUsername, setRecoveryUsername] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const isLoggingOut = useAppStore((state) => state._isLoggingOut === true);

  const handleStaffLogin = useAppStore((state) => state.handleStaffLogin);
  const handleAdminLogin = useAppStore((state) => state.handleAdminLogin);
  const initializeApp = useAppStore((state) => state.initializeApp);
  const logout = useAppStore((state) => state.logout);
  const returnToLicenseAccessChoice = useAppStore((state) => state.returnToLicenseAccessChoice);
  const companyProfile = useAppStore((state) => state.companyProfile);
  const actorAuthorityRecovery = useAppStore((state) => state.actorAuthorityRecovery);
  const staffLoginError = useAppStore((state) => state.staffLoginError);
  const staffLoginMessage = useAppStore((state) => state.staffLoginMessage);
  const verificationUnavailable = [
    'SESSION_VERIFICATION_INCONCLUSIVE',
    'ACTOR_RUNTIME_RESTORE_FAILED'
  ].includes(staffLoginError?.code);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const canRecoverAdmin = licenseDetails?.device_mode === 'staff_only'
    && isProLicense(licenseDetails) && !verificationUnavailable && !isLoggingOut;
  const licenseAuthority = classifyActorAuthorityError(licenseDetails);
  const authorityRecoveryMessage = actorAuthorityRecovery?.actorType === 'staff'
    ? actorAuthorityRecovery.message
    : licenseAuthority?.kind === 'device_blocked'
      ? licenseAuthority.message
      : '';
  const licenseKey = useAppStore((state) => state.staffLoginLicenseKey || state.licenseDetails?.license_key);
  const staffAlreadyInUse = staffLoginError?.code === 'STAFF_ALREADY_IN_USE';
  const staffLoginNotice = !verificationUnavailable && !staffAlreadyInUse && !staffLoginError && !errorMessage
    ? [
      authorityRecoveryMessage,
      [
        STAFF_SESSION_CLOSED_MESSAGE,
        STAFF_SESSION_CLOSED_REMOTE_CONFIRMED_MESSAGE,
        STAFF_SESSION_CLOSED_REMOTE_NOT_ATTEMPTED_MESSAGE,
        STAFF_SESSION_CLOSED_REMOTE_UNCONFIRMED_MESSAGE
      ].includes(staffLoginMessage) ? staffLoginMessage : '',
      staffLoginMessage === STAFF_ONLY_MODE_LOGIN_MESSAGE || licenseDetails?.device_mode === 'staff_only'
        ? STAFF_ONLY_MODE_LOGIN_MESSAGE : '',
      staffLoginMessage === STAFF_DEVICE_AUTH_MESSAGE ? STAFF_DEVICE_AUTH_MESSAGE : ''
    ].filter((message, index, messages) => message && messages.indexOf(message) === index).join(' ')
    : '';
  const canSwitchAccess = licenseDetails?.staff_access_available === true
    || licenseDetails?.features?.staff_roles === true;
  const staffAlreadyInUseMessage = 'Esta cuenta ya está activa en otro dispositivo.';
  const verificationStatusMessage = staffLoginError?.verificationStatus === 'transport_unavailable'
    ? 'No pudimos comprobar la sesión guardada porque no hubo respuesta del servidor. Puedes volver a intentarlo cuando tengas conexión.'
    : staffLoginError?.verificationStatus === 'server_error'
      ? 'El servidor no pudo completar la verificación. Tus datos locales permanecen protegidos; inténtalo de nuevo más tarde.'
      : 'No pudimos confirmar la sesión guardada. Tus datos locales permanecen protegidos; vuelve a intentar la verificación.';

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!isOnline) {
      setErrorMessage('Necesitas internet para iniciar sesión staff.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const result = await handleStaffLogin({
        username: username.trim(),
        password
      });
      if (!result?.success) {
        setErrorMessage(result?.code === 'STAFF_ALREADY_IN_USE' ? '' : describeStaffLoginError(result));
      }
    } catch (error) {
      setErrorMessage(describeStaffLoginError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const retrySessionVerification = async () => {
    if (isLoading || !isOnline) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      await initializeApp();
    } catch {
      setErrorMessage('No se pudo reintentar la verificación. Comprueba la conexión y vuelve a intentarlo.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdminRecovery = async (event) => {
    event.preventDefault();
    if (!isOnline) {
      setRecoveryError('La recuperación administrativa requiere conexión al servidor.');
      return;
    }

    setIsLoading(true);
    setRecoveryError('');
    try {
      const result = await handleAdminLogin({
        username: recoveryUsername.trim(),
        password: recoveryPassword,
        recoverFromStaffOnlyDevice: true
      });
      if (result?.success) {
        setRecoveryPassword('');
        setRecoveryUsername('');
        return;
      }
      setRecoveryError(result?.message || 'No se pudo recuperar el acceso administrativo. Comprueba la conexión e inténtalo de nuevo.');
    } catch {
      setRecoveryError('No se pudo confirmar la recuperación. Comprueba la conexión e inténtalo de nuevo con las credenciales del propietario.');
    } finally {
      setRecoveryPassword('');
      setIsLoading(false);
    }
  };

  const cancelAdminRecovery = () => {
    setIsRecoveryOpen(false);
    setRecoveryPassword('');
    setRecoveryError('');
  };

  return (
    <AuthPageLayout
      footer={(
        <AuthPageFooter screen="Acceso Staff">
          {canSwitchAccess && (
            <>
              <button
                type="button"
                className="auth-page__footer-link"
                onClick={returnToLicenseAccessChoice}
                disabled={isLoading || isLoggingOut}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                Cambiar perfil
              </button>
              <span className="auth-page__footer-separator" aria-hidden="true">·</span>
            </>
          )}
          <button type="button" className="auth-page__footer-link" onClick={logout} disabled={isLoading || isLoggingOut}>
            Cambiar licencia
          </button>
          <span className="auth-page__footer-separator" aria-hidden="true">·</span>
        </AuthPageFooter>
      )}
    >
      <section className="staff-login-panel" aria-labelledby="staff-login-title">
        <div className="auth-login-topline staff-login-topline">
          <span className="auth-login-step">Acceso al negocio</span>
          <span className="auth-login-role staff-login-role">
            <span className="auth-login-role__dot" aria-hidden="true" />
            Personal / Staff
          </span>
        </div>

        <LicenseContextSummary
          licenseDetails={licenseDetails}
          licenseKey={licenseKey}
          businessName={companyProfile?.business_name || companyProfile?.name || ''}
          showBusiness
        />

        <div className="staff-login-brand">
          <span className="staff-login-icon" aria-hidden="true">
            <LockKeyhole size={26} strokeWidth={2.2} />
          </span>
          <div>
            <h1 id="staff-login-title">Ingresar como personal</h1>
            <p id="staff-login-description">
              {verificationUnavailable
                ? 'La sesión guardada necesita una nueva verificación segura.'
                : 'Ingresa con el usuario asignado por el administrador.'}
            </p>
          </div>
        </div>

        <p className="staff-login-helper">
          {verificationUnavailable
            ? 'El acceso permanece protegido mientras Lanzo intenta confirmar la sesión existente.'
            : 'Usa tu cuenta personal para entrar sólo a las funciones permitidas para tu puesto.'}
        </p>

        {staffLoginNotice && (
          <div className="staff-login-note ui-alert ui-alert--info" role="status">
            {staffLoginNotice}
          </div>
        )}

        {!isOnline && (
          <div className="staff-login-alert ui-alert ui-alert--danger" role="status">
            <WifiOff size={18} aria-hidden="true" />
            <span>{verificationUnavailable
              ? 'Necesitas conexión para verificar la sesión staff guardada.'
              : 'El acceso staff requiere conexión a internet.'}</span>
          </div>
        )}

        {staffAlreadyInUse && (
          <div className="staff-login-warning ui-alert ui-alert--warning" role="alert">
            <div className="staff-login-warning-header">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>{staffAlreadyInUseMessage || 'Este usuario staff ya está activo en otro dispositivo.'}</span>
            </div>
            {staffLoginError?.active_device_name && (
              <div className="staff-login-warning-device">
                <span>Dispositivo activo:</span>
                <strong>{staffLoginError.active_device_name}</strong>
              </div>
            )}
            <p>Pide al administrador liberar el dispositivo anterior o desactivar/reactivar tu usuario staff.</p>
          </div>
        )}

        {verificationUnavailable ? (
          <div className="staff-login-form" aria-busy={isLoading || isLoggingOut}>
            <div className="staff-login-note ui-alert ui-alert--info" role="status" aria-live="polite">
              {isLoggingOut
                ? 'Cerrando la sesión Staff anterior.'
                : isLoading
                ? 'Estamos verificando la sesión staff guardada.'
                : verificationStatusMessage}
            </div>
            {errorMessage && (
              <div className="staff-login-error ui-alert ui-alert--danger" role="alert">
                {errorMessage}
              </div>
            )}
            <button
              type="button"
              className="ui-button ui-button--primary staff-login-submit"
              onClick={retrySessionVerification}
              disabled={isLoading || isLoggingOut || !isOnline}
            >
              {isLoading ? 'Verificando sesión...' : 'Reintentar verificación'}
            </button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="staff-login-form" aria-busy={isLoading || isLoggingOut}>
          <div className="staff-login-field form-group">
            <label className="form-label" htmlFor="staff-username">Usuario</label>
            <input
              id="staff-username"
              className="form-input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              disabled={isLoading || isLoggingOut || !isOnline}
              required
            />
          </div>

          <PasswordField
            id="staff-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isLoading || isLoggingOut || !isOnline}
            fieldClassName="staff-login-field form-group"
            labelClassName="form-label"
          />

          {errorMessage && (
            <div className="staff-login-error ui-alert ui-alert--danger" role="alert">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            className="ui-button ui-button--primary staff-login-submit"
            disabled={isLoading || isLoggingOut || !isOnline || !username.trim() || !password}
          >
            <LogIn size={18} aria-hidden="true" />
            {isLoggingOut ? 'Cerrando sesión...' : isLoading ? 'Verificando...' : 'Entrar'}
          </button>
        </form>
        )}

        {canRecoverAdmin && (
          <section className="staff-admin-recovery" aria-labelledby="staff-admin-recovery-title">
            {!isRecoveryOpen ? (
              <button
                type="button"
                className="staff-admin-recovery__trigger"
                onClick={() => {
                  setRecoveryError('');
                  setIsRecoveryOpen(true);
                }}
                disabled={isLoading || isLoggingOut}
              >
                <KeyRound size={17} aria-hidden="true" />
                Recuperar acceso administrativo
              </button>
            ) : (
              <form onSubmit={handleAdminRecovery} className="staff-admin-recovery__form" aria-busy={isLoading || isLoggingOut}>
                <div>
                  <h2 id="staff-admin-recovery-title">Recuperar acceso administrativo</h2>
                  <p>
                    Esta acción requiere el usuario y la contraseña del propietario. Si el servidor los valida,
                    este dispositivo cambiará a Solo Admin y cerrará las sesiones Staff de este dispositivo.
                    Requiere conexión y conserva los datos locales pendientes.
                  </p>
                </div>
                {!isOnline && (
                  <div className="ui-alert ui-alert--danger" role="status">
                    <WifiOff size={17} aria-hidden="true" />
                    La recuperación administrativa requiere conexión al servidor.
                  </div>
                )}
                <div className="staff-login-field form-group">
                  <label className="form-label" htmlFor="admin-recovery-username">Usuario del propietario</label>
                  <input
                    id="admin-recovery-username"
                    className="form-input"
                    value={recoveryUsername}
                    onChange={(event) => setRecoveryUsername(event.target.value)}
                    autoComplete="username"
                    disabled={isLoading || isLoggingOut || !isOnline}
                    required
                  />
                </div>
                <PasswordField
                  id="admin-recovery-password"
                  value={recoveryPassword}
                  onChange={(event) => setRecoveryPassword(event.target.value)}
                  disabled={isLoading || isLoggingOut || !isOnline}
                  fieldClassName="staff-login-field form-group"
                  labelClassName="form-label"
                  label="Contraseña del propietario"
                />
                {recoveryError && (
                  <div className="staff-login-error ui-alert ui-alert--danger" role="alert">
                    {recoveryError}
                  </div>
                )}
                <div className="staff-admin-recovery__actions">
                  <button
                    type="button"
                    className="ui-button ui-button--secondary"
                    onClick={cancelAdminRecovery}
                    disabled={isLoading || isLoggingOut}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="ui-button ui-button--primary"
                    disabled={isLoading || isLoggingOut || !isOnline || !recoveryUsername.trim() || !recoveryPassword}
                  >
                    {isLoading ? 'Verificando propietario...' : 'Cambiar a Solo Admin'}
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

      </section>
    </AuthPageLayout>
  );
}
