import { useEffect, useState } from 'react';
import { LogIn, LockKeyhole, WifiOff } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import './StaffLoginModal.css';

export default function StaffLoginModal() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [errorMessage, setErrorMessage] = useState('');

  const handleStaffLogin = useAppStore((state) => state.handleStaffLogin);
  const logout = useAppStore((state) => state.logout);
  const staffLoginMessage = useAppStore((state) => state.staffLoginMessage);
  const licenseKey = useAppStore((state) => state.staffLoginLicenseKey || state.licenseDetails?.license_key);

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
      setErrorMessage('Necesitas internet para iniciar sesion staff.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    const result = await handleStaffLogin({
      username: username.trim(),
      password
    });

    if (!result?.success) {
      setErrorMessage(result?.message || 'No se pudo iniciar sesion staff.');
      setIsLoading(false);
    }
  };

  return (
    <div className="staff-login-overlay" role="dialog" aria-modal="true" aria-labelledby="staff-login-title">
      <div className="staff-login-panel">
        <div className="staff-login-brand">
          <span className="staff-login-icon" aria-hidden="true">
            <LockKeyhole size={26} />
          </span>
          <div>
            <h1 id="staff-login-title">Acceso staff</h1>
            <p>Ingresa con el usuario asignado por el administrador.</p>
          </div>
        </div>

        {!isOnline && (
          <div className="staff-login-alert" role="status">
            <WifiOff size={18} aria-hidden="true" />
            <span>El login staff requiere conexion a internet.</span>
          </div>
        )}

        {staffLoginMessage && !errorMessage && (
          <div className="staff-login-note" role="status">
            {staffLoginMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="staff-login-form">
          <div className="form-group">
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

          <div className="form-group">
            <label className="form-label" htmlFor="staff-password">Contrasena</label>
            <input
              id="staff-password"
              className="form-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={isLoading || !isOnline}
              required
            />
          </div>

          {errorMessage && (
            <div className="staff-login-error" role="alert">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary staff-login-submit"
            disabled={isLoading || !isOnline || !username.trim() || !password}
          >
            <LogIn size={18} aria-hidden="true" />
            {isLoading ? 'Verificando...' : 'Entrar'}
          </button>
        </form>

        <div className="staff-login-footer">
          <span>{licenseKey ? `Licencia ${licenseKey.slice(0, 12)}...` : 'Licencia pendiente'}</span>
          <button type="button" className="btn btn-cancel" onClick={logout} disabled={isLoading}>
            Cambiar licencia
          </button>
        </div>
      </div>
    </div>
  );
}
