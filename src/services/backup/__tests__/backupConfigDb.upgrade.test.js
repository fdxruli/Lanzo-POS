/* @vitest-environment jsdom */

import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONFIG_DB_NAME,
  getBackupSettings,
  getLegacyBackupConfiguration,
  saveBackupSettings
} from '../backupConfigDb';

describe('backupConfigDb V1 upgrade', () => {
  afterEach(async () => {
    await Dexie.delete(CONFIG_DB_NAME);
  });

  it('retains a valid V1 primary row while new tenant settings remain separate', async () => {
    const legacy = new Dexie(CONFIG_DB_NAME);
    legacy.version(1).stores({ settings: 'id' });
    await legacy.open();
    await legacy.table('settings').put({
      id: 'primary',
      configured: true,
      directoryName: 'V1 backups',
      salt: 'v1-salt',
      verifier: 'v1-verifier',
      lastBackupAt: '2026-01-10T00:00:00.000Z',
      lastBackupFile: 'RESPALDO_LANZO_legacy.lzbk'
    });
    legacy.close();

    const notice = await getLegacyBackupConfiguration();
    const tenantSettings = await getBackupSettings('t_v1-upgrade-business');
    await saveBackupSettings({ configured: true, salt: 'tenant-salt', verifier: 'tenant-verifier' }, 't_v1-upgrade-business');

    expect(notice).toMatchObject({
      available: true,
      configured: true,
      directoryName: 'V1 backups',
      lastBackupFile: 'RESPALDO_LANZO_legacy.lzbk'
    });
    expect(tenantSettings.configured).toBe(false);
    expect(await getBackupSettings('t_v1-upgrade-business')).toMatchObject({
      configured: true,
      salt: 'tenant-salt'
    });
    expect(await getBackupSettings('primary')).toMatchObject({
      configured: true,
      salt: 'v1-salt',
      lastBackupFile: 'RESPALDO_LANZO_legacy.lzbk'
    });
  });
});
