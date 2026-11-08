import { isLocalStationKey } from '../cash/cashStation';

const DEVICE_ID_FIELDS = [
  'deviceId', 'device_id', 'deviceFingerprint', 'device_fingerprint',
  'openedByDeviceId', 'opened_by_device_id'
];

const newArchivedStationKey = () => {
  const id = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `local:device:backup-${id}`;
};

export const createBackupCashIdentitySanitizer = () => {
  const archivedStationBySource = new Map();
  const archiveStationKey = (value) => {
    if (!isLocalStationKey(value)) return value;
    if (!archivedStationBySource.has(value)) {
      archivedStationBySource.set(value, newArchivedStationKey());
    }
    return archivedStationBySource.get(value);
  };

  return (tableName, value, key) => {
    if (tableName !== 'cajas' && tableName !== 'movimientos_caja') return { value, key };
    const sanitized = { ...value };
    for (const field of DEVICE_ID_FIELDS) delete sanitized[field];

    const sourceStationKey = sanitized.localStationKey
      || sanitized.local_station_key
      || sanitized.cashStationId
      || sanitized.cash_station_id;
    if (isLocalStationKey(sourceStationKey)) {
      sanitized.localStationKey = archiveStationKey(sourceStationKey);
      delete sanitized.local_station_key;
      if (sanitized.cashStationId === sourceStationKey) delete sanitized.cashStationId;
      if (sanitized.cash_station_id === sourceStationKey) delete sanitized.cash_station_id;
      sanitized.cashIdentityState = 'local';
    }

    return { value: sanitized, key };
  };
};
