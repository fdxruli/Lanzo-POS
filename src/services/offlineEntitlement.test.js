import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  stableStringify,
  verifyOfflineEntitlement
} from './offlineEntitlement';

const toBase64Url = (bytes) => Buffer.from(bytes)
  .toString('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

const buildSignedEntitlement = async (overrides = {}) => {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  );
  const publicKey = await webcrypto.subtle.exportKey('raw', keyPair.publicKey);
  const payload = {
    schema_version: 1,
    license_key: 'LANZO-TEST',
    device_fingerprint: 'device-test',
    plan_code: 'pro_monthly',
    issued_at: '2026-09-08T12:00:00.000Z',
    expires_at: '2026-09-09T12:00:00.000Z',
    ...overrides
  };
  const signature = await webcrypto.subtle.sign(
    { name: 'Ed25519' },
    keyPair.privateKey,
    new TextEncoder().encode(stableStringify(payload))
  );

  return {
    entitlement: { ...payload, signature: toBase64Url(signature) },
    publicKey: toBase64Url(publicKey)
  };
};

describe('offline entitlement verification', () => {
  it('accepts a valid server-signed entitlement', async () => {
    const { entitlement, publicKey } = await buildSignedEntitlement();

    await expect(verifyOfflineEntitlement(
      entitlement,
      publicKey,
      { now: Date.parse('2026-09-08T13:00:00.000Z'), cryptoObject: webcrypto }
    )).resolves.toBe(true);
  });

  it('rejects payload tampering even when the old signature is retained', async () => {
    const { entitlement, publicKey } = await buildSignedEntitlement();

    await expect(verifyOfflineEntitlement(
      { ...entitlement, plan_code: 'free_trial' },
      publicKey,
      { now: Date.parse('2026-09-08T13:00:00.000Z'), cryptoObject: webcrypto }
    )).resolves.toBe(false);
  });

  it('rejects expired and incomplete entitlements', async () => {
    const expired = await buildSignedEntitlement({
      expires_at: '2026-09-08T12:30:00.000Z'
    });
    const missingDevice = await buildSignedEntitlement();
    delete missingDevice.entitlement.device_fingerprint;

    await expect(verifyOfflineEntitlement(
      expired.entitlement,
      expired.publicKey,
      { now: Date.parse('2026-09-08T13:00:00.000Z'), cryptoObject: webcrypto }
    )).resolves.toBe(false);
    await expect(verifyOfflineEntitlement(
      missingDevice.entitlement,
      missingDevice.publicKey,
      { now: Date.parse('2026-09-08T13:00:00.000Z'), cryptoObject: webcrypto }
    )).resolves.toBe(false);
  });
});

