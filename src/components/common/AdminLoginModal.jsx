import { useEffect, useState } from 'react';
import { ArrowLeft, LogIn, ShieldCheck, WifiOff } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { classifyDatabaseError } from '../../services/db/databaseRecoveryState';
import LicenseContextSummary from './LicenseContextSummary';
import PasswordField from './PasswordField';
import './AdminAuthModal.css';

const describeLoginError = (error, result = null) => {
  const code = result?.code || error?.code || null;
  const classification = classifyDatabaseError(error || result);

  if (code === 'INVALID_ADMIN_CREDENTIALS' || code === 'INVALID_CREDENTIALS') {
    return 'Usuario o contraseña incorrectos.';
  }
  if (code === 'DB_BLOCKED' || classification.code === 'DB_BLOCKED') {
    return 'La base local está abierta en otra pestaña. Cierra las demás pestañas de Lanzo y vuelve a intentarlo.';
  }
  if (
    code === 'DB_PRIMARY_KEY_MISMATCH'
    || code === 'DB_CLOSED_AFTER_STRUCTURAL_ERROR'
    || classification.requiresMigration
  ) {
    return 'Detectamos un esquema local antiguo. Lanzo conservará tus datos y preparará una migración segura.';
  }
  if (code === 'DB_OPEN_TIMEOUT' || error?.name === 'DatabaseOpenTimeoutError') {
    return 'La base local tardó demasiado en responder. Cierra otras pestañas de Lanzo y vuelve a intentarlo.';
  }
  if (code === 'DB_BROWSER_STORAGE_UNAVAILABLE') {
    return 'No se pudo abrir el almacenamiento local del navegador. Lanzo requiere IndexedDB para operar de forma segura. Cierra otras pestañas de Lanzo y vuelve a intentarlo.';
  }
  if (!navigator.onLine || /network|fetch|Failed to fetch/i.test(error?.message || result?.message || '')) {
    return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.';
  }
  return result?.message || error?.message || 'No se pudo iniciar sesión. Puedes volver a intentarlo.';
};

export default function AdminLoginModal() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const handleAdminLogin = useAppStore((state) => state.handleAdminLogin);
  const logout = useAppStore((state) => state.logout);
  const returnToLicenseAccessChoice = useAppStore((state) => state.returnToLicenseAccessChoice);
  const message = useAppStore((state) => state.adminLoginMessage);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const licenseKey = useAppStore((state) => state.adminLoginLicenseKey || state.licenseDetails?.license_key);
  const canSwitchAccess = licenseDetails?.staff_access_available === true
    || licenseDetails?.features?.staff_roles === true;

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

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await handleAdminLogin({ username: username.trim(), password });
      if (!result?.success) {
        setError(describeLoginError(null, result));
      }
    } catch (submitError) {
      setError(describeLoginError(submitError));
    } finally {
      setLoading(false);
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
            <h1 id="admin-login-title">Acceso administrador</h1>
            <p id="admin-login-description">Ingresa con la cuenta del propietario.</p>
          </div>
        </div>

        <p className="auth-login-helper">
          Usa tus credenciales de administración para continuar con todos los permisos del negocio.
        </p>

        {!online && (
          <div className="ui-alert ui-alert--danger" role="status">
            <WifiOff size={18} aria-hidden="true" />
            Necesitas internet para iniciar sesión.
          </div>
        )}
        {message && !error && (
          <div className="ui-alert ui-alert--info" role="status">{message}</div>
        )}

        <form onSubmit={submit} className="admin-auth-form" aria-busy={loading}>
          <label className="admin-auth-field" htmlFor="admin-username">
            Usuario
            <input
              id="admin-username"
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
      </section>
    </div>
  );
}
