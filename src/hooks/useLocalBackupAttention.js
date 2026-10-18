import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useSettingsAccess, useSettingsActionGuard } from '../services/auth/useSettingsAccess';
import { actorRuntimeController } from '../services/auth/actorRuntimeController';
import {
  buildLocalBackupAttentionKey, LOCAL_BACKUP_ATTENTION_EVENT,
  readLocalBackupAttention, updateLocalBackupAttention
} from '../services/backup/localBackupAttention';
import { shouldUseLocalBackupAlerts } from '../services/notifications/notificationCapabilities';
import { isCloudPosSyncEnabled } from '../services/sync/syncConstants';
import { getLocalBackupAttention } from '../utils/backupRuntimeNotice';

export function useLocalBackupAttention({ status: providedStatus } = {}) {
  const access = useSettingsAccess();
  const captureSettingsAction = useSettingsActionGuard();
  const license = useAppStore((state) => state.licenseDetails);
  const needsDriveReauth = useAppStore((state) => state.needsDriveReauth);
  const runtime = actorRuntimeController.getState();
  const enabled = Boolean(
    shouldUseLocalBackupAlerts(license) && !isCloudPosSyncEnabled(license)
    && access.canAccessSection('backup') && access.generation === runtime.generation
    && runtime.tenant?.databaseName && runtime.deviceRef
  );
  const scope = enabled ? JSON.stringify([runtime.tenant.databaseName, access.actorKey, runtime.deviceRef]) : null;
  const generation = access.generation;
  const [context, setContext] = useState(null);
  const [managerSnapshot, setManagerSnapshot] = useState(null);
  const managerStatus = managerSnapshot?.scope === scope && managerSnapshot?.generation === generation
    ? managerSnapshot.status : null;
  const status = providedStatus || managerStatus;
  const [stable, setStable] = useState(null);

  useEffect(() => {
    if (!enabled || providedStatus) return undefined;
    let current = true;
    let unsubscribe;
    // Cloud and unauthorized bells do not import or initialize the manager.
    void import('../services/backup/backupManager').then(({ backupManager }) => {
      if (!current) return;
      unsubscribe = backupManager.subscribe((next) => {
        if (current) setManagerSnapshot({ scope, generation, status: next });
      });
      void backupManager.initialize().catch(() => {});
    }).catch(() => {});
    return () => { current = false; unsubscribe?.(); };
  }, [enabled, providedStatus, scope, generation]);

  useEffect(() => {
    let current = true;
    if (!scope) return undefined;
    let handle;
    try { handle = captureSettingsAction('sync'); } catch { return undefined; }
    if (handle.generation !== generation || handle.actorKey !== access.actorKey) return undefined;
    const [databaseName, actorKey, deviceRef] = JSON.parse(scope);
    void buildLocalBackupAttentionKey({ databaseName, actorKey, deviceRef }).then((key) => {
      if (!current || !key) return;
      try { handle.assertCurrent('sync'); } catch { return; }
      setContext({ scope, generation, key, handle, record: readLocalBackupAttention(key) });
    });
    return () => { current = false; };
  }, [scope, generation, access.actorKey, captureSettingsAction]);

  const currentContext = context?.scope === scope && context?.generation === generation ? context : null;
  const key = currentContext?.key;
  useEffect(() => {
    if (!key) return undefined;
    const refresh = (event) => {
      if (event.type === 'storage' ? event.key !== key && event.key !== null : event.detail?.key !== key) return;
      setContext((value) => value?.key === key ? { ...value, record: readLocalBackupAttention(key) } : value);
    };
    window.addEventListener(LOCAL_BACKUP_ATTENTION_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(LOCAL_BACKUP_ATTENTION_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [key]);

  useEffect(() => {
    if (scope && status?.initialized && !status.busy) setStable({ scope, generation, status });
  }, [scope, generation, status]);
  const stableStatus = stable?.scope === scope && stable?.generation === generation ? stable.status : null;
  const condition = enabled
    ? getLocalBackupAttention(status?.busy ? stableStatus : status, needsDriveReauth)
    : null;

  const update = useCallback((action, conditionKey) => {
    if (!currentContext) return false;
    try { currentContext.handle.assertCurrent('sync'); } catch { return false; }
    const record = updateLocalBackupAttention(currentContext.key, action, conditionKey);
    // Child presentation effects can run before our event subscription mounts.
    // Keep this hook current even when that first event has no listener yet.
    setContext((value) => value?.key === currentContext.key
      && value.generation === currentContext.generation
      && JSON.stringify(value.record) !== JSON.stringify(record)
      ? { ...value, record } : value);
    return true;
  }, [currentContext]);

  return {
    enabled, ready: Boolean(enabled && currentContext), key,
    condition: enabled ? condition : null,
    record: currentContext?.record,
    update
  };
}
