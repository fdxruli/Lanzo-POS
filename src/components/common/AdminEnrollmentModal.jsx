import { useState } from 'react';
import { ShieldPlus } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import './AdminAuthModal.css';

export default function AdminEnrollmentModal({ embedded = false, onBusyChange }) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const enroll = useAppStore((state) => state.handleAdminEnrollment);
  const logout = useAppStore((state) => state.logout);

  const submit = async (event) => {
    event.preventDefault();
    if (password !== confirmation) { setError('Las contraseñas no coinciden.'); return; }
    setLoading(true); setError(''); onBusyChange?.(true);
    try {
      const result = await enroll({ displayName: displayName.trim(), username: username.trim(), password });
      if (!result?.success) setError(result?.message || 'No se pudo crear la cuenta propietaria.');
    } catch (err) {
      setError(err.message || 'No se pudo crear la cuenta propietaria. Intenta de nuevo.');
    } finally {
      setLoading(false);
      onBusyChange?.(false);
    }
  };

  return (
    <div className={embedded ? 'setup-owner-access' : 'admin-auth-overlay'} role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true} aria-labelledby="admin-enroll-title">
      <section className={embedded ? undefined : 'admin-auth-panel'}>
        <div className="admin-auth-heading"><ShieldPlus size={30} /><div><h1 id="admin-enroll-title">Tu acceso como propietario</h1><p>Crea tu cuenta personal para administrar Lanzo. La licencia identifica a tu negocio; esta cuenta identifica que eres tú quien lo administra.</p></div></div>
        <p>Esta contraseña es para administrar Lanzo. No es un PIN de respaldo ni sustituye la clave de tu licencia.</p>
        <form onSubmit={submit} className="admin-auth-form">
          <label>Nombre del propietario<input className="form-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} required disabled={loading} /></label>
          <label>Usuario<input className="form-input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} minLength={3} maxLength={64} required disabled={loading} /></label>
          <label>Contraseña<input className="form-input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required disabled={loading} /><small>Mínimo 8 caracteres, una letra y un número.</small></label>
          <label>Confirmar contraseña<input className="form-input" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required disabled={loading} /></label>
          {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
          <button className="ui-button ui-button--primary" disabled={loading || !navigator.onLine}>{loading ? 'Creando cuenta...' : 'Crear cuenta propietaria'}</button>
        </form>
        <button type="button" className="ui-button ui-button--ghost" onClick={logout} disabled={loading}>Cambiar licencia</button>
      </section>
    </div>
  );
}
