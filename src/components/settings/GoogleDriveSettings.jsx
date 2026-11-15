import { useEffect, useRef, useState } from 'react';
import { Cloud, Link2, Loader2, ShieldCheck, Unplug } from 'lucide-react';
import { useGoogleLogin } from '@react-oauth/google';
import toast from 'react-hot-toast';
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  hasOnlyDriveFileScope
} from '../../config/googleDrive';
import { useAppStore } from '../../store/useAppStore';
import { useSettingsAccess, useSettingsActionGuard } from '../../services/auth/useSettingsAccess';
import NoPermission from '../common/NoPermission';
import { downloadBackup, listBackups } from '../../services/googleDriveService';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

function useExpiredDriveToken(token, expiresAt) {
  const [expired, setExpired] = useState(() => !token || Number(expiresAt) <= Date.now());
  useEffect(() => {
    const remaining = Number(expiresAt) - Date.now();
    if (!token || !Number.isFinite(remaining) || remaining <= 0) {
      setExpired(true);
      return;
    }
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [token, expiresAt]);
  return expired;
}

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

function GoogleDriveOAuthControls({ disabled = false }) {
  const driveAccessToken = useAppStore((state) => state.driveAccessToken);
  const driveTokenExpiresAt = useAppStore((state) => state.driveTokenExpiresAt);
  const isDriveConnected = useAppStore((state) => state.isDriveConnected);
  const needsDriveReauth = useAppStore((state) => state.needsDriveReauth);
  const connectDrive = useAppStore((state) => state.connectDrive);
  const disconnectDrive = useAppStore((state) => state.disconnectDrive);
  const captureSettingsAction = useSettingsActionGuard();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const connectActionRef = useRef(null);

  const tokenExpired = useExpiredDriveToken(driveAccessToken, driveTokenExpiresAt);
  const sessionExpired = needsDriveReauth || Boolean(driveAccessToken && tokenExpired);
  const hasActiveSession = Boolean(driveAccessToken && driveTokenExpiresAt && !sessionExpired);

  const login = useGoogleLogin({
    flow: 'implicit',
    scope: GOOGLE_DRIVE_FILE_SCOPE,
    overrideScope: true,
    include_granted_scopes: false,
    onSuccess: (tokenResponse) => {
      if (!tokenResponse.access_token || !hasOnlyDriveFileScope(tokenResponse.scope)) {
        revokeGoogleToken(tokenResponse.access_token);
        try {
          connectActionRef.current?.assertCurrent('settings_backup');
        } catch {
          connectActionRef.current = null;
          return;
        }
        connectActionRef.current = null;
        setIsConnecting(false);
        setError('Google devolvio permisos distintos a drive.file. La conexion fue rechazada.');
        toast.error('No se aceptaron permisos adicionales de Google Drive.');
        return;
      }

      const actionHandle = connectActionRef.current;
      try {
        if (!actionHandle) return revokeGoogleToken(tokenResponse.access_token);
        actionHandle.assertCurrent('settings_backup');
      } catch {
        revokeGoogleToken(tokenResponse.access_token);
        connectActionRef.current = null;
        return;
      }

      connectActionRef.current = null;
      setIsConnecting(false);
      connectDrive({
        accessToken: tokenResponse.access_token,
        expiresIn: tokenResponse.expires_in
      });
      actionHandle.assertCurrent('settings_backup');
      setError('');
      toast.success('Google Drive conectado para esta sesion.');
    },
    onError: (oauthError) => {
      try {
        if (!connectActionRef.current) return;
        connectActionRef.current.assertCurrent('settings_backup');
      } catch {
        connectActionRef.current = null;
        return;
      }
      connectActionRef.current = null;
      setIsConnecting(false);
      const message = getOAuthErrorMessage(oauthError);
      setError(message);
      toast.error(message);
    },
    onNonOAuthError: (oauthError) => {
      try {
        if (!connectActionRef.current) return;
        connectActionRef.current.assertCurrent('settings_backup');
      } catch {
        connectActionRef.current = null;
        return;
      }
      connectActionRef.current = null;
      setIsConnecting(false);
      const message = oauthError.type === 'popup_closed'
        ? 'La ventana de autorizacion fue cerrada.'
        : 'No fue posible abrir la autorizacion de Google.';
      setError(message);
    }
  });

  const handleConnect = () => {
    let actionHandle;
    try {
      actionHandle = captureSettingsAction('settings_backup');
      actionHandle.assertCurrent('settings_backup');
    } catch {
      return;
    }
    setError('');
    setIsConnecting(true);
    connectActionRef.current = actionHandle;

    try {
      login();
    } catch {
      setIsConnecting(false);
      setError('No fue posible iniciar la autorizacion de Google.');
    }
  };

  const handleDisconnect = () => {
    try {
      const actionHandle = captureSettingsAction('settings_backup');
      actionHandle.assertCurrent('settings_backup');
      const tokenToRevoke = driveAccessToken;
      disconnectDrive();
      actionHandle.assertCurrent('settings_backup');
      revokeGoogleToken(tokenToRevoke);
      setError('');
      toast.success('Google Drive desconectado.');
    } catch {
      // The actor changed before this synchronous preference update finished.
    }
  };

  return (
    <>
      <div className={`drive-connection-status ${hasActiveSession ? 'is-connected' : ''} ${sessionExpired ? 'needs-reauth' : ''}`}>
        <span className="drive-connection-status__icon">
          {hasActiveSession ? <ShieldCheck size={20} /> : <Cloud size={20} />}
        </span>
        <div>
          <strong>
            {hasActiveSession
              ? 'Conexion activa'
              : sessionExpired
                ? 'Sesion expirada'
                : isDriveConnected
                  ? 'Autorizado previamente'
                  : 'Google Drive no conectado'}
          </strong>
          <p>
            {hasActiveSession
              ? 'Puedes subir copias cifradas durante esta sesión. La conexión por sí sola no confirma un respaldo.'
              : sessionExpired
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
            disabled={disabled || isConnecting}
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
            disabled={disabled || isConnecting}
          >
            <span aria-hidden="true"><Unplug size={17} /></span>
            <span>Desconectar</span>
          </button>
        )}
      </div>

      {error && <p className="backup-settings-error">{error}</p>}

      <details className="backup-advanced-details"><summary>Permiso de Google Drive</summary><p className="drive-connection-scope">Solo archivos creados por Lanzo: <code>{GOOGLE_DRIVE_FILE_SCOPE}</code></p></details>
    </>
  );
}

function DriveBackupList({ disabled, onBackupDownloaded, onBusyChange }) {
  const token = useAppStore((state) => state.driveAccessToken);
  const connected = useAppStore((state) => state.isDriveConnected);
  const needsReauth = useAppStore((state) => state.needsDriveReauth);
  const expiresAt = useAppStore((state) => state.driveTokenExpiresAt);
  const binding = useAppStore((state) => state.driveTenantBinding);
  const access = useSettingsAccess();
  const captureAction = useSettingsActionGuard();
  const requestRef = useRef(null);
  const [files, setFiles] = useState(null);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const tokenExpired = useExpiredDriveToken(token, expiresAt);
  const canQuery = Boolean(connected && token && !tokenExpired && !needsReauth);

  useEffect(() => {
    setFiles(null);
    setError('');
    setPending('');
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
      onBusyChange?.(false);
    };
  }, [token, binding, access.actorKey, access.generation, onBusyChange]);

  const cancel = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    setPending('');
    onBusyChange?.(false);
  };

  const query = async (file = null) => {
    if (requestRef.current || disabled || !canQuery) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setError('');
    setPending(file ? `Descargando ${file.name}…` : 'Consultando respaldos…');
    onBusyChange?.(true);
    let actor;
    try {
      actor = captureAction('settings_backup', { adminOnly: true });
      const result = file
        ? await downloadBackup(token, file, { signal: controller.signal })
        : await listBackups(token, { signal: controller.signal });
      actor.assertCurrent('settings_backup');
      if (requestRef.current !== controller || controller.signal.aborted) return;
      if (file) onBackupDownloaded(result);
      else setFiles(result.files);
    } catch (actionError) {
      if (requestRef.current !== controller || controller.signal.aborted) return;
      if (!file) setFiles(null);
      const code = actionError.code || actionError.message;
      setError(code === 'DRIVE_LIST_INCOMPLETE' || code === 'DRIVE_LIST_AMBIGUOUS'
        ? 'No se pudo obtener un listado completo y verificable. Actualiza los respaldos o reconecta Google Drive.'
        : actionError.message);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setPending('');
        onBusyChange?.(false);
      }
    }
  };

  if (!access.isAdmin) return null;
  return (
    <div className="drive-backup-list" aria-label="Respaldos en Google Drive" aria-busy={Boolean(pending)}>
      <h5>Desde Google Drive</h5>
      <p>Consulta las copias verificables de este negocio. Recuperar descarga el archivo cifrado; después debes introducir el PIN y revisarlo antes de restaurar.</p>
      {!canQuery && <p role="status">{needsReauth || (token && tokenExpired)
        ? 'La sesión venció. Reconecta Google Drive para consultar tus copias.'
        : 'Conecta Google Drive para consultar tus copias.'}</p>}
      <button type="button" className="btn btn-secondary" disabled={!canQuery || disabled || Boolean(pending)} onClick={() => query()}>
        Actualizar respaldos
      </button>
      {pending && <div role="status" aria-live="polite">
        <p>{pending}</p>
        <button type="button" className="btn btn-secondary" onClick={cancel}>Cancelar descarga o consulta</button>
      </div>}
      {error && <p className="backup-settings-error" role="alert">{error}</p>}
      {files?.length === 0 && <p role="status">No se encontraron copias verificables para este negocio.</p>}
      {canQuery && files?.length > 0 && <ul className="drive-backup-list__files">
        {files.map((file) => {
          const size = Number(file.size);
          const available = Number.isSafeInteger(size) && size > 0 && file.capabilities?.canDownload !== false;
          return <li key={file.id}>
            <div>
              <strong>{file.name}</strong>
              <span>{new Date(file.createdTime).toLocaleString()} · {Number.isSafeInteger(size) && size > 0
                ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(size / 1024)} KB`
                : 'Tamaño no disponible'}</span>
              <span>{available ? 'Disponible para descargar' : 'No disponible para descargar'}</span>
            </div>
            <button type="button" className="btn btn-secondary" aria-label={`Recuperar ${file.name}`}
              disabled={!available || disabled || Boolean(pending)} onClick={() => query(file)}>Recuperar</button>
          </li>;
        })}
      </ul>}
    </div>
  );
}

export default function GoogleDriveSettings({ mode = 'all', disabled = false, onBackupDownloaded, onBusyChange }) {
  const settingsAccess = useSettingsAccess();
  if (!settingsAccess.canAccessSection('backup')) return <NoPermission />;

  if (mode === 'recovery') return <DriveBackupList disabled={disabled} onBackupDownloaded={onBackupDownloaded} onBusyChange={onBusyChange} />;
  return (
    <section className={mode === 'connection' ? 'backup-drive-connection' : 'backup-settings-card backup-settings-card--drive'} aria-label="Conexión Google Drive">
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
        ? <GoogleDriveOAuthControls disabled={disabled} />
        : (
          <div className="backup-settings-notice">
            La conexión con Google Drive no está disponible en esta instalación. Puedes crear y recuperar archivos locales.
          </div>
        )}
      {mode === 'all' && onBackupDownloaded && <DriveBackupList disabled={disabled} onBackupDownloaded={onBackupDownloaded} onBusyChange={onBusyChange} />}
    </section>
  );
}
