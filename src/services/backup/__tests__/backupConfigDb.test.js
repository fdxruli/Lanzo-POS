/* @vitest-environment jsdom */

import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';
import {
  clearBackupSettings,
  clearPersistedBackupKey,
  getBackupSettings,
  getLegacyBackupConfiguration,
  getPersistedBackupKey,
  saveBackupSettings,
  savePersistedBackupKey
} from '../backupConfigDb';

describe('backupConfigDb persisted CryptoKey', () => {
  afterEach(async () => {
    await Promise.all([
      'primary', 't_business-a', 't_business-b'
    ].flatMap((tenantKey) => [clearBackupSettings(tenantKey), clearPersistedBackupKey(tenantKey)]));
  });

  it('guarda y recupera una clave AES-GCM no extraible', async () => {
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    await savePersistedBackupKey({
      key,
      verifier: 'verifier',
      salt: 'salt',
      iterations: 600000,
      sessionId: 'session-1'
    });

    const stored = await getPersistedBackupKey();
    expect(stored.key.extractable).toBe(false);
    expect(stored.key.algorithm.name).toBe('AES-GCM');
    expect(stored.sessionId).toBe('session-1');

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      stored.key,
      new TextEncoder().encode('backup-key-check')
    );
    expect(encrypted.byteLength).toBeGreaterThan(0);
  });

  it('preserves the V1 shared configuration and key as unassigned while business configs stay separate', async () => {
    const priorFileName = 'RESPALDO_LANZO_legacy_2026-01-01.lzbk';
    const legacyKey = { id: 'legacy-key-placeholder' };
    await saveBackupSettings({
      configured: true,
      directoryName: 'Respaldos V1',
      salt: 'legacy-salt',
      verifier: 'legacy-verifier',
      lastBackupAt: '2026-01-01T00:00:00.000Z',
      lastBackupFile: priorFileName
    }, 'primary');
    await savePersistedBackupKey({
      key: legacyKey,
      verifier: 'legacy-verifier',
      salt: 'legacy-salt',
      iterations: 600000,
      sessionId: 'legacy-session'
    }, 'primary');

    const businessA = await getBackupSettings('t_business-a');
    expect(businessA.configured).toBe(false);
    await saveBackupSettings({ configured: true, salt: 'business-a-salt', verifier: 'a' }, 't_business-a');
    await saveBackupSettings({ configured: false, directoryName: 'Carpeta B' }, 't_business-b');

    const [legacyNotice, legacySettings, unchangedLegacyKey, aSettings, bSettings] = await Promise.all([
      getLegacyBackupConfiguration(),
      getBackupSettings('primary'),
      getPersistedBackupKey('primary'),
      getBackupSettings('t_business-a'),
      getBackupSettings('t_business-b')
    ]);

    expect(legacyNotice).toMatchObject({
      available: true,
      configured: true,
      hasPersistedKey: true,
      directoryName: 'Respaldos V1',
      lastBackupFile: priorFileName
    });
    expect(legacySettings.lastBackupFile).toBe(priorFileName);
    expect(unchangedLegacyKey.key).toEqual(legacyKey);
    expect(aSettings).toMatchObject({ configured: true, salt: 'business-a-salt' });
    expect(bSettings).toMatchObject({ configured: false, directoryName: 'Carpeta B' });
  });
});
