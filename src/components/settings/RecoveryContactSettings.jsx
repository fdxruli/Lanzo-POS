import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, UserRound } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import PasswordField from '../common/PasswordField';
import PreloginSupportAccess from '../common/PreloginSupportAccess';
import { useSettingsAccess, useSettingsActionGuard } from '../../services/auth/useSettingsAccess';
import { confirmRecoveryContact, getRecoveryContact, requestRecoveryContact, requestRecoveryContactChange, recoveryErrorMessage } from '../../services/auth/adminRecoveryService';
import './RecoveryContactSettings.css';

const CASE_STATES = {
  open: 'En revisión',
  approved: 'Aprobado, pendiente de completar',
  blocked: 'Revisión detenida'
};

function AdminIdentity({ admin }) {
  const name = typeof admin?.display_name === 'string' ? admin.display_name.trim() : '';
  const username = typeof admin?.username === 'string' ? admin.username.trim() : '';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toLocaleUpperCase()).join('');

  return (
    <section className="recovery-settings__card recovery-settings__identity" aria-label="Identidad del administrador">
      <div className="recovery-settings__avatar" aria-hidden="true">
        {initials || <UserRound size={23} />}
      </div>
      <div className="recovery-settings__identity-content">
        <span className="recovery-settings__eyebrow">Administrador</span>
        <strong className="recovery-settings__name">{name || 'Nombre no disponible'}</strong>
        <p className="recovery-settings__username">
          <span>Usuario de acceso:</span>{' '}
          <span>{username ? (username.startsWith('@') ? username : `@${username}`) : 'No disponible'}</span>
        </p>
        <small className="recovery-settings__note">Información solo de consulta</small>
      </div>
    </section>
  );
}

export default function RecoveryContactSettings({ licenseKey }) {
  const access = useSettingsAccess();
  const capture = useSettingsActionGuard();
  const adminFromStore = useAppStore((state) => state.currentAdminUser);
  const admin = access.isAdmin && String(adminFromStore?.id || '') === String(access.actorId || '')
    ? adminFromStore : null;
  const ownerKey = `${licenseKey}:${access.actorKey || access.actorId || 'unauthorized'}:${access.generation ?? 'unknown'}`;
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
    setLoading(true);
    setError('');
    let handle;
    try {
      handle = capture('license', { adminOnly: true });
      const result = await operation();
      handle.assertCurrent('license');
      if (!alive.current) return;
      if (result.success) {
        setPassword('');
        setCode('');
        const current = await getRecoveryContact(licenseKey);
        handle.assertCurrent('license');
        if (!alive.current) return;
        if (current.success) setStatus({ ownerKey, data: current });
        else setError(recoveryErrorMessage(current));
      } else {
        setError(recoveryErrorMessage(result));
      }
    } catch (failure) {
      if (alive.current) {
        try {
          handle?.assertCurrent('license');
          setError(recoveryErrorMessage(failure));
        } catch {
          // Responses from a previous actor must not enter the new screen.
        }
      }
    } finally {
      busy.current = false;
      if (alive.current) setLoading(false);
    }
  }, [capture, licenseKey, ownerKey]);

  useEffect(() => {
    alive.current = true;
    // Only server status is reloaded; passwords and codes are never persisted.
    if (access.isAdmin) void run(async () => ({ success: true }));
    return () => { alive.current = false; };
  }, [access.isAdmin, run]);

  if (!access.isAdmin) return null;

  // The surrounding LicenseSettings also remounts this section per actor.
  // This guard prevents displaying a previous actor's response even mid-render.
  const current = status?.ownerKey === ownerKey ? status.data : null;
  const contact = current?.contact || null;
  const pending = current?.pending || null;
  const pendingChange = current?.pending_change || null;
  const stateLabel = pendingChange ? 'Cambio en revisión'
    : contact ? 'Verificado'
      : pending ? 'Pendiente de verificación' : 'Sin vincular';

  return (
    <section className="recovery-settings" aria-labelledby="recovery-contact-title" aria-busy={loading}>
      <header className="recovery-settings__header">
        <ShieldCheck size={21} aria-hidden="true" />
        <div>
          <h3 id="recovery-contact-title">Recuperación</h3>
          <p>Revisa la identidad de tu cuenta y los métodos de recuperación.</p>
        </div>
      </header>

      <AdminIdentity admin={admin} />

      <section className="recovery-settings__card recovery-settings__contact" aria-labelledby="recovery-email-title">
        <div className="recovery-settings__contact-header">
          <h4 id="recovery-email-title">Correo de recuperación</h4>
          <span className="recovery-settings__status" data-state={pendingChange ? 'review' : contact ? 'verified' : pending ? 'pending' : 'empty'}>
            {current ? stateLabel : loading ? 'Consultando…' : 'Estado no disponible'}
          </span>
        </div>

        {contact && (
          <>
            <p className="recovery-settings__email">{contact.email}</p>
            <p className="recovery-settings__muted">Se utiliza para recuperar el acceso a tu cuenta mediante el procedimiento de seguridad.</p>
          </>
        )}

        {pendingChange ? (
          <div className="recovery-settings__flow" role="status">
            <p>Hay un caso de revisión de recuperación. Estado: {CASE_STATES[pendingChange.state] || 'En revisión'}.</p>
            {pendingChange.email && <p>Correo propuesto: <strong className="recovery-settings__wrap">{pendingChange.email}</strong>.</p>}
            <p>Referencia para soporte:</p>
            <p className="recovery-settings__reference">{pendingChange.case_id}</p>
            <p className="recovery-settings__muted">
              Soporte verificará los buzones y explicará el plazo de seguridad. El correo anterior sigue vigente hasta completar la verificación. Si el caso está detenido, debe resolverse antes de continuar.
            </p>
          </div>
        ) : contact ? (
          <details className="recovery-settings__details">
            <summary>Solicitar cambio de correo</summary>
            <div className="recovery-settings__flow">
              <p className="recovery-settings__muted">
                Confirma tu contraseña actual para abrir un caso con soporte. Si controlas el correo anterior podrás confirmarlo; en caso contrario habrá aviso y una espera mínima de 24 horas. Al finalizar tendrás que iniciar sesión otra vez. Nunca compartas tu contraseña.
              </p>
              <ContactRequestForm {...{ email, setEmail, password, setPassword, loading, run, licenseKey }} change />
            </div>
          </details>
        ) : pending ? (
          <div className="recovery-settings__flow">
            <p>Solicitud pendiente para <strong className="recovery-settings__wrap">{pending.email}</strong>.</p>
            <p>Referencia para soporte:</p>
            <p className="recovery-settings__reference">{pending.request_id}</p>
            <p className="recovery-settings__muted">
              Soporte comprobará la solicitud y enviará un código a ese correo. Confírmalo desde esta misma sesión. El código caduca en 15 minutos.
            </p>
            <form className="recovery-settings__form" onSubmit={(event) => {
              event.preventDefault();
              void run(() => confirmRecoveryContact(licenseKey, code));
            }}>
              <label htmlFor="recovery-contact-code">Código de verificación del correo</label>
              <input id="recovery-contact-code" className="form-input recovery-code-input" value={code}
                onChange={(event) => setCode(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false}
                maxLength={100} required disabled={loading} />
              <button className="ui-button ui-button--primary" disabled={loading || !code.trim()}>Verificar correo</button>
            </form>
            <details className="recovery-settings__details">
              <summary>Corregir correo o renovar solicitud</summary>
              <div className="recovery-settings__flow">
                <p className="recovery-settings__muted">Requiere tu contraseña actual e invalida cualquier código de vinculación anterior.</p>
                <ContactRequestForm {...{ email, setEmail, password, setPassword, loading, run, licenseKey }} />
              </div>
            </details>
          </div>
        ) : current ? (
          <div className="recovery-settings__flow">
            <p className="recovery-settings__muted">Vincula un correo que controles para poder recuperar tu usuario y contraseña con ayuda de soporte. Disponible en Lanzo Local y Lanzo Nube.</p>
            <ContactRequestForm {...{ email, setEmail, password, setPassword, loading, run, licenseKey }} />
          </div>
        ) : (
          <p className="recovery-settings__muted" role="status">
            {loading ? 'Consultando los datos de recuperación…' : 'No se pudo obtener el estado. Puedes volver a consultarlo.'}
          </p>
        )}

        {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
        <button type="button" className="ui-button ui-button--ghost recovery-settings__refresh"
          disabled={loading} onClick={() => void run(async () => ({ success: true }))}>
          {loading ? 'Consultando…' : 'Consultar estado'}
        </button>
      </section>

      <footer className="recovery-settings__footer">
        <PreloginSupportAccess
          screen="Vinculación de correo de recuperación"
          modal
          introText="Elige cómo contactar a soporte. No compartas contraseñas ni datos sensibles."
          triggerClassName="recovery-settings__support-button"
        />
      </footer>
    </section>
  );
}

function ContactRequestForm({ email, setEmail, password, setPassword, loading, run, licenseKey, change = false }) {
  return (
    <form className="recovery-settings__form" onSubmit={(event) => {
      event.preventDefault();
      void run(() => (change ? requestRecoveryContactChange : requestRecoveryContact)(licenseKey, email, password));
    }}>
      <label htmlFor="recovery-contact-email">Correo que quieres verificar</label>
      <input id="recovery-contact-email" type="email" inputMode="email" className="form-input" autoComplete="email"
        value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required disabled={loading} />
      <PasswordField id="recovery-current-password" label="Contraseña administrativa actual" value={password}
        onChange={(event) => setPassword(event.target.value)} disabled={loading} />
      <button className="ui-button ui-button--primary" disabled={loading || !email.trim() || !password}>
        {change ? 'Enviar solicitud de cambio' : 'Solicitar vinculación'}
      </button>
    </form>
  );
}
