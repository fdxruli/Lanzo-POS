import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CloudOff, FolderKey, LockKeyhole } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useBackupManager } from '../../hooks/useBackupManager';
import { useAppStore } from '../../store/useAppStore';
import './BackupRuntime.css';

const IDLE_BACKUP_MS = 4 * 60 * 60 * 1000;

export default function BackupRuntime() {
  const { status, backupManager } = useBackupManager();
  const navigate = useNavigate();
  const needsDriveReauth = useAppStore((state) => state.needsDriveReauth);
  const driveTokenExpiresAt = useAppStore((state) => state.driveTokenExpiresAt);
  const markDriveNeedsReauth = useAppStore((state) => state.markDriveNeedsReauth);
  const [pin, setPin] = useState('');
  const [actionError, setActionError] = useState('');
  const idleTimerRef = useRef(null);
  const lastActivityRef = useRef(null);

  useEffect(() => {
    if (!driveTokenExpiresAt) return undefined;

    const remainingTime = driveTokenExpiresAt - Date.now();
    if (remainingTime <= 0) {
      markDriveNeedsReauth();
      return undefined;
    }

    const timeoutId = window.setTimeout(markDriveNeedsReauth, remainingTime);
    return () => window.clearTimeout(timeoutId);
  }, [driveTokenExpiresAt, markDriveNeedsReauth]);

  useEffect(() => {
    if (lastActivityRef.current === null) lastActivityRef.current = Date.now();
    const runAutomaticBackup = async () => {
      if (!status.configured || !status.unlocked || status.busy || status.settings.cronBlocked) return;
      try {
        const result = await backupManager.backup({ reason: 'idle_4h', manual: false });
        if (result.success && !result.skipped) toast.success('Respaldo automático completado.');
      } catch (error) {
        toast.error(`Respaldo automático detenido: ${error.message}`);
      }
    };

    const schedule = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      const elapsed = Date.now() - lastActivityRef.current;
      idleTimerRef.current = setTimeout(runAutomaticBackup, Math.max(0, IDLE_BACKUP_MS - elapsed));
    };

    const markActivity = () => {
      lastActivityRef.current = Date.now();
      schedule();
    };

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivityRef.current >= IDLE_BACKUP_MS) runAutomaticBackup();
      else schedule();
    };

    window.addEventListener('pointerdown', markActivity, { passive: true });
    window.addEventListener('keydown', markActivity, { passive: true });
    window.addEventListener('touchstart', markActivity, { passive: true });
    document.addEventListener('visibilitychange', handleVisibility);
    schedule();

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      window.removeEventListener('pointerdown', markActivity);
      window.removeEventListener('keydown', markActivity);
      window.removeEventListener('touchstart', markActivity);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    backupManager,
    status.busy,
    status.configured,
    status.settings.cronBlocked,
    status.unlocked
  ]);

  const handleUnlock = async () => {
    setActionError('');
    try {
      await backupManager.unlock(pin);
      setPin('');
    } catch (error) {
      setActionError(error.message === 'BACKUP_PIN_INVALID' ? 'PIN incorrecto.' : error.message);
    }
  };

  const handlePermission = async () => {
    setActionError('');
    try {
      await backupManager.requestPermission();
    } catch (error) {
      if (error.name !== 'AbortError') setActionError(error.message);
    }
  };

  if (needsDriveReauth) {
    return (
      <div className="backup-runtime-banner backup-runtime-banner--error" role="alert">
        <CloudOff size={20} />
        <div className="backup-runtime-banner__content">
          <strong>Sesión de Google expirada. Haz clic aquí para reactivar los respaldos en la nube.</strong>
        </div>
        <button type="button" onClick={() => navigate('/configuracion?tab=backup')}>
          Reactivar
        </button>
      </div>
    );
  }

  if (!status.initialized || status.busy) return null;

  if (!status.configured) {
    return (
      <div className="backup-runtime-banner" role="status">
        <AlertTriangle size={20} />
        <span>Configura los respaldos cifrados para proteger los datos locales.</span>
        <button type="button" onClick={() => navigate('/configuracion?tab=maintenance')}>Configurar</button>
      </div>
    );
  }

  const needsPermission = status.supported && status.permission !== 'granted';
  const needsUnlock = !status.unlocked;
  const needsAttention = needsPermission || needsUnlock || status.settings.cronPending || status.settings.cronBlocked;
  if (!needsAttention) return null;

  return (
    <div className={`backup-runtime-banner ${status.settings.cronBlocked ? 'backup-runtime-banner--error' : ''}`} role="status">
      {needsUnlock ? <LockKeyhole size={20} /> : <FolderKey size={20} />}
      <div className="backup-runtime-banner__content">
        <strong>
          {status.settings.cronBlocked
            ? 'Respaldos automáticos detenidos'
            : needsUnlock
              ? 'Desbloquea los respaldos de esta sesión'
              : needsPermission
                ? 'Restaura el acceso a la carpeta de respaldos'
                : 'Hay un respaldo pendiente'}
        </strong>
        {actionError && <span className="backup-runtime-banner__error">{actionError}</span>}
      </div>

      {needsUnlock && (
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          minLength={8}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
          placeholder="PIN de respaldo"
          aria-label="PIN de respaldo"
        />
      )}

      {needsUnlock ? (
        <button type="button" onClick={handleUnlock} disabled={pin.length < 8}>
          Desbloquear
        </button>
      ) : needsPermission ? (
        <button type="button" onClick={handlePermission}>Autorizar carpeta</button>
      ) : (
        <button type="button" onClick={() => navigate('/configuracion?tab=maintenance')}>Revisar</button>
      )}
    </div>
  );
}
