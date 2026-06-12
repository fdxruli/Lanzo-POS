import { useEffect, useState } from 'react';
import { backupManager } from '../services/backup/backupManager';

export function useBackupManager() {
  const [status, setStatus] = useState(() => backupManager.getStatus());

  useEffect(() => {
    const unsubscribe = backupManager.subscribe(setStatus);
    backupManager.initialize().catch(() => {});
    return unsubscribe;
  }, []);

  return { status, backupManager };
}
