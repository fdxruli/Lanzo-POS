import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CloudOff, FolderKey, LockKeyhole, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useBackupManager } from '../../hooks/useBackupManager';
import { useAppStore } from '../../store/useAppStore';
import { startBackupRiskEvaluator } from '../../services/BackupRiskEvaluator';
import { getBackupRuntimeNotice } from '../../utils/backupRuntimeNotice';
import './BackupRuntime.css';

const IDLE_BACKUP_MS = 4 * 60 * 60 * 1000;

export default function BackupRuntime() {
  const { status, backupManager } = useBackupManager();
  const navigate = useNavigate();
  const needsDriveReauth = useAppStore((state) => state.needsDriveReauth);
  const driveTokenExpiresAt = useAppStore((state) => state.driveTokenExpiresAt);
  const markDriveNeedsReauth = useAppStore((state) => state.markDriveNeedsReauth);
  const dismissedBackupNotice = useAppStore((state) => state.dismissedBackupNotice);
  const dismissBackupNotice = useAppStore((state) => state.dismissBackupNotice);
  const showBackupNotice = useAppStore((state) => state.showBackupNotice);
  const [pin, setPin] = useState('');
  const [actionError, setActionError] = useState('');
  const idleTimerRef = useRef(null);
  const lastActivityRef = useRef(null);

  useEffect(() => {
    startBackupRiskEvaluator();
  }, []);

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

  const notice = getBackupRuntimeNotice(status, needsDriveReauth);

  useEffect(() => {
    if (!notice && dismissedBackupNotice) showBackupNotice();
  }, [dismissedBackupNotice, notice, showBackupNotice]);

  if (!notice || dismissedBackupNotice === notice.key) return null;

  const dismissButton = (
    <button
      type="button"
      className="backup-runtime-banner__dismiss"
      onClick={() => dismissBackupNotice(notice.key)}
      title="Cerrar"
      aria-label="Cerrar aviso de respaldos"
    >
      <X size={18} />
    </button>
  );

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
        {dismissButton}
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className="backup-runtime-banner" role="status">
        <AlertTriangle size={20} />
        <span>Configura los respaldos cifrados para proteger los datos locales.</span>
        <button type="button" onClick={() => navigate('/configuracion?tab=maintenance')}>Configurar</button>
        {dismissButton}
      </div>
    );
  }

  const { needsPermission, needsUnlock } = notice;

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
      {dismissButton}
    </div>
  );
}
