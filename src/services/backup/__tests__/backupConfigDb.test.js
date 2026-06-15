import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPersistedBackupKey,
  getPersistedBackupKey,
  savePersistedBackupKey
} from '../backupConfigDb';

describe('backupConfigDb persisted CryptoKey', () => {
  afterEach(async () => {
    await clearPersistedBackupKey();
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
});
