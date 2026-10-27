import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, LogIn, ShieldCheck, WifiOff } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { classifyDatabaseError } from '../../services/db/databaseRecoveryState';
import { classifyActorAuthorityError } from '../../services/auth/actorAuthorityErrors';
import LicenseContextSummary from './LicenseContextSummary';
import PasswordField from './PasswordField';
import { markFreeDeviceTakeoverCompleted } from '../../hooks/usePostDowngradeCashPending';
import './AdminAuthModal.css';

const SAFE_AUTH_ERROR_MESSAGES = Object.freeze({
  INVALID_ADMIN_CREDENTIALS: 'Usuario o contraseña incorrectos.',
  INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos.',
  ONLINE_REQUIRED: 'Necesitas internet para completar esta acción.',
  ADMIN_LOGIN_RATE_LIMITED: 'Se realizaron demasiados intentos. Espera un momento y vuelve a intentar.',
  LICENSE_NOT_ACTIVE: 'Esta licencia no está activa. Revisa su estado antes de continuar.',
  DEVICE_LIMIT_REACHED: 'Se alcanzó el límite de dispositivos de esta licencia.',
  DEVICE_MODE_ADMIN_NOT_ALLOWED: 'Este dispositivo no está habilitado para el acceso del propietario.',
  FREE_DEVICE_TAKEOVER_NOT_ALLOWED: 'No se pudo recuperar este dispositivo con el cambio de plan actual. Inicia sesión nuevamente.',
  FREE_DEVICE_TAKEOVER_REQUIRED: 'Confirma el cambio para usar este dispositivo.',
  ADMIN_SESSION_REQUIRED: 'Inicia sesión nuevamente para continuar.',
  ADMIN_SESSION_INVALID: 'La sesión administrativa ya no es válida. Inicia sesión nuevamente.',
  ADMIN_AUTH_IN_PROGRESS: 'Estamos recuperando tu sesión de forma segura.'
});

const describeLoginError = (error, result = null) => {
  const code = result?.code || error?.code || null;
  const classification = classifyDatabaseError(error || result);

  if (result?.recoveryRequired) {
    return 'Tu sesión se verificó correctamente, pero no pudimos terminar de preparar Lanzo. Puedes reintentar la carga sin volver a registrar tu dispositivo.';
  }
  if (SAFE_AUTH_ERROR_MESSAGES[code]) return SAFE_AUTH_ERROR_MESSAGES[code];
  if (String(code || '').startsWith('ACTOR_') || code === 'ADMIN_RECOVERY_REJECTED') {
    return 'No pudimos recuperar tu sesión de forma segura. Inicia sesión nuevamente para continuar.';
  }
  const authority = classifyActorAuthorityError(error || result);
  if (authority) return authority.message;
  if (code === 'DB_BLOCKED' || classification.code === 'DB_BLOCKED') {
    return 'La base local está abierta en otra pestaña. Cierra las demás pestañas de Lanzo y vuelve a intentarlo.';
  }
  if (
    code === 'DB_PRIMARY_KEY_MISMATCH'
    || code === 'DB_CLOSED_AFTER_STRUCTURAL_ERROR'
    || classification.requiresMigration
  ) {
    return 'El esquema local requiere actualización. Se detuvo el inicio; verifica ventas e inventario después de la recuperación antes de continuar operando.';
  }
  if (code === 'DB_OPEN_TIMEOUT' || error?.name === 'DatabaseOpenTimeoutError') {
    return 'La base local tardó demasiado en responder. Cierra otras pestañas de Lanzo y vuelve a intentarlo.';
  }
  if (code === 'DB_BROWSER_STORAGE_UNAVAILABLE') {
    return 'No se pudo abrir el almacenamiento local del navegador. Lanzo requiere IndexedDB para operar de forma segura. Cierra otras pestañas de Lanzo y vuelve a intentarlo.';
  }
  if (!navigator.onLine || /network|fetch|Failed to fetch/i.test(error?.message || result?.message || '')) {
    return 'No pudimos verificar tu acceso por un problema de conexión. Comprueba internet e inténtalo nuevamente.';
  }
  return 'No se pudo confirmar el resultado de la acción. Revisa las operaciones locales pendientes antes de volver a intentarla.';
};

export default function AdminLoginModal() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const [takeoverRequired, setTakeoverRequired] = useState(false);
  const usernameRef = useRef(null);
  const takeoverButtonRef = useRef(null);
  const takeoverFocusHandledRef = useRef(false);
  const busyRef = useRef(false);
  const recoveryButtonRef = useRef(null);
  const previousRecoveryRef = useRef(false);
  const handleAdminLogin = useAppStore((state) => state.handleAdminLogin);
  const handleFreeDeviceTakeover = useAppStore((state) => state.handleFreeDeviceTakeover);
  const resumeAdminSessionPreparation = useAppStore((state) => state.resumeAdminSessionPreparation);
  const initializeApp = useAppStore((state) => state.initializeApp);
  const recoveryAvailable = useAppStore((state) => Boolean(state.pendingAdminSessionResult?.result?.success));
  const adminLoginError = useAppStore((state) => state.adminLoginError);
  const verificationUnavailable = [
    'SESSION_VERIFICATION_INCONCLUSIVE',
    'ACTOR_RUNTIME_RESTORE_FAILED',
    'ADMIN_OFFLINE_EVIDENCE_PENDING'
  ].includes(adminLoginError?.code);
  const logout = useAppStore((state) => state.logout);
  const returnToLicenseAccessChoice = useAppStore((state) => state.returnToLicenseAccessChoice);
  const message = useAppStore((state) => state.adminLoginMessage);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const licenseKey = useAppStore((state) => state.adminLoginLicenseKey || state.licenseDetails?.license_key);
  const canSwitchAccess = licenseDetails?.staff_access_available === true
    || licenseDetails?.features?.staff_roles === true;

  useEffect(() => {
    if (loading) return;
    if (recoveryAvailable) recoveryButtonRef.current?.focus();
    else if (previousRecoveryRef.current) usernameRef.current?.focus();
    previousRecoveryRef.current = recoveryAvailable;
  }, [recoveryAvailable, loading]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!takeoverRequired) {
      takeoverFocusHandledRef.current = false;
      return;
    }

    // Wait until the confirmation can receive focus. Focus only once per
    // takeover prompt so reconnection never overrides user-selected focus.
    if (takeoverFocusHandledRef.current || loading || !online) return;
    const button = takeoverButtonRef.current;
    if (!button || button.disabled) return;

    const activeElement = document.activeElement;
    if (activeElement === document.body || !activeElement?.isConnected) {
      button.focus();
    }
    takeoverFocusHandledRef.current = true;
  }, [takeoverRequired, loading, online]);

  const submit = async (event) => {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError('');

    try {
      const result = await handleAdminLogin({ username: username.trim(), password });
      if (result?.code === 'FREE_DEVICE_TAKEOVER_REQUIRED' || result?.takeoverRequired === true) {
        setTakeoverRequired(true);
        setError('');
        return;
      }
      if (!result?.success) {
        if (!result?.recoveryRequired) setError(describeLoginError(null, result));
        return;
      }

    } catch (submitError) {
      setError(describeLoginError(submitError));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };

  const confirmTakeover = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError('');

    try {
      const result = await handleFreeDeviceTakeover({
        username: username.trim(),
        password
      });
      if (!result?.success) {
        if (!result?.recoveryRequired) setError(describeLoginError(null, result));
        return;
      }

      const completedState = useAppStore.getState();
      const completedLicenseKey = completedState?.licenseDetails?.license_key
        || completedState?.adminLoginLicenseKey;
      if (
        String(completedLicenseKey || '').trim() === String(licenseKey || '').trim() &&
        completedState?.currentDeviceRole === 'admin' &&
        completedState?.currentAdminUser?.is_owner === true
      ) {
        markFreeDeviceTakeoverCompleted({
          licenseKey: completedLicenseKey,
          adminUser: completedState.currentAdminUser
        });
      }
    } catch (takeoverError) {
      setError(describeLoginError(takeoverError));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };

  const retryPreparation = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError('');
    try {
      if (verificationUnavailable) {
        const result = await initializeApp();
        // initializeApp reports handled bootstrap outcomes by status. Only a
        // failed bootstrap needs an inline error; statuses such as ready,
        // login-required, and recovery-required are reflected by store state.
        if (result?.status === 'failed') {
          setError(describeLoginError(
            { code: result.code, message: result.error || result.message },
            { ...result, message: result.error || result.message }
          ));
        }
      } else {
        // Keep the PR #364 preparation retry contract unchanged.
        const result = await resumeAdminSessionPreparation();
        if (!result?.success && !result?.recoveryRequired) setError(describeLoginError(null, result));
      }
    } catch (recoveryError) {
      setError(describeLoginError(recoveryError));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };

  const cancelTakeover = () => {
    setTakeoverRequired(false);
    setPassword('');
    setError('');
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => usernameRef.current?.focus());
    } else {
      usernameRef.current?.focus();
    }
  };

  return (
    <div
      className="admin-auth-overlay admin-auth-overlay--login"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-login-title"
      aria-describedby="admin-login-description"
    >
      <section className="admin-auth-panel admin-auth-panel--login">
        <div className="auth-login-topline">
          <span className="auth-login-step">Acceso seguro</span>
          <span className="auth-login-role auth-login-role--admin">
            <span className="auth-login-role__dot" aria-hidden="true" />
            Administrador
          </span>
        </div>

        <LicenseContextSummary licenseDetails={licenseDetails} licenseKey={licenseKey} />

        <div className="admin-auth-heading">
          <span className="admin-auth-heading__icon" aria-hidden="true">
            <ShieldCheck size={27} strokeWidth={2.2} />
          </span>
          <div>
            <h1 id="admin-login-title">
        {takeoverRequired ? 'Tu plan cambió a Lanzo Local'
          : verificationUnavailable ? 'Verifica tu sesión'
            : 'Acceso administrador'}
            </h1>
            <p id="admin-login-description">
              {takeoverRequired
                ? 'El propietario puede elegir el dispositivo que tiene delante.'
              : verificationUnavailable
                ? 'La sesión guardada necesita una nueva verificación segura.'
                : 'Ingresa con la cuenta del propietario.'}
            </p>
          </div>
        </div>

        <p className="auth-login-helper">
          {takeoverRequired
            ? 'Lanzo Local permite utilizar un dispositivo.'
            : verificationUnavailable
              ? 'El acceso permanece protegido mientras Lanzo intenta confirmar la sesión existente.'
              : 'Usa tus credenciales de administración para continuar con todos los permisos del negocio.'}
        </p>

        {!online && !recoveryAvailable && (
          <div className={`ui-alert ${verificationUnavailable ? 'ui-alert--info' : 'ui-alert--danger'}`} role="status">
            <WifiOff size={18} aria-hidden="true" />
            {verificationUnavailable
              ? 'Sin conexión, Lanzo solo restaurará la sesión si la evidencia local vigente lo permite.'
              : 'Necesitas internet para iniciar sesión.'}
          </div>
        )}
        {message && !verificationUnavailable && !error && !recoveryAvailable && (
          <div className="ui-alert ui-alert--info" role="status">{message}</div>
        )}

        {recoveryAvailable ? (
          <div className="admin-auth-form" aria-busy={loading}>
            <div className="ui-alert ui-alert--info" role="status" aria-live="polite">
              {loading ? 'Estamos recuperando tu sesión de forma segura.'
                : verificationUnavailable
                  ? (message || 'No pudimos verificar tu sesión guardada. Tus datos locales se mantienen protegidos; reintenta cuando regrese la conexión.')
                  : 'Tu sesión está verificada. No pudimos terminar de preparar Lanzo. Reintenta la carga para continuar sin iniciar sesión nuevamente.'}
            </div>
            {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
            <button type="button" ref={recoveryButtonRef}
              className="ui-button ui-button--primary admin-auth-submit"
              onClick={retryPreparation} disabled={loading}>
              {loading
                ? verificationUnavailable ? 'Verificando sesión...' : 'Recuperando sesión...'
                : verificationUnavailable ? 'Reintentar verificación' : 'Reintentar carga'}
            </button>
          </div>
        ) : verificationUnavailable ? (
          <div className="admin-auth-form" aria-busy={loading}>
            <div className="ui-alert ui-alert--info" role="status" aria-live="polite">
              {loading ? 'Estamos verificando la sesión guardada.'
                : message || 'No pudimos verificar tu sesión. Tus datos locales se mantienen protegidos.'}
            </div>
            {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
            <button type="button" ref={recoveryButtonRef}
              className="ui-button ui-button--primary admin-auth-submit"
              onClick={retryPreparation} disabled={loading}>
              {loading ? 'Verificando sesión...' : 'Reintentar verificación'}
            </button>
          </div>
        ) : takeoverRequired ? (
          <div className="admin-auth-form" aria-busy={loading}>
            <div className="ui-alert ui-alert--info" role="status">
              Actualmente hay otro dispositivo registrado como activo.
            </div>
            <p className="auth-login-helper">
              Puedes utilizar este dispositivo. Al continuar, se cerrarán las sesiones activas
              en los demás dispositivos. Confirma que no haya operaciones locales pendientes y
              revisa las ventas antes de continuar operando en este equipo.
            </p>
            {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
            <button
              type="button"
              ref={takeoverButtonRef}
              className="ui-button ui-button--primary admin-auth-submit"
              onClick={confirmTakeover}
              disabled={loading || !online}
            >
              <ShieldCheck size={18} aria-hidden="true" />
              {loading ? 'Recuperando...' : 'Usar este dispositivo'}
            </button>
            <button
              type="button"
              className="ui-button ui-button--ghost"
              onClick={cancelTakeover}
              disabled={loading}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="admin-auth-form" aria-busy={loading}>
            <label className="admin-auth-field" htmlFor="admin-username">
              Usuario
              <input
                id="admin-username"
                ref={usernameRef}
                className="form-input"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                disabled={loading || !online}
              />
            </label>
            <PasswordField
              id="admin-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading || !online}
              fieldClassName="admin-auth-field"
            />
            {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
            <button
              type="submit"
              className="ui-button ui-button--primary admin-auth-submit"
              disabled={loading || !online || !username.trim() || !password}
            >
              <LogIn size={18} aria-hidden="true" />
              {loading ? 'Verificando...' : 'Entrar'}
            </button>
          </form>
        )}

        {!takeoverRequired && (
          <div className="auth-modal-actions">
          {canSwitchAccess && (
            <button
              type="button"
              className="auth-mode-back-button"
              onClick={returnToLicenseAccessChoice}
              disabled={loading}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Elegir otro perfil
            </button>
          )}
          <button type="button" className="ui-button ui-button--ghost" onClick={logout} disabled={loading}>
            Cambiar licencia
          </button>
          </div>
        )}
      </section>
    </div>
  );
}
