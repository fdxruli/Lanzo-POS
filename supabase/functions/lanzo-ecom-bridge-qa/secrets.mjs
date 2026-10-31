// Dedicated server secrets. Never derive either key from service_role.
const enc = new TextEncoder();
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const keyId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(value);
function material(value) {
  if (typeof value !== 'string') throw new Error('SECRET_REQUIRED');
  let bytes;
  try { bytes = decode(value); } catch { throw new Error('SECRET_INVALID'); }
  if (bytes.length !== 32 || encode(bytes) !== value) throw new Error('SECRET_INVALID');
  return bytes;
}
export function createVault({ current, keys } = {}) {
  if (!keyId(current) || !keys || !Object.hasOwn(keys, current) || Object.keys(keys).length > 3) throw new Error('VAULT_CONFIG');
  const ring = new Map(Object.entries(keys).map(([id, value]) => {
    if (!keyId(id)) throw new Error('VAULT_CONFIG');
    return [id, crypto.subtle.importKey('raw', material(value), 'AES-GCM', false, ['encrypt', 'decrypt'])];
  }));
  const aad = (id, binding) => {
    if (typeof binding !== 'string' || !binding) throw new Error('VAULT_BINDING');
    return enc.encode(`lanzo-ecom-bridge:v2:${id}:${binding}`);
  };
  return {
    current,
    async seal(value, binding) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(current, binding) }, await ring.get(current), enc.encode(JSON.stringify(value)));
      return `v2.${current}.${encode(iv)}.${encode(bytes)}`;
    },
    async open(value, binding) {
      if (typeof value !== 'string' || value.length > 32768) throw new Error('VAULT_FORMAT');
      const parts = value.split('.');
      const [version, id, iv, data] = parts;
      if (parts.length !== 4 || version !== 'v2' || !ring.has(id)) throw new Error('VAULT_VERSION');
      const nonce = decode(iv), ciphertext = decode(data);
      if (nonce.length !== 12 || ciphertext.length < 16) throw new Error('VAULT_FORMAT');
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(id, binding) }, await ring.get(id), ciphertext);
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  };
}
export function createPasswordDeriver({ id, secret } = {}) {
  if (!keyId(id)) throw new Error('PASSWORD_CONFIG');
  const key = crypto.subtle.importKey('raw', material(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return async binding => encode(await crypto.subtle.sign('HMAC', await key, enc.encode(`lanzo-ecom-bridge:password:${id}:${binding}`)));
}
export function serverSecrets(env) {
  let keys;
  try { keys = JSON.parse(env.get('LANZO_ECOM_VAULT_KEYS') || 'null'); } catch { throw new Error('VAULT_CONFIG'); }
  const secret = env.get('LANZO_ECOM_PASSWORD_KEY');
  if (keys && Object.values(keys).includes(secret)) throw new Error('SECRET_PURPOSE_REUSE');
  return { vault: createVault({ current: env.get('LANZO_ECOM_VAULT_KEY_ID'), keys }),
    passwordFor: createPasswordDeriver({ id: env.get('LANZO_ECOM_PASSWORD_KEY_ID'), secret }) };
}
