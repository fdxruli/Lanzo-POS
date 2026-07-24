import { useState } from 'react';
import { ShieldPlus } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import './AdminAuthModal.css';

export default function AdminEnrollmentModal() {
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
    setLoading(true); setError('');
    const result = await enroll({ displayName: displayName.trim(), username: username.trim(), password });
    if (!result?.success) { setError(result?.message || 'No se pudo crear la cuenta propietaria.'); setLoading(false); }
  };

  return (
    <div className="admin-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="admin-enroll-title">
      <section className="admin-auth-panel">
        <div className="admin-auth-heading"><ShieldPlus size={30} /><div><h1 id="admin-enroll-title">Protege la administración</h1><p>Crea la cuenta única del propietario. La clave de licencia dejará de servir como acceso administrativo.</p></div></div>
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
