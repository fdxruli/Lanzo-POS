export const LOCAL_BACKUP_ROUTE = '/configuracion?tab=backup';

/** UI projection only. Reading or dismissing this condition never changes the manager. */
export function getLocalBackupAttention(status, needsDriveReauth = false) {
  if (!status?.initialized || status.busy) return null;
  const settings = status.settings || {};
  const notice = (key, title, action, detail, severity = 'warning') => ({
    key, title, action, detail, severity, active: true, route: LOCAL_BACKUP_ROUTE
  });
  if (needsDriveReauth) return notice('drive-reauth', 'Se necesita reactivar Google Drive', 'Reactivar', 'Revisa la conexión de tus respaldos en Configuración.');
  if (settings.cronBlocked || settings.lastResult === 'error') {
    return notice('error', 'Los respaldos necesitan atención', 'Revisar problema', 'El último problema sigue pendiente de revisión.', 'critical');
  }
  if (!status.configured) return notice('configure', 'Configura tus respaldos', 'Ir a respaldos', 'Protege los datos locales con una copia cifrada.');
  if (status.supported && status.permission !== 'granted') {
    return notice('permission', 'Se necesita autorizar la carpeta', 'Autorizar carpeta', 'Revisa el acceso a la carpeta desde Respaldos.');
  }
  if (!status.unlocked) return notice('unlock', 'Respaldos cifrados bloqueados', 'Desbloquear', 'Introduce tu PIN en Configuración → Respaldos cuando puedas.');
  if (settings.cronPending) {
    return notice('pending', 'Hay un respaldo pendiente', 'Revisar', status.supported
      ? 'Revisa los respaldos pendientes en Configuración.'
      : 'Este navegador requiere descargar las copias manualmente.');
  }
  const confirmed = settings.lastResult === 'success' && typeof settings.lastBackupAt === 'string'
    && Number.isFinite(Date.parse(settings.lastBackupAt));
  return {
    key: 'ready', active: false, severity: 'info', route: LOCAL_BACKUP_ROUTE, action: 'Ir a respaldos',
    title: confirmed ? (status.supported ? 'Protección local activa' : 'Última copia local realizada') : 'Listo para respaldar',
    detail: !status.supported ? 'En este navegador, genera las copias manualmente.'
      : confirmed ? 'No hay incidencias de respaldo pendientes.' : 'Aún no se ha confirmado una copia local.'
  };
}
