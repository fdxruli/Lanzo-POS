import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, LockKeyhole, LogIn, WifiOff } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import LicenseContextSummary from './LicenseContextSummary';
import PasswordField from './PasswordField';
import './StaffLoginModal.css';

export default function StaffLoginModal() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [errorMessage, setErrorMessage] = useState('');

  const handleStaffLogin = useAppStore((state) => state.handleStaffLogin);
  const logout = useAppStore((state) => state.logout);
  const returnToLicenseAccessChoice = useAppStore((state) => state.returnToLicenseAccessChoice);
  const staffLoginMessage = useAppStore((state) => state.staffLoginMessage);
  const staffLoginError = useAppStore((state) => state.staffLoginError);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const licenseKey = useAppStore((state) => state.staffLoginLicenseKey || state.licenseDetails?.license_key);
  const staffAlreadyInUse = staffLoginError?.code === 'STAFF_ALREADY_IN_USE';
  const canSwitchAccess = licenseDetails?.staff_access_available === true
    || licenseDetails?.features?.staff_roles === true;
  const staffAlreadyInUseMessage = (staffLoginMessage || staffLoginError?.message || '')
    .split('\n')
    .filter((line) => !line.startsWith('Dispositivo activo:'))
    .join(' ')
    .trim();

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

    const result = await handleStaffLogin({
      username: username.trim(),
      password
    });

    if (!result?.success) {
      setErrorMessage(result?.code === 'STAFF_ALREADY_IN_USE' ? '' : result?.message || 'No se pudo iniciar sesión staff.');
      setIsLoading(false);
    }
  };

  return (
    <div
      className="staff-login-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="staff-login-title"
      aria-describedby="staff-login-description"
    >
      <section className="staff-login-panel">
        <div className="auth-login-topline staff-login-topline">
          <span className="auth-login-step">Acceso seguro</span>
          <span className="auth-login-role staff-login-role">
            <span className="auth-login-role__dot" aria-hidden="true" />
            Personal / Staff
          </span>
        </div>

        <LicenseContextSummary licenseDetails={licenseDetails} licenseKey={licenseKey} />

        <div className="staff-login-brand">
          <span className="staff-login-icon" aria-hidden="true">
            <LockKeyhole size={26} strokeWidth={2.2} />
          </span>
          <div>
            <h1 id="staff-login-title">Acceso staff</h1>
            <p id="staff-login-description">Ingresa con el usuario asignado por el administrador.</p>
          </div>
        </div>

        <p className="staff-login-helper">
          Usa tu cuenta personal para entrar sólo a las funciones permitidas para tu puesto.
        </p>

        {!isOnline && (
          <div className="staff-login-alert ui-alert ui-alert--danger" role="status">
            <WifiOff size={18} aria-hidden="true" />
            <span>El acceso staff requiere conexión a internet.</span>
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

        {staffLoginMessage && !errorMessage && !staffAlreadyInUse && (
          <div className="staff-login-note ui-alert ui-alert--info" role="status">
            {staffLoginMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="staff-login-form" aria-busy={isLoading}>
          <div className="staff-login-field form-group">
            <label className="form-label" htmlFor="staff-username">Usuario</label>
            <input
              id="staff-username"
              className="form-input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              disabled={isLoading || !isOnline}
              required
            />
          </div>

          <PasswordField
            id="staff-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isLoading || !isOnline}
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
            disabled={isLoading || !isOnline || !username.trim() || !password}
          >
            <LogIn size={18} aria-hidden="true" />
            {isLoading ? 'Verificando...' : 'Entrar'}
          </button>
        </form>

        <div className="staff-login-footer">
          <div className="staff-login-footer-actions">
            {canSwitchAccess && (
              <button
                type="button"
                className="auth-mode-back-button"
                onClick={returnToLicenseAccessChoice}
                disabled={isLoading}
              >
                <ArrowLeft size={16} aria-hidden="true" />
                Elegir otro perfil
              </button>
            )}
            <button type="button" className="ui-button ui-button--ghost" onClick={logout} disabled={isLoading}>
              Cambiar licencia
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
