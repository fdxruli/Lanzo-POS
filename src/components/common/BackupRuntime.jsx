import { useEffect, useRef, useState } from 'react';
import { DatabaseBackup } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useBackupManager } from '../../hooks/useBackupManager';
import { useAppStore } from '../../store/useAppStore';
import { startBackupRiskEvaluator } from '../../services/BackupRiskEvaluator';
import { useLocalBackupAttention } from '../../hooks/useLocalBackupAttention';
import './BackupRuntime.css';

const IDLE_BACKUP_MS = 4 * 60 * 60 * 1000;

export default function BackupRuntime() {
  const { status, backupManager } = useBackupManager();
  const navigate = useNavigate();
  const driveTokenExpiresAt = useAppStore((state) => state.driveTokenExpiresAt);
  const markDriveNeedsReauth = useAppStore((state) => state.markDriveNeedsReauth);
  const attention = useLocalBackupAttention({ status });
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

  if (!attention.ready || !attention.condition?.active) return null;
  return <InitialBackupNotice key={attention.key} attention={attention} navigate={navigate} />;
}

function InitialBackupNotice({ attention, navigate }) {
  const [visible, setVisible] = useState(() => !attention.record?.presentedAt && !attention.record?.readStates?.length);
  const { update, condition } = attention;
  useEffect(() => {
    if (visible) update('presented');
  }, [update, visible]);
  if (!visible || attention.record?.readStates?.length) return null;
  return (
    <div className="backup-runtime-banner" role="status">
      <DatabaseBackup size={20} aria-hidden="true" />
      <div className="backup-runtime-banner__content">
        <strong>Revisa la protección de tus datos</strong>
        <span>Los respaldos que necesitan atención estarán en la campana.</span>
      </div>
      <div className="backup-runtime-banner__actions">
        <button type="button" onClick={() => {
          if (!update('read', condition.key)) return;
          setVisible(false);
          navigate(condition.route);
        }}>Revisar respaldos</button>
        <button type="button" className="backup-runtime-banner__postpone" onClick={() => {
          update('postpone');
          setVisible(false);
        }}>Más tarde</button>
      </div>
    </div>
  );
}
