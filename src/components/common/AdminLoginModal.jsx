import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, LogIn, ShieldCheck, WifiOff } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { classifyDatabaseError } from '../../services/db/databaseRecoveryState';
import { classifyActorAuthorityError } from '../../services/auth/actorAuthorityErrors';
import AuthPageLayout, { AuthPageFooter } from './AuthPageLayout';
import LicenseContextSummary from './LicenseContextSummary';
import PasswordField from './PasswordField';
import { markFreeDeviceTakeoverCompleted } from '../../hooks/usePostDowngradeCashPending';
import AdminAccountRecovery from './AdminAccountRecovery';
import { APP_VERSION_LABEL } from '../../config/appVersion';
import { copyTextToClipboard } from '../../services/support/supportContact';
import { readProtectedCheckoutDiagnosis } from '../../services/diagnostics/protectedCheckoutDiagnosis';
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
const LOCAL_PLAN_OWNER_MESSAGE = 'Tu plan cambió a Lanzo Local. Inicia sesión como propietario para usar este dispositivo.';

// The store can receive arbitrary server/exception messages. Publish only
// explicitly reviewed error identifiers, never messages, token-like strings,
// actor IDs, session IDs, license keys or checkout row details.
const SAFE_RECOVERY_REASON_CODES = new Set([
  'ACTOR_HANDOFF_CHECKOUT_OWNED',
  'ACTOR_HANDOFF_PENDING_OPERATIONS',
  'ACTOR_SESSION_AMBIGUOUS',
  'ACTOR_SESSION_REQUIRED',
  'ACTOR_CONTEXT_STALE',
  'ACTOR_CONTEXT_LOCKED',
  'ACTOR_HANDOFF_REQUIRED',
  'ACTOR_IDENTITY_INVALID',
  'ACTOR_TENANT_NOT_READY',
  'ACTOR_TENANT_MISMATCH',
  'ACTOR_DEVICE_REQUIRED',
  'ACTOR_RUNTIME_RESTORE_FAILED',
  'ACTOR_SESSION_RESTORE_FAILED',
  'SESSION_VERIFICATION_CONTEXT_STALE'
]);
const SAFE_RECOVERY_VERIFICATION_STATES = new Set([
  'verified', 'transport_unavailable', 'server_error', 'invalid_response',
  'authoritative_denial', 'local_storage_error', 'local_credentials_missing'
]);
const safeRecoveryReason = value => SAFE_RECOVERY_REASON_CODES.has(value)
  ? value : 'NO_CLASIFICADO';
const safeVerificationState = value => SAFE_RECOVERY_VERIFICATION_STATES.has(value)
  ? value : 'NO_CLASIFICADO';

const LOCK_OWNER_LABELS = Object.freeze({
  matching_admin: 'Coincide con Admin verificado',
  other_admin: 'Otro Admin',
  staff: 'Staff',
  no_owner_proof: 'Sin propietario verificable',
  unrecognized_owner: 'Propietario no reconocible'
});
const LOCAL_SALE_LABELS = Object.freeze({
  open: 'Abierto',
  closed: 'Cerrado localmente',
  cancelled: 'Cancelado localmente',
  requires_review: 'Requiere revisión',
  unknown: 'No determinado'
});
const LOCAL_DIAG_CODES = new Set([
  'ADMIN_IDENTITY_UNAVAILABLE',
  'TENANT_RUNTIME_UNAVAILABLE',
  'ACTOR_CONTEXT_CHANGED',
  'CONTEXT_CHANGED_DURING_READ',
  'LOCAL_READ_UNAVAILABLE',
  'VERIFICATION_NOT_CURRENT'
]);
const safeLockOwner = value => Object.hasOwn(LOCK_OWNER_LABELS, value)
  ? LOCK_OWNER_LABELS[value] : 'No clasificable';
const safeLocalSaleState = value => Object.hasOwn(LOCAL_SALE_LABELS, value)
  ? LOCAL_SALE_LABELS[value] : 'No determinado';
const safeLocalDiagCode = value => LOCAL_DIAG_CODES.has(value) ? value : 'LOCAL_READ_UNAVAILABLE';



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
  if (!navigator.onLine) return 'Necesitas conexión para iniciar sesión.';
  return 'No se pudo confirmar el resultado de la acción. Revisa las operaciones locales pendientes antes de volver a intentarla.';
};

export default function AdminLoginModal() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const [diagnosticCopyStatus, setDiagnosticCopyStatus] = useState('');
  const [localLockDiagnosis, setLocalLockDiagnosis] = useState(null);
  const [localInspectionBusy, setLocalInspectionBusy] = useState(false);
  const [accountRecovery, setAccountRecovery] = useState(false);
  const [takeoverRequired, setTakeoverRequired] = useState(false);
  const usernameRef = useRef(null);
  const takeoverButtonRef = useRef(null);
  const takeoverFocusHandledRef = useRef(false);
  const busyRef = useRef(false);
  const recoveryButtonRef = useRef(null);
  const localInspectionGeneration = useRef(0);
  const previousRecoveryRef = useRef(false);
  const handleAdminLogin = useAppStore((state) => state.handleAdminLogin);
  const handleFreeDeviceTakeover = useAppStore((state) => state.handleFreeDeviceTakeover);
  const resumeAdminSessionPreparation = useAppStore((state) => state.resumeAdminSessionPreparation);
  const initializeApp = useAppStore((state) => state.initializeApp);
  const recoveryAvailable = useAppStore((state) => Boolean(state.pendingAdminSessionResult?.result?.success));
  const adminLoginMessage = useAppStore((state) => state.adminLoginMessage);
  const adminLoginError = useAppStore((state) => state.adminLoginError);
  const actorAuthorityRecovery = useAppStore((state) => state.actorAuthorityRecovery);
  const actorRuntimeRestoreFailed = adminLoginError?.code === 'ACTOR_RUNTIME_RESTORE_FAILED';
  const offlineEvidencePending = adminLoginError?.code === 'ADMIN_OFFLINE_EVIDENCE_PENDING';
  const verificationRecoveryRequired = actorRuntimeRestoreFailed || offlineEvidencePending;
  const recoveryReason = safeRecoveryReason(adminLoginError?.reasonCode);
  const recoveryVerification = safeVerificationState(adminLoginError?.verificationStatus);
  const isProtectedCheckoutRejection = actorRuntimeRestoreFailed && recoveryReason === 'ACTOR_HANDOFF_CHECKOUT_OWNED';

  const verificationUnavailable = [
    'SESSION_VERIFICATION_INCONCLUSIVE',
    'ACTOR_RUNTIME_RESTORE_FAILED',
    'ADMIN_OFFLINE_EVIDENCE_PENDING'
  ].includes(adminLoginError?.code);
  const logout = useAppStore((state) => state.logout);
  const returnToLicenseAccessChoice = useAppStore((state) => state.returnToLicenseAccessChoice);
  const companyProfile = useAppStore((state) => state.companyProfile);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const licenseKey = useAppStore((state) => state.adminLoginLicenseKey || state.licenseDetails?.license_key);
  const canInspectLocalLocks = isProtectedCheckoutRejection && recoveryVerification === 'verified';
  const canSwitchAccess = licenseDetails?.staff_access_available === true
    || licenseDetails?.features?.staff_roles === true;
  const verificationStatusMessage = adminLoginError?.verificationStatus === 'transport_unavailable'
    ? 'No pudimos comprobar la sesión guardada porque no hubo respuesta del servidor. Puedes volver a intentarlo cuando tengas conexión.'
    : adminLoginError?.verificationStatus === 'server_error'
      ? 'El servidor no pudo completar la verificación. Tus datos locales permanecen protegidos; inténtalo de nuevo más tarde.'
      : actorRuntimeRestoreFailed
        ? 'La sesión se verificó, pero no pudimos restablecer una autoridad operativa segura. Reintenta la recuperación.'
        : offlineEvidencePending
          ? 'Tu sesión está verificada, pero necesitamos conexión para confirmar la evidencia guardada y restablecer el acceso de forma segura.'
          : 'No pudimos confirmar la sesión guardada. Tus datos locales permanecen protegidos; vuelve a intentar la verificación.';
  const verificationTitle = verificationRecoveryRequired ? 'Recupera tu sesión' : 'Verifica tu sesión';
  const verificationDescription = actorRuntimeRestoreFailed
    ? 'La sesión se verificó, pero el acceso no se pudo restablecer de forma segura.'
    : offlineEvidencePending
      ? 'Necesitamos confirmar la evidencia guardada antes de habilitar el acceso.'
      : 'La sesión guardada necesita una nueva verificación segura.';
  const verificationActionLabel = verificationRecoveryRequired ? 'Reintentar recuperación' : 'Reintentar verificación';
  const verificationLoadingLabel = verificationRecoveryRequired ? 'Recuperando sesión...' : 'Verificando sesión...';
  const authorityRecoveryMessage = actorAuthorityRecovery?.actorType === 'admin'
    ? actorAuthorityRecovery.message
    : '';
  const adminLoginNotice = !verificationUnavailable && !recoveryAvailable && !takeoverRequired && !error
    ? authorityRecoveryMessage || (adminLoginMessage === LOCAL_PLAN_OWNER_MESSAGE ? LOCAL_PLAN_OWNER_MESSAGE : '')
    : '';

  useEffect(() => {
    if (loading) return;
    if (recoveryAvailable) recoveryButtonRef.current?.focus();
    else if (previousRecoveryRef.current) usernameRef.current?.focus();
    previousRecoveryRef.current = recoveryAvailable;
  }, [recoveryAvailable, loading]);

  useEffect(() => {
    // Drop read-only results if this view changes to a new authority context.
    localInspectionGeneration.current += 1;
    setLocalLockDiagnosis(null);
    setLocalInspectionBusy(false);
  }, [canInspectLocalLocks, licenseKey]);

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

  const inspectLocalCheckoutLocks = async () => {
    if (localInspectionBusy || !canInspectLocalLocks) return;
    const request = ++localInspectionGeneration.current;
    setLocalInspectionBusy(true);
    setLocalLockDiagnosis(null);
    setDiagnosticCopyStatus('');
    try {
      const before = useAppStore.getState();
      const hasVerifiedRecovery = before.appStatus === 'admin_login_required'
        && before.currentDeviceRole === 'admin'
        && before.adminLoginError?.code === 'ACTOR_RUNTIME_RESTORE_FAILED'
        && before.adminLoginError?.reasonCode === 'ACTOR_HANDOFF_CHECKOUT_OWNED'
        && before.adminLoginError?.verificationStatus === 'verified';
      const result = hasVerifiedRecovery
        ? await readProtectedCheckoutDiagnosis({ verifiedAdminActor: before.licenseDetails?.admin_user })
        : { status: 'unavailable', code: 'VERIFICATION_NOT_CURRENT' };
      const after = useAppStore.getState();
      if (request !== localInspectionGeneration.current) return;
      if (before.licenseDetails !== after.licenseDetails || before.adminLoginError !== after.adminLoginError
          || after.appStatus !== 'admin_login_required' || after.currentDeviceRole !== 'admin') {
        setLocalLockDiagnosis({ status: 'unavailable', code: 'VERIFICATION_NOT_CURRENT' });
      } else {
        setLocalLockDiagnosis(result);
      }
    } catch {
      if (request === localInspectionGeneration.current) {
        setLocalLockDiagnosis({ status: 'unavailable', code: 'LOCAL_READ_UNAVAILABLE' });
      }
    } finally {
      if (request === localInspectionGeneration.current) setLocalInspectionBusy(false);
    }
  };

  const copyRecoveryDiagnostic = async () => {
    setDiagnosticCopyStatus('');
    const report = [
      'LANZO POS — Diagnóstico de recuperación de Admin',
      `Versión: ${APP_VERSION_LABEL}`,
      'Código: ACTOR_RUNTIME_RESTORE_FAILED',
      `Motivo: ${recoveryReason}`,
      `Verificación: ${recoveryVerification}`,
      `Conexión: ${online ? 'Online' : 'Offline'}`,
      ...(localLockDiagnosis?.status === 'ready' ? [
        `Bloqueos locales: ${localLockDiagnosis.total}`,
        ...localLockDiagnosis.entries.map((item, index) =>
          `Registro ${index + 1}: propietario=${safeLockOwner(item.owner)}; estado local=${safeLocalSaleState(item.localStatus)}; intento registrado=${item.attemptMarked === true ? 'sí' : 'no'}; resultado financiero=no verificable`),
        ...(localLockDiagnosis.truncated ? ['Hay más bloqueos no detallados en este diagnóstico.'] : [])
      ] : [`Inspección local: ${localLockDiagnosis ? safeLocalDiagCode(localLockDiagnosis.code) : 'NO_EJECUTADA'}`]),
      'La lectura local no demuestra si un pago se realizó ni permite liberar cobros.',
      'Los datos de ventas y cobros no se han modificado.',
      'Sin credenciales, identificadores de licencia, negocio, dispositivo, usuario ni detalles de operaciones.'
    ].join('\n');
    const copied = await copyTextToClipboard(report);
    setDiagnosticCopyStatus(copied ? 'Diagnóstico copiado' : 'No se pudo copiar. Puedes compartir los códigos que aparecen en pantalla.');
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
    <AuthPageLayout
      contentClassName={accountRecovery ? 'auth-page__content--wide' : ''}
      footer={!accountRecovery && (
        <AuthPageFooter screen="Acceso administrador">
          {!takeoverRequired && (
            <>
              {canSwitchAccess && (
                <>
                  <button
                    type="button"
                    className="auth-page__footer-link"
                    onClick={returnToLicenseAccessChoice}
                    disabled={loading}
                  >
                    <ArrowLeft size={15} aria-hidden="true" />
                    Cambiar perfil
                  </button>
                  <span className="auth-page__footer-separator" aria-hidden="true">·</span>
                </>
              )}
              <button type="button" className="auth-page__footer-link" onClick={logout} disabled={loading}>
                Cambiar licencia
              </button>
              <span className="auth-page__footer-separator" aria-hidden="true">·</span>
            </>
          )}
        </AuthPageFooter>
      )}
    >
      <section
        className="admin-auth-panel admin-auth-panel--login"
        aria-labelledby={accountRecovery ? 'account-recovery-title' : 'admin-login-title'}
      >
        <div className="auth-login-topline">
          <span className="auth-login-step">Acceso al negocio</span>
          <span className="auth-login-role auth-login-role--admin">
            <span className="auth-login-role__dot" aria-hidden="true" />
            Administrador
          </span>
        </div>

        <LicenseContextSummary
          licenseDetails={licenseDetails}
          licenseKey={licenseKey}
          businessName={companyProfile?.business_name || companyProfile?.name || ''}
          showBusiness
        />

        {accountRecovery ? <AdminAccountRecovery key={licenseKey} licenseKey={licenseKey} online={online}
          onBack={() => setAccountRecovery(false)}
          onRecovered={(recoveredUsername) => {
            setUsername(recoveredUsername); setPassword(''); setError(''); setAccountRecovery(false);
            if (window.requestAnimationFrame) window.requestAnimationFrame(() => usernameRef.current?.focus());
          }} /> : <>
        <div className="admin-auth-heading">
          <span className="admin-auth-heading__icon" aria-hidden="true">
            <ShieldCheck size={27} strokeWidth={2.2} />
          </span>
          <div>
            <h1 id="admin-login-title">
        {takeoverRequired ? 'Tu plan cambió a Lanzo Local'
          : verificationUnavailable ? verificationTitle
            : 'Ingresar como administrador'}
            </h1>
            <p id="admin-login-description">
              {takeoverRequired
                ? 'El propietario puede elegir el dispositivo que tiene delante.'
              : verificationUnavailable
                ? verificationDescription
                : 'Ingresa con la cuenta del propietario.'}
            </p>
          </div>
        </div>

        <p className="auth-login-helper">
          {takeoverRequired
            ? 'Lanzo Local permite utilizar un dispositivo.'
            : verificationUnavailable
              ? actorRuntimeRestoreFailed
                ? 'El acceso permanece protegido mientras Lanzo intenta restablecer la sesión.'
                : offlineEvidencePending
                  ? 'Conéctate a internet y vuelve a intentar la recuperación.'
                  : 'El acceso permanece protegido mientras Lanzo intenta confirmar la sesión existente.'
              : 'Usa tus credenciales de administración para continuar con todos los permisos del negocio.'}
        </p>

        {adminLoginNotice && (
          <div className="ui-alert ui-alert--info" role="status">
            {adminLoginNotice}
          </div>
        )}

        {!online && !recoveryAvailable && (
          <div className={`ui-alert ${verificationUnavailable ? 'ui-alert--info' : 'ui-alert--danger'}`} role="status">
            <WifiOff size={18} aria-hidden="true" />
            {verificationUnavailable
              ? 'Sin conexión, Lanzo solo restaurará la sesión si la evidencia local vigente lo permite.'
              : 'Necesitas internet para iniciar sesión.'}
          </div>
        )}
        {recoveryAvailable ? (
          <div className="admin-auth-form" aria-busy={loading}>
            <div className="ui-alert ui-alert--info" role="status" aria-live="polite">
              {loading ? 'Estamos recuperando tu sesión de forma segura.'
                : verificationUnavailable
                  ? verificationStatusMessage
                  : 'Tu sesión está verificada. No pudimos terminar de preparar Lanzo. Reintenta la carga para continuar sin iniciar sesión nuevamente.'}
            </div>
            {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
            <button type="button" ref={recoveryButtonRef}
              className="ui-button ui-button--primary admin-auth-submit"
              onClick={retryPreparation} disabled={loading}>
              {loading
                ? verificationUnavailable ? verificationLoadingLabel : 'Recuperando sesión...'
                : verificationUnavailable ? verificationActionLabel : 'Reintentar carga'}
            </button>
          </div>
        ) : verificationUnavailable ? (
          <div className="admin-auth-form" aria-busy={loading}>
            <div className="ui-alert ui-alert--info" role="status" aria-live="polite">
              {loading
                ? verificationRecoveryRequired ? 'Estamos recuperando la sesión de forma segura.' : 'Estamos verificando la sesión guardada.'
                : verificationStatusMessage}
            </div>
            {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
            <button type="button" ref={recoveryButtonRef}
              className="ui-button ui-button--primary admin-auth-submit"
              onClick={retryPreparation} disabled={loading}>
              {loading ? verificationLoadingLabel : verificationActionLabel}
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
            <button type="button" className="admin-auth-recovery-link" disabled={loading}
              onClick={() => { setAccountRecovery(true); setPassword(''); setError(''); }}>
              ¿Olvidaste tus datos de acceso?
            </button>
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

        {actorRuntimeRestoreFailed && (
          <div className="admin-auth-diagnostic" aria-label="Diagnóstico seguro de recuperación">
            <p className="admin-auth-diagnostic__title">Diagnóstico de acceso</p>
            <p><strong>Código:</strong> <code>ACTOR_RUNTIME_RESTORE_FAILED</code></p>
            <p><strong>Motivo:</strong> <code>{recoveryReason}</code></p>
            {isProtectedCheckoutRejection && (
              <p>Hay cobros protegidos de otra sesión o sin propietario verificable. No se liberarán ni repetirán.</p>
            )}
            {canInspectLocalLocks && (
              <>
                <button type="button" className="admin-auth-recovery-link"
                  disabled={localInspectionBusy || loading}
                  onClick={() => { void inspectLocalCheckoutLocks(); }}>
                  {localInspectionBusy ? 'Inspeccionando…' : 'Inspeccionar bloqueos locales'}
                </button>
                {localInspectionBusy && <p role="status">Consultando registros locales sin modificarlos…</p>}
                {localLockDiagnosis?.status === 'ready' && (
                  <div role="status" aria-label="Resultado de la inspección local">
                    <p><strong>Bloqueos guardados:</strong> {localLockDiagnosis.total}</p>
                    {localLockDiagnosis.entries.map((item, index) => (
                      <p key={index}>
                        <strong>Registro {index + 1}:</strong>{' '}
                        {safeLockOwner(item.owner)} · {safeLocalSaleState(item.localStatus)}
                        {' · '}Intento registrado: {item.attemptMarked === true ? 'Sí' : 'No'}
                      </p>
                    ))}
                    {localLockDiagnosis.truncated && <p>Hay más registros protegidos no detallados.</p>}
                    <p>Resultado financiero: no verificable solo con la información local. No se ha liberado ningún cobro.</p>
                  </div>
                )}
                {localLockDiagnosis?.status === 'unavailable' && (
                  <p role="status">No fue posible realizar la lectura segura ({safeLocalDiagCode(localLockDiagnosis.code)}). Los datos siguen protegidos.</p>
                )}
              </>
            )}
            <button type="button" className="admin-auth-recovery-link" onClick={() => { void copyRecoveryDiagnostic(); }}>
              <Copy size={16} aria-hidden="true" /> Copiar diagnóstico
            </button>
            {diagnosticCopyStatus && <p role="status">{diagnosticCopyStatus}</p>}
          </div>
        )}

        </>}
      </section>
    </AuthPageLayout>
  );
}
