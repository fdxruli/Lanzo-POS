import { useEffect, useRef, useState } from 'react';
import PasswordField from './PasswordField';
import PreloginSupportAccess from './PreloginSupportAccess';
import { redeemPasswordRecovery, recoveryErrorMessage, validRecoveryPassword } from '../../services/auth/adminRecoveryService';
import './AdminAccountRecovery.css';

export default function AdminAccountRecovery({ licenseKey, online, onBack, onRecovered }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const heading = useRef(null);
  useEffect(() => {
    alive.current = true;
    heading.current?.focus();
    return () => { alive.current = false; };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (busy.current) return;
    if (password !== confirmation) { setError('Las contraseñas no coinciden.'); return; }
    if (!validRecoveryPassword(password)) { setError(recoveryErrorMessage({ code: 'RECOVERY_PASSWORD_WEAK' })); return; }
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const result = await redeemPasswordRecovery(licenseKey, code, password);
      if (!alive.current) return;
      if (result.success) {
        setUsername(result.username);
        setCode(''); setPassword(''); setConfirmation('');
      } else setError(recoveryErrorMessage(result));
    } catch {
      if (alive.current) setError(recoveryErrorMessage({ code: 'RECOVERY_UNCONFIRMED' }));
    } finally {
      busy.current = false;
      if (alive.current) setLoading(false);
    }
  };

  return (
    <section className="admin-account-recovery" aria-labelledby="account-recovery-title">
      <header className="admin-account-recovery__heading">
        <span className="auth-login-step">Acceso administrador</span>
        <h1 id="account-recovery-title" ref={heading} tabIndex={-1}>Recuperar acceso</h1>
        <p>La recuperación de la cuenta requiere asistencia de soporte.</p>
      </header>

      {username !== null ? (
        <div className="admin-account-recovery__success">
          <div className="ui-alert ui-alert--success" role="status">
            Contraseña actualizada. Tu usuario es: <strong>{username}</strong>
          </div>
          <p>El servidor revocó las sesiones administrativas anteriores. Los equipos sin conexión lo comprobarán cuando vuelvan a validarse.</p>
          <button type="button" className="ui-button ui-button--primary" onClick={() => onRecovered(username)}>
            Volver al inicio de sesión
          </button>
        </div>
      ) : (
        <div className="admin-account-recovery__grid">
          <section className="admin-account-recovery__help" aria-labelledby="account-recovery-help-title">
            <h2 id="account-recovery-help-title">Solicitar ayuda</h2>
            <p>Contacta con soporte para pedir un código. Se enviará únicamente al correo de recuperación verificado de la cuenta.</p>
            <p>Si todavía no vinculaste un correo, soporte comprobará tu titularidad por otra vía. Conocer la licencia no autoriza la recuperación.</p>
            <PreloginSupportAccess
              screen="Recuperación de acceso"
              presentation="dialog"
              triggerLabel="Ver opciones de soporte"
            />
          </section>

          <section className="admin-account-recovery__code" aria-labelledby="account-recovery-code-title">
            <h2 id="account-recovery-code-title">Ya tengo mi código</h2>
            {!online && (
              <p className="admin-account-recovery__offline" role="status">
                Necesitas conexión para confirmar la recuperación. Los datos que escribas aquí se conservarán mientras sigas en esta pantalla.
              </p>
            )}
            <form onSubmit={submit} className="admin-auth-form" aria-busy={loading}>
              <label htmlFor="account-recovery-code">Código recibido de soporte</label>
              <input id="account-recovery-code" className="form-input recovery-code-input" value={code}
                onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" autoCapitalize="none"
                spellCheck={false} maxLength={100} required disabled={loading} />
              <PasswordField id="account-recovery-password" label="Nueva contraseña" value={password}
                onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8}
                describedBy="account-recovery-password-help" disabled={loading} />
              <PasswordField id="account-recovery-confirm" label="Confirmar nueva contraseña" value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} disabled={loading} />
              <p id="account-recovery-password-help">Al menos 8 caracteres, una letra y un número. Elige una contraseña diferente de la anterior.</p>
              {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
              <button type="submit" className="ui-button ui-button--primary" disabled={loading || !online || !code.trim() || !password || !confirmation}>
                {loading ? 'Confirmando recuperación…' : 'Guardar nueva contraseña'}
              </button>
            </form>
            <button type="button" className="admin-account-recovery__back" disabled={loading} onClick={onBack}>
              Volver al inicio de sesión
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
