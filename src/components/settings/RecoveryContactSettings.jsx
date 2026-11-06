import { useCallback, useEffect, useRef, useState } from 'react';
import PasswordField from '../common/PasswordField';
import PreloginSupportAccess from '../common/PreloginSupportAccess';
import { useSettingsAccess, useSettingsActionGuard } from '../../services/auth/useSettingsAccess';
import { confirmRecoveryContact, getRecoveryContact, requestRecoveryContact, recoveryErrorMessage } from '../../services/auth/adminRecoveryService';
import '../common/AdminAccountRecovery.css';

export default function RecoveryContactSettings({ licenseKey }) {
  const access = useSettingsAccess();
  const capture = useSettingsActionGuard();
  const [status, setStatus] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);

  const run = useCallback(async (operation) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true); setError('');
    let handle;
    try {
      handle = capture('license', { adminOnly: true });
      const result = await operation();
      handle.assertCurrent('license');
      if (!alive.current) return;
      if (result.success) {
        setPassword(''); setCode('');
        const current = await getRecoveryContact(licenseKey);
        handle.assertCurrent('license');
        if (!alive.current) return;
        if (current.success) setStatus(current);
        else setError(recoveryErrorMessage(current));
      } else setError(recoveryErrorMessage(result));
    } catch (failure) {
      if (alive.current) {
        try { handle?.assertCurrent('license'); setError(recoveryErrorMessage(failure)); } catch { /* Previous actor is no longer visible. */ }
      }
    } finally {
      busy.current = false;
      if (alive.current) setLoading(false);
    }
  }, [capture, licenseKey]);

  useEffect(() => {
    alive.current = true;
    // Status can be recovered after navigation/reload; secrets stay in memory.
    if (access.isAdmin) void run(async () => ({ success: true }));
    return () => { alive.current = false; };
  }, [access.isAdmin, run]);

  if (!access.isAdmin) return null;
  return (
    <section className="license-panel admin-account-recovery" aria-labelledby="recovery-contact-title" aria-busy={loading}>
      <h3 id="recovery-contact-title">Correo de recuperación</h3>
      <p>Vincula un correo que controles para recuperar tu usuario y contraseña con ayuda de soporte. Disponible en Lanzo Local y Lanzo Nube.</p>
      {status?.contact ? <>
        <p role="status">Correo verificado: <strong>{status.contact.email}</strong></p>
        <p>Para cambiar este contacto, solicita ayuda a soporte. No se sustituye desde esta pantalla.</p>
      </> : status && <>
        {status.pending ? <>
          <p>Solicitud pendiente para <strong>{status.pending.email}</strong>. Contacta con soporte e indica esta referencia:</p>
          <p className="recovery-request-reference">{status.pending.request_id}</p>
          <p>Soporte comprobará la solicitud en el servidor y enviará un código a ese correo. Confírmalo desde esta misma sesión. El código caduca en 15 minutos.</p>
          <form onSubmit={(event) => { event.preventDefault(); void run(() => confirmRecoveryContact(licenseKey, code)); }}>
            <label htmlFor="recovery-contact-code">Código de verificación del correo</label>
            <input id="recovery-contact-code" className="form-input recovery-code-input" value={code}
              onChange={(event) => setCode(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false}
              maxLength={100} required disabled={loading} />
            <button className="ui-button ui-button--primary" disabled={loading || !code.trim()}>Verificar correo</button>
          </form>
          <details><summary>Corregir correo o renovar solicitud</summary><p>Requiere tu contraseña actual e invalida cualquier código de vinculación anterior.</p>
            <ContactRequestForm {...{ email, setEmail, password, setPassword, loading, run, licenseKey }} />
          </details>
        </> : <ContactRequestForm {...{ email, setEmail, password, setPassword, loading, run, licenseKey }} />}
      </>}
      {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
      <button type="button" className="ui-button ui-button--ghost" disabled={loading} onClick={() => void run(async () => ({ success: true }))}>
        {loading ? 'Consultando…' : 'Consultar estado'}
      </button>
      <PreloginSupportAccess screen="Vinculación de correo de recuperación" />
    </section>
  );
}

function ContactRequestForm({ email, setEmail, password, setPassword, loading, run, licenseKey }) {
  return <form onSubmit={(event) => { event.preventDefault(); void run(() => requestRecoveryContact(licenseKey, email, password)); }}>
    <label htmlFor="recovery-contact-email">Correo que quieres verificar</label>
    <input id="recovery-contact-email" type="email" inputMode="email" className="form-input" autoComplete="email"
      value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required disabled={loading} />
    <PasswordField id="recovery-current-password" label="Contraseña administrativa actual" value={password}
      onChange={(event) => setPassword(event.target.value)} disabled={loading} />
    <button className="ui-button ui-button--primary" disabled={loading || !email.trim() || !password}>Solicitar vinculación</button>
  </form>;
}
