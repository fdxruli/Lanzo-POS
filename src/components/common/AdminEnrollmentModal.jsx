import { useState } from 'react';
import { ShieldPlus } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import PasswordField from './PasswordField';
import PreloginSupportAccess from './PreloginSupportAccess';
import './AdminAuthModal.css';
import './SetupModal.onboarding.css';

export default function AdminEnrollmentModal({
  embedded = false,
  requiresInvitation = false,
  onBusyChange,
  onEnrollmentSuccess,
  submitLabel = 'Crear cuenta propietaria',
  loadingLabel = 'Creando cuenta...'
}) {
  const [invitationCode, setInvitationCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const enroll = useAppStore((state) => state.handleAdminEnrollment);
  const logout = useAppStore((state) => state.logout);
  const discoverAdminAccess = useAppStore((state) => state.discoverAdminAccess);
  const licenseKey = useAppStore((state) => state.adminLoginLicenseKey);

  const submit = async (event) => {
    event.preventDefault();
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (requiresInvitation && !invitationCode.trim()) {
      setError('Introduce el código de primera configuración.');
      return;
    }

    setLoading(true);
    setError('');
    onBusyChange?.(true);

    try {
      const result = await enroll({
        displayName: displayName.trim(),
        username: username.trim(),
        password,
        ...(requiresInvitation ? { invitationCode: invitationCode.trim() } : {})
      });

      if (!result?.success) {
        setError(result?.message || 'No se pudo crear la cuenta propietaria.');
        return;
      }

      await onEnrollmentSuccess?.(result);
    } catch (err) {
      setError(err.message || 'No se pudo crear la cuenta propietaria. Intenta de nuevo.');
    } finally {
      if (requiresInvitation) setInvitationCode('');
      setPassword('');
      setConfirmation('');
      setLoading(false);
      onBusyChange?.(false);
    }
  };

  const continueWithExistingAccount = async () => {
    if (!licenseKey || !discoverAdminAccess) return;
    setLoading(true);
    setError('');
    try {
      await discoverAdminAccess(licenseKey);
      if (useAppStore.getState().appStatus === 'admin_initial_setup_required') {
        setError('No pudimos verificar una cuenta propietaria. Comprueba tu conexión e inténtalo de nuevo.');
      }
    } catch {
      if (useAppStore.getState().appStatus === 'admin_initial_setup_required') {
        setError('No pudimos verificar una cuenta propietaria. Comprueba tu conexión e inténtalo de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={embedded ? 'setup-owner-access' : 'admin-auth-overlay'}
      role={embedded ? undefined : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-labelledby="admin-enroll-title"
    >
      <section className={embedded ? undefined : 'admin-auth-panel'}>
        <div className="admin-auth-heading">
          <ShieldPlus size={30} />
          <div>
            <h1 id="admin-enroll-title">Tu acceso como propietario</h1>
            <p>
              {requiresInvitation
                ? 'Configura el acceso administrativo de este negocio con el código de primera configuración que te entregó LANZO.'
                : 'Crea tu cuenta personal para administrar Lanzo. La licencia identifica a tu negocio; esta cuenta identifica que eres tú quien lo administra.'}
            </p>
          </div>
        </div>
        <p>Esta contraseña es para administrar Lanzo. No es un PIN de respaldo ni sustituye la clave de tu licencia.</p>
        <form onSubmit={submit} className="admin-auth-form">
          {requiresInvitation && (
            <label>
              Código de primera configuración
              <input
                className="form-input"
                autoComplete="one-time-code"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                value={invitationCode}
                onChange={(e) => setInvitationCode(e.target.value.trim().toLowerCase())}
                minLength={64}
                maxLength={64}
                required
                disabled={loading}
                aria-describedby="admin-onboarding-code-help"
              />
              <small id="admin-onboarding-code-help">Pega el código de 64 caracteres recibido para este negocio.</small>
            </label>
          )}
          <label>
            Nombre del propietario
            <input
              className="form-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={120}
              required
              disabled={loading}
            />
          </label>
          <label>
            Usuario
            <input
              className="form-input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              minLength={3}
              maxLength={64}
              required
              disabled={loading}
            />
          </label>
          <div>
            <PasswordField
              id="admin-enrollment-password"
              label="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              disabled={loading}
              fieldClassName="admin-auth-field"
            />
            <small>Mínimo 8 caracteres, una letra y un número.</small>
          </div>
          <PasswordField
            id="admin-enrollment-password-confirmation"
            label="Confirmar contraseña"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="new-password"
            disabled={loading}
            fieldClassName="admin-auth-field"
          />
          {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
          <button className="ui-button ui-button--primary" disabled={loading || !navigator.onLine}>
            {loading ? loadingLabel : submitLabel}
          </button>
        </form>
        {requiresInvitation && (
          <button
            type="button"
            className="ui-button ui-button--ghost"
            onClick={continueWithExistingAccount}
            disabled={loading || !navigator.onLine}
          >
            Ya configuré mi cuenta: iniciar sesión
          </button>
        )}
        {!embedded && (
          <PreloginSupportAccess screen="Registro de cuenta propietaria">
            <button type="button" className="ui-button ui-button--ghost" onClick={logout} disabled={loading}>
              Cambiar licencia
            </button>
          </PreloginSupportAccess>
        )}
      </section>
    </div>
  );
}
