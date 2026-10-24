// Server-only. Never import into frontend. Auth signs; Lanzo authorizes.
const ROLE = 'lanzo_ecom_bridge_receiver';
import { createVault, createPasswordDeriver } from './secrets.mjs';
export { createVault } from './secrets.mjs';
const decode = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export function claimsOf(jwt) {
  return JSON.parse(new TextDecoder().decode(decode(jwt.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))));
}
export function createBroker({ rpc, auth, vault, passwordFor, url, publicKey, now = Date.now }) {
  function validate(session, reservation, checkExpiry = true) {
    const c = claimsOf(session.access_token);
    if (c.sub !== reservation.auth_user_id || (reservation.auth_session_id && c.session_id !== reservation.auth_session_id)
      || c.role !== ROLE || c.iss !== `${url}/auth/v1` || c.aud !== 'authenticated'
      || c.app_metadata?.lanzo_bridge !== 'qa_1a2' || c.app_metadata?.binding_id !== reservation.identity_id
      || !c.session_id || !Number.isFinite(c.exp) || (checkExpiry && c.exp * 1000 <= now() + 5000) || !session.refresh_token) throw new Error('AUTH_CONTRACT');
    return c;
  }
  const denied = code => ({ status: code === 'EXPIRED' ? 410 : code === 'BUSY' ? 409 : ['RATE_LIMITED', 'CAPACITY'].includes(code) ? 429 : 403, body: { code } });
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
      if (input.action === 'recover') {
        // Revoke every topic under its emission barrier before removing Auth.
        // The entire operation requires fresh canonical Lanzo authority.
        const quarantined = await rpc('quarantine', { p });
        if (quarantined.code !== 'QUARANTINED') return denied(quarantined.code);
        if (quarantined.auth_user_id) await auth.deleteOwnedUser(quarantined.auth_user_id, quarantined.identity_id);
        const reset = await rpc('reset_identity', { p: quarantined });
        if (reset.code !== 'RECOVERED') throw new Error('RECOVERY_INCOMPLETE');
        return { status: 200, body: { code: 'RECOVERED', newRuntimeRequired: true, correlationId } };
      }
      reservation = await rpc('prepare', { p });
      if (!['RESERVED', 'CACHED'].includes(reservation.code)) return denied(reservation.code);
      if (reservation.code === 'CACHED') {
        session = await vault.open(reservation.vault, reservation.id);
        validate(session, reservation);
        return connection(reservation, session, reservation.expires_at, correlationId);
      }
      let userId = reservation.auth_user_id;
      if (reservation.vault) {
        const previous = await vault.open(reservation.vault, reservation.id);
        validate(previous, reservation, false);
        // A Lanzo grant renewal is not an Auth refresh. Revalidate authority in
        // finish even when reusing the still-valid JWT and session.
        session = claimsOf(previous.access_token).exp * 1000 > now() + 90000
          ? previous : await auth.refresh(previous.refresh_token);
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
      const c = validate(session, { ...reservation, auth_user_id: userId });
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

/** @param {{url:string, serviceKey:string, publicKey:string, vault?:ReturnType<typeof createVault>, passwordFor?:ReturnType<typeof createPasswordDeriver>, vaultConfig?:Parameters<typeof createVault>[0], passwordConfig?:Parameters<typeof createPasswordDeriver>[0], fetcher?:typeof fetch, now?:()=>number}} options */
export function createBackend({ url, serviceKey, publicKey, vault = undefined, passwordFor = undefined,
  vaultConfig = undefined, passwordConfig = undefined, fetcher = fetch, now = Date.now }) {
  vault ??= createVault(vaultConfig);
  passwordFor ??= createPasswordDeriver(passwordConfig);
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
    async deleteOwnedUser(id, binding) {
      const response = await fetcher(`${url}/auth/v1/admin/users/${id}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(15000) });
      if (response.status === 404) return false;
      if (!response.ok) throw new Error('AUTH_INVENTORY_UNAVAILABLE');
      const u = await response.json();
      // Email and user_metadata are mutable. Immutable binding + exact ID from
      // quarantined inventory are the deletion authority, never the email.
      if (u.id !== id || u.role !== ROLE || u.app_metadata?.lanzo_bridge !== 'qa_1a2' || u.app_metadata?.binding_id !== binding) throw new Error('AUTH_OWNERSHIP');
      await auth.deleteUser(id);
      return true;
    },
  };
  async function collect({ after = null, batchSize = 25, maxBatches = 4, budgetMs = 45000 } = {}) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100
      || !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 10
      || !Number.isInteger(budgetMs) || budgetMs < 1000 || budgetMs > 60000) throw new Error('COLLECTION_BUDGET');
    const deadline = now() + budgetMs;
    const result = { retired: 0, deleted: 0, failed: 0, after, complete: false, budgetExhausted: false };
    const exhausted = () => { if (now() < deadline) return false; result.budgetExhausted = true; return true; };
    // Keyset pagination of our private inventory, never Auth offset pages that
    // shift when users are deleted. SQL also discovers tagged createUser orphans.
    for (let batch = 0; batch < maxBatches; batch++) {
      if (exhausted()) break;
      const rows = await rpc('collect_batch', { p_after: result.after, p_limit: batchSize });
      for (const identity of rows) {
        if (exhausted()) return result;
        let success = true;
        for (const id of identity.auth_user_ids) {
          // If a budget ends mid-identity, leave it unacked and keep the last
          // completed cursor. Retrying exact IDs (including 404) is safe.
          if (exhausted()) return result;
          try { if (await auth.deleteOwnedUser(id, identity.id)) result.deleted++; }
          catch { success = false; result.failed++; }
        }
        // Completion/retry progress is durable. A crash before ack repeats only
        // inventoried IDs; Auth 404 is an idempotent success.
        await rpc('collect_ack', { p_id: identity.id, p_success: success });
        result.retired++; result.after = identity.id;
      }
      if (rows.length < batchSize) { result.complete = true; break; }
    }
    return result;
  }
  async function rotateVault() {
    const rows = await rpc('vault_batch');
    const result = { rotated: 0, conflicted: 0, failed: 0 };
    for (const row of rows) {
      try {
        const sealed = await vault.seal(await vault.open(row.vault, row.id), row.id);
        const changed = await rpc('vault_cas', { p_id: row.id, p_previous: row.vault, p_next: sealed });
        result[changed ? 'rotated' : 'conflicted']++;
      } catch { result.failed++; }
    }
    return result;
  }
  return { rpc, auth, collect, rotateVault, issue: createBroker({ rpc, auth, passwordFor, vault, url, publicKey }) };
}
