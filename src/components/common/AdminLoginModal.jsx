import { useEffect, useState } from 'react';
import { LogIn, ShieldCheck, WifiOff } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import './AdminAuthModal.css';

export default function AdminLoginModal() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const handleAdminLogin = useAppStore((state) => state.handleAdminLogin);
  const logout = useAppStore((state) => state.logout);
  const message = useAppStore((state) => state.adminLoginMessage);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true); setError('');
    const result = await handleAdminLogin({ username: username.trim(), password });
    if (!result?.success) { setError(result?.message || 'No se pudo iniciar sesión.'); setLoading(false); }
  };

  return (
    <div className="admin-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="admin-login-title">
      <section className="admin-auth-panel">
        <div className="admin-auth-heading"><ShieldCheck size={30} /><div><h1 id="admin-login-title">Acceso administrador</h1><p>Ingresa con la cuenta del propietario.</p></div></div>
        {!online && <div className="ui-alert ui-alert--danger"><WifiOff size={18} /> Necesitas internet para iniciar sesión.</div>}
        {message && !error && <div className="ui-alert ui-alert--info">{message}</div>}
        <form onSubmit={submit} className="admin-auth-form">
          <label>Usuario<input className="form-input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required disabled={loading || !online} /></label>
          <label>Contraseña<input className="form-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={loading || !online} /></label>
          {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
          <button className="ui-button ui-button--primary" disabled={loading || !online || !username.trim() || !password}><LogIn size={18} />{loading ? 'Verificando...' : 'Entrar'}</button>
        </form>
        <button type="button" className="ui-button ui-button--ghost" onClick={logout} disabled={loading}>Cambiar licencia</button>
      </section>
    </div>
  );
}
