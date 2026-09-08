const OFFLINE_ENTITLEMENT_SCHEMA_VERSION = 1;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const toBase64UrlBytes = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = globalThis.atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};

const toBytes = (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return toBase64UrlBytes(value);
};

export const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }

  return JSON.stringify(value);
};

const signedPayload = (entitlement) => {
  if (!entitlement || typeof entitlement !== 'object') return null;
  const payload = Object.fromEntries(
    Object.entries(entitlement).filter(([key]) => key !== 'signature')
  );
  return stableStringify(payload);
};

export const getConfiguredOfflineEntitlementPublicKey = () => (
  import.meta.env.VITE_OFFLINE_ENTITLEMENT_PUBLIC_KEY || null
);

export const verifyOfflineEntitlement = async (
  entitlement,
  publicKeyValue,
  { now = Date.now(), cryptoObject = globalThis.crypto } = {}
) => {
  if (!entitlement || typeof entitlement !== 'object') return false;
  if (entitlement.schema_version !== OFFLINE_ENTITLEMENT_SCHEMA_VERSION) return false;
  if (!entitlement.license_key || !entitlement.device_fingerprint) return false;
  if (!entitlement.issued_at || !entitlement.expires_at || !entitlement.signature) return false;

  const issuedAt = Date.parse(entitlement.issued_at);
  const expiresAt = Date.parse(entitlement.expires_at);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return false;
  if (issuedAt > now + CLOCK_SKEW_MS || expiresAt <= now) return false;

  const publicKeyBytes = toBytes(publicKeyValue);
  const signatureBytes = toBytes(entitlement.signature);
  if (!publicKeyBytes || publicKeyBytes.byteLength !== 32 || !signatureBytes) return false;

  const subtle = cryptoObject?.subtle;
  if (!subtle) return false;

  try {
    const publicKey = await subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    return await subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      signatureBytes,
      new TextEncoder().encode(signedPayload(entitlement))
    );
  } catch {
    return false;
  }
};

export const OFFLINE_ENTITLEMENT_TRUST = Object.freeze({
  SIGNED: 'signed',
  UNTRUSTED_CACHE: 'untrusted_cache',
  LEGACY_UNTRUSTED: 'legacy_untrusted'
});
