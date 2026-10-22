// Server-only. Never import into frontend. Auth signs; Lanzo authorizes.
const ROLE = 'lanzo_ecom_bridge_receiver';
const enc = new TextEncoder();
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export function claimsOf(jwt) {
  return JSON.parse(new TextDecoder().decode(decode(jwt.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))));
}
export function createVault(secret) {
  const key = crypto.subtle.digest('SHA-256', enc.encode(`lanzo-ecom-bridge-qa:v1:${secret}`))
    .then(bytes => crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']));
  return {
    async seal(value, binding) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(binding) }, await key, enc.encode(JSON.stringify(value)));
      return `v1.${encode(iv)}.${encode(bytes)}`;
    },
    async open(value, binding) {
      const [version, iv, data] = value.split('.');
      if (version !== 'v1') throw new Error('VAULT_VERSION');
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: enc.encode(binding) }, await key, decode(data));
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  };
}

export function createBroker({ rpc, auth, vault, passwordFor, url, publicKey, now = Date.now }) {
  const denied = code => ({ status: code === 'BUSY' ? 409 : ['RATE_LIMITED', 'CAPACITY'].includes(code) ? 429 : 403, body: { code } });
  const connection = (reservation, session, expiresAt, correlationId) => ({
    status: 200,
    body: { url, publicKey, accessToken: session.access_token,
      jwtExpiresAt: claimsOf(session.access_token).exp * 1000,
      grantExpiresAt: Date.parse(expiresAt), grantId: reservation.id,
      topic: `ecom:qa-probe:1a2:${reservation.id}`, correlationId },
  });
  return async function issue(input) {
    const correlationId = crypto.randomUUID();
    let reservation, session, createdUser;
    try {
      // Whitelist fields. tenant/actor/device IDs supplied by caller are ignored.
      const p = Object.fromEntries(['license_key', 'device_fingerprint', 'security_token', 'actor_session_token',
        'runtime_id', 'actor_generation', 'tenant_generation'].map(k => [k, input[k]]));
      reservation = await rpc('prepare', { p });
      if (!['RESERVED', 'CACHED'].includes(reservation.code)) return denied(reservation.code);
      if (reservation.code === 'CACHED') {
        session = await vault.open(reservation.vault, reservation.id);
        if (claimsOf(session.access_token).exp * 1000 <= now() + 5000) return denied('DENIED');
        return connection(reservation, session, reservation.expires_at, correlationId);
      }
      let userId = reservation.auth_user_id;
      if (reservation.vault) {
        const previous = await vault.open(reservation.vault, reservation.id);
        session = await auth.refresh(previous.refresh_token);
      } else {
        const email = `qa-ecom-1a2-${reservation.identity_id}@example.invalid`;
        const password = await passwordFor(reservation.identity_id);
        if (!userId) {
          const user = await auth.createUser({ email, password, email_confirm: true, role: ROLE,
            app_metadata: { lanzo_bridge: 'qa_1a2', binding_id: reservation.identity_id } });
          createdUser = user.id;
          userId = user.id;
        }
        session = await auth.signIn(email, password);
      }
      const c = claimsOf(session.access_token);
      if (c.sub !== userId || c.role !== ROLE || c.iss !== `${url}/auth/v1` || c.aud !== 'authenticated'
        || c.app_metadata?.lanzo_bridge !== 'qa_1a2' || c.app_metadata?.binding_id !== reservation.identity_id
        || !c.session_id || c.exp * 1000 <= now() + 5000 || !session.refresh_token) throw new Error('AUTH_CONTRACT');
      const result = await rpc('finish', { p: { id: reservation.id, lease_id: reservation.lease_id,
        auth_user_id: userId, auth_session_id: c.session_id, vault: await vault.seal(session, reservation.id) } });
      if (result.code !== 'READY') throw new Error('FINAL_AUTHORITY_DENIED');
      return connection(reservation, session, result.expires_at, correlationId);
    } catch {
      // Failure closes this grant permanently. A timed-out createUser can leave
      // a tagged orphan: collector reconciles it after the in-flight grace period.
      // Reconcile SQL BEFORE compensating Auth: finish might have committed
      // even when its HTTP response was lost. Only an accepted abort proves
      // that no binding committed under this lease. Otherwise keep the tagged
      // identity for an idempotent retry / quarantined collector reconciliation.
      let aborted = false;
      if (reservation?.lease_id) aborted = await rpc('abort', { p: { id: reservation.id, lease_id: reservation.lease_id } }).catch(() => false);
      if (aborted === true) {
        if (session?.access_token) await auth.signOut(session.access_token).catch(() => {});
        if (createdUser) await auth.deleteUser(createdUser).catch(() => {});
      }
      return { status: 503, body: { code: 'UNAVAILABLE', correlationId } };
    }
  };
}

export function createBackend({ url, serviceKey, publicKey, fetcher = fetch }) {
  async function request(path, body, key = serviceKey, method = 'POST') {
    const response = await fetcher(`${url}${path}`, { method,
      headers: { apikey: serviceKey, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`BACKEND_${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  const rpc = (name, args = {}) => request(`/rest/v1/rpc/lanzo_ecom_bridge_qa_${name}`, args);
  const auth = {
    createUser: body => request('/auth/v1/admin/users', body),
    signIn: (email, password) => request('/auth/v1/token?grant_type=password', { email, password }),
    refresh: refresh_token => request('/auth/v1/token?grant_type=refresh_token', { refresh_token }),
    signOut: jwt => request('/auth/v1/logout?scope=local', undefined, jwt),
    deleteUser: id => request(`/auth/v1/admin/users/${id}`, undefined, serviceKey, 'DELETE'),
  };
  async function passwordFor(id) {
    const key = await crypto.subtle.importKey('raw', enc.encode(serviceKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return encode(await crypto.subtle.sign('HMAC', key, enc.encode(`lanzo-ecom-bridge-qa:password:v1:${id}`)));
  }
  async function collect() {
    const retired = await rpc('collect');
    const eligible = new Set(retired.map(x => x.id));
    let deleted = 0;
    // Hard QA scan bound. Global identity cap is 10; never scan unbounded pages.
    // Only exact app_metadata AND exact synthetic email are deletion authority.
    for (let page = 1; page <= 10; page++) {
      const { users = [] } = await request(`/auth/v1/admin/users?page=${page}&per_page=100`, undefined, serviceKey, 'GET');
      for (const u of users) {
        const id = u.app_metadata?.binding_id;
        if (u.app_metadata?.lanzo_bridge === 'qa_1a2' && eligible.has(id)
          && u.email === `qa-ecom-1a2-${id}@example.invalid`
          && Date.parse(u.created_at) < Date.now() - 180000) {
          await auth.deleteUser(u.id); deleted++;
        }
      }
      if (users.length < 100) break;
    }
    return { retired: retired.length, deleted };
  }
  return { rpc, auth, collect, issue: createBroker({ rpc, auth, passwordFor, vault: createVault(serviceKey), url, publicKey }) };
}
