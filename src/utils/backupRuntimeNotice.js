export function getBackupRuntimeNotice(status, needsDriveReauth) {
  if (needsDriveReauth) {
    return {
      key: 'drive-reauth',
      navbarLabel: 'Reactivar respaldos'
    };
  }

  if (!status.initialized || status.busy) return null;

  if (!status.configured) {
    return {
      key: 'configure',
      navbarLabel: 'Configurar respaldos'
    };
  }

  const needsPermission = status.supported && status.permission !== 'granted';
  const needsUnlock = !status.unlocked;

  if (status.settings.cronBlocked) {
    return {
      key: 'cron-blocked',
      navbarLabel: 'Revisar respaldos',
      needsPermission,
      needsUnlock
    };
  }

  if (needsUnlock) {
    return {
      key: 'unlock',
      navbarLabel: 'Desbloquear respaldos',
      needsPermission,
      needsUnlock
    };
  }

  if (needsPermission) {
    return {
      key: 'permission',
      navbarLabel: 'Autorizar respaldos',
      needsPermission,
      needsUnlock
    };
  }

  if (status.settings.cronPending) {
    return {
      key: 'cron-pending',
      navbarLabel: 'Revisar respaldo pendiente',
      needsPermission,
      needsUnlock
    };
  }

  return null;
}
