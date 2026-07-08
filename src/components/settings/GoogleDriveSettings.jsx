import { useState } from 'react';
import { Cloud, Link2, Loader2, ShieldCheck, Unplug } from 'lucide-react';
import { useGoogleLogin } from '@react-oauth/google';
import toast from 'react-hot-toast';
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  hasOnlyDriveFileScope
} from '../../config/googleDrive';
import { useAppStore } from '../../store/useAppStore';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

function revokeGoogleToken(accessToken) {
  const revoke = window.google?.accounts?.oauth2?.revoke;
  if (!accessToken || !revoke) return;

  revoke(accessToken, () => {});
}

function getOAuthErrorMessage(oauthError) {
  if (globalThis.navigator?.onLine === false) {
    return 'No hay conexion a internet. Revisa tu red e intenta conectar Google Drive nuevamente.';
  }

  if (oauthError?.error === 'access_denied') {
    return 'No se autorizo el acceso a Google Drive. Puedes intentarlo nuevamente cuando estes listo.';
  }

  return 'Google no pudo autorizar el acceso a Drive. Intentalo de nuevo y, si el problema continua, contacta a soporte.';
}

function GoogleDriveOAuthControls() {
  const driveAccessToken = useAppStore((state) => state.driveAccessToken);
  const driveTokenExpiresAt = useAppStore((state) => state.driveTokenExpiresAt);
  const isDriveConnected = useAppStore((state) => state.isDriveConnected);
  const needsDriveReauth = useAppStore((state) => state.needsDriveReauth);
  const connectDrive = useAppStore((state) => state.connectDrive);
  const disconnectDrive = useAppStore((state) => state.disconnectDrive);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');

  const hasActiveSession = Boolean(driveAccessToken && driveTokenExpiresAt);

  const login = useGoogleLogin({
    flow: 'implicit',
    scope: GOOGLE_DRIVE_FILE_SCOPE,
    overrideScope: true,
    include_granted_scopes: false,
    onSuccess: (tokenResponse) => {
      setIsConnecting(false);

      if (!tokenResponse.access_token || !hasOnlyDriveFileScope(tokenResponse.scope)) {
        revokeGoogleToken(tokenResponse.access_token);
        setError('Google devolvio permisos distintos a drive.file. La conexion fue rechazada.');
        toast.error('No se aceptaron permisos adicionales de Google Drive.');
        return;
      }

      connectDrive({
        accessToken: tokenResponse.access_token,
        expiresIn: tokenResponse.expires_in
      });
      setError('');
      toast.success('Google Drive conectado para esta sesion.');
    },
    onError: (oauthError) => {
      setIsConnecting(false);
      const message = getOAuthErrorMessage(oauthError);
      setError(message);
      toast.error(message);
    },
    onNonOAuthError: (oauthError) => {
      setIsConnecting(false);
      const message = oauthError.type === 'popup_closed'
        ? 'La ventana de autorizacion fue cerrada.'
        : 'No fue posible abrir la autorizacion de Google.';
      setError(message);
    }
  });

  const handleConnect = () => {
    setError('');
    setIsConnecting(true);

    try {
      login();
    } catch {
      setIsConnecting(false);
      setError('No fue posible iniciar la autorizacion de Google.');
    }
  };

  const handleDisconnect = () => {
    const tokenToRevoke = driveAccessToken;
    disconnectDrive();
    revokeGoogleToken(tokenToRevoke);
    setError('');
    toast.success('Google Drive desconectado.');
  };

  return (
    <>
      <div className={`drive-connection-status ${hasActiveSession ? 'is-connected' : ''} ${needsDriveReauth ? 'needs-reauth' : ''}`}>
        <span className="drive-connection-status__icon">
          {hasActiveSession ? <ShieldCheck size={20} /> : <Cloud size={20} />}
        </span>
        <div>
          <strong>
            {hasActiveSession
              ? 'Conexion activa'
              : needsDriveReauth
                ? 'Sesion expirada'
                : isDriveConnected
                  ? 'Autorizado previamente'
                  : 'Google Drive no conectado'}
          </strong>
          <p>
            {hasActiveSession
              ? 'El token temporal esta disponible solo durante esta sesion.'
              : needsDriveReauth
                ? 'Reconecta Google Drive para reactivar los respaldos en la nube.'
                : isDriveConnected
                  ? 'Vuelve a conectar para obtener un token temporal nuevo.'
                  : 'Los respaldos solo podran administrar archivos creados por Lanzo.'}
          </p>
        </div>
      </div>

      <div className="backup-settings-actions">
        {!hasActiveSession && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConnect}
            disabled={isConnecting}
          >
            <span aria-hidden="true">
              {isConnecting
                ? <Loader2 size={17} className="animate-spin" />
                : <Link2 size={17} />}
            </span>
            <span>
              {isConnecting
                ? 'Conectando...'
                : (isDriveConnected || needsDriveReauth)
                  ? 'Reconectar Google Drive'
                  : 'Conectar Google Drive'}
            </span>
          </button>
        )}

        {(isDriveConnected || hasActiveSession || needsDriveReauth) && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleDisconnect}
            disabled={isConnecting}
          >
            <span aria-hidden="true"><Unplug size={17} /></span>
            <span>Desconectar</span>
          </button>
        )}
      </div>

      {error && <p className="backup-settings-error">{error}</p>}

      <p className="drive-connection-scope">
        Permiso solicitado: <code>{GOOGLE_DRIVE_FILE_SCOPE}</code>
      </p>
    </>
  );
}

export default function GoogleDriveSettings() {
  return (
    <section className="backup-settings-card backup-settings-card--drive">
      <div className="backup-settings-card__heading">
        <span className="backup-card-icon backup-card-icon--drive" aria-hidden="true">
          <Cloud size={20} />
        </span>
        <div>
          <span className="backup-card-eyebrow">Nube opcional</span>
          <h4>Respaldo en Google Drive</h4>
          <p>Conecta tu cuenta con acceso limitado a los archivos creados por Lanzo.</p>
        </div>
      </div>

      {GOOGLE_CLIENT_ID
        ? <GoogleDriveOAuthControls />
        : (
          <div className="backup-settings-notice">
            Configura <code>VITE_GOOGLE_CLIENT_ID</code> para habilitar la conexion con Google Drive.
          </div>
        )}
    </section>
  );
}
