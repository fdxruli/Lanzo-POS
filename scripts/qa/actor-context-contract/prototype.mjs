// RESEARCH ONLY. No imports from src, no credentials, no commercial integration.
// All coordination and synthetic effects share ONE IndexedDB transaction domain.
export const STORES = ['authority', 'contexts', 'operations', 'effects'];
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const exact = (a, b) => a && b && ['tenant', 'token', 'actor', 'session', 'device', 'generation']
  .every((key) => a[key] === b[key]);
const valid = (b) => b && ['tenant', 'token', 'actor', 'session', 'device'].every((k) => typeof b[k] === 'string' && b[k].length > 0)
  && Number.isInteger(b.generation) && b.generation >= 0;
const request = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});
const token = () => {
  if (!globalThis.crypto?.getRandomValues) fail('CRYPTO_UNAVAILABLE');
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
};

export const openPrototype = (name, factory = globalThis.indexedDB) => new Promise((resolve, reject) => {
  if (!factory) return reject(Object.assign(new Error('STORAGE_UNAVAILABLE'), { code: 'STORAGE_UNAVAILABLE' }));
  const r = factory.open(name, 1);
  r.onupgradeneeded = () => { for (const s of STORES) r.result.createObjectStore(s); };
  r.onblocked = () => reject(Object.assign(new Error('STORAGE_BLOCKED'), { code: 'STORAGE_BLOCKED' }));
  r.onerror = () => reject(r.error);
  r.onsuccess = () => {
    const db = r.result; db.onversionchange = () => db.close(); resolve(db);
  };
});

// Await only requests created within this transaction; never await RPC/timers.
export const transaction = (db, stores, mode, run) => new Promise((resolve, reject) => {
  let tx; let result; let error;
  try { tx = db.transaction(stores, mode); } catch (e) { reject(e); return; }
  tx.oncomplete = () => resolve(result);
  tx.onabort = () => reject(error || tx.error || new Error('TX_ABORTED'));
  tx.onerror = () => {}; // onabort reports a single failure
  const api = {
    get: (s, k) => request(tx.objectStore(s).get(k)),
    put: (s, k, v) => request(tx.objectStore(s).put(v, k)),
    all: (s) => request(tx.objectStore(s).getAll()),
    abort: () => { fail('INJECTED_ABORT'); }
  };
  Promise.resolve().then(() => run(api)).then((value) => { result = value; }).catch((e) => {
    error = e; try { tx.abort(); } catch { reject(e); }
  });
});

const readOwner = async (tx, binding) => {
  if (!valid(binding)) fail('INVALID_BINDING');
  const owner = await tx.get('authority', binding.tenant);
  const context = await tx.get('contexts', [binding.tenant, binding.token]);
  if (!owner || owner.protocol !== 2 || owner.status !== 'granted' || !valid(owner.binding)
    || !exact(owner.binding, binding) || context?.status !== 'granted' || !exact(context.binding, binding)) fail('STALE');
  return owner;
};

export const snapshot = (db) => transaction(db, STORES, 'readonly', async (tx) => {
  const values = {};
  for (const s of STORES) values[s] = await tx.all(s);
  return values;
});

// Minimal synthetic Runtime MODEL. This is not actorRuntimeController or a POS login.
export const createClient = (db, initial, options = {}) => {
  let identity = { ...initial };
  let sequence = 0;
  let status = 'UNINITIALIZED';
  let active = null;
  let inaccessible = false;
  const issued = new WeakSet();
  const getDB = () => { if (inaccessible) fail('STORAGE_UNAVAILABLE'); return db; };
  const current = (captured) => {
    if (!active || status !== 'GRANTED' || !exact(active, captured) || captured.generation !== sequence
      || identity.tenant !== captured.tenant || identity.device !== captured.device) fail('RUNTIME_STALE');
  };
  const prepare = () => {
    sequence += 1; status = 'AUTHENTICATING'; active = null;
    return Object.freeze({ ...identity, generation: sequence, token: token(), authorized: true });
  };
  const ticketCurrent = (t) => {
    if (status !== 'AUTHENTICATING' || t.generation !== sequence || t.tenant !== identity.tenant
      || t.device !== identity.device || t.session !== identity.session || t.actor !== identity.actor || t.authorized !== true) fail('AUTH_STALE');
  };
  const grant = async (t, expectedToken = null, { abort = false } = {}) => {
    ticketCurrent(t);
    const binding = Object.freeze({ tenant: t.tenant, token: t.token, actor: t.actor,
      session: t.session, device: t.device, generation: t.generation });
    try {
      await transaction(getDB(), ['authority', 'contexts', 'operations'], 'readwrite', async (tx) => {
        ticketCurrent(t);
        const owner = await tx.get('authority', t.tenant);
        if (owner && (owner.protocol !== 2 || !valid(owner.binding))) fail('CORRUPT_AUTHORITY');
        if ((owner?.binding.token ?? null) !== expectedToken) fail('CONFLICT');
        if ((await tx.all('operations')).some((op) => op.tenant === t.tenant && op.status === 'pending')) fail('HANDOFF_PENDING');
        ticketCurrent(t);
        if (await tx.get('contexts', [t.tenant, t.token])) fail('TOKEN_REUSE');
        if (owner) await tx.put('contexts', [t.tenant, owner.binding.token], { binding: owner.binding, status: 'superseded' });
        await tx.put('contexts', [t.tenant, t.token], { binding, status: 'granted' });
        await tx.put('authority', t.tenant, { protocol: 2, status: 'granted', binding, revision: (owner?.revision || 0) + 1 });
        ticketCurrent(t);
        if (abort) tx.abort();
      });
      ticketCurrent(t);
      active = binding; status = 'GRANTED';
      try { options.notify?.({ tenant: binding.tenant }); } catch { /* best effort outside authority */ }
      return capture();
    } catch (e) {
      if (sequence === t.generation) { status = 'LOCKED'; active = null; }
      throw e;
    }
  };
  const assertBinding = async (binding) => {
    current(binding);
    try {
      await transaction(getDB(), ['authority', 'contexts'], 'readonly', (tx) => readOwner(tx, binding));
      current(binding); return binding;
    } catch (e) {
      if (active === binding) status = 'STALE';
      throw e;
    }
  };
  const capture = () => {
    if (!active || status !== 'GRANTED') fail('LOCKED');
    const captured = active;
    const handle = Object.freeze({ binding: captured, assertCurrent: () => assertBinding(captured) });
    issued.add(handle); return handle;
  };
  const invalidate = async (handle) => {
    if (!issued.has(handle)) fail('HANDLE_NOT_OWNED');
    const binding = handle.binding;
    if (active === binding) { status = 'INVALIDATED'; active = null; sequence += 1; }
    // Only this immutable token is targeted. A stale caller cannot revoke a replacement.
    return transaction(getDB(), ['authority', 'contexts'], 'readwrite', async (tx) => {
      const own = await tx.get('contexts', [binding.tenant, binding.token]);
      if (!own || !exact(own.binding, binding)) fail('UNKNOWN_CONTEXT');
      await tx.put('contexts', [binding.tenant, binding.token], { binding, status: 'revoked' });
      const owner = await tx.get('authority', binding.tenant);
      if (owner?.protocol !== 2 || !valid(owner.binding)) fail('CORRUPT_AUTHORITY');
      if (exact(owner.binding, binding)) {
        await tx.put('authority', binding.tenant, { ...owner, status: 'locked', revision: owner.revision + 1 });
        return { revokedCurrent: true };
      }
      return { revokedCurrent: false };
    });
  };
  const beginOperation = async (handle, id) => {
    current(handle.binding);
    return transaction(getDB(), ['authority', 'contexts', 'operations'], 'readwrite', async (tx) => {
      await readOwner(tx, handle.binding); current(handle.binding);
      if (await tx.get('operations', [handle.binding.tenant, id])) fail('OP_EXISTS');
      const operation = { id, tenant: handle.binding.tenant, owner: handle.binding, status: 'pending' };
      await tx.put('operations', [handle.binding.tenant, id], operation); return operation;
    });
  };
  const commit = async (handle, id, idempotencyKey, { abort = false } = {}) => {
    current(handle.binding);
    return transaction(getDB(), STORES, 'readwrite', async (tx) => {
      await readOwner(tx, handle.binding); current(handle.binding);
      const op = await tx.get('operations', [handle.binding.tenant, id]);
      if (!op || !exact(op.owner, handle.binding)) fail('OP_OWNER_MISMATCH');
      const existing = await tx.get('effects', [handle.binding.tenant, idempotencyKey]);
      if (existing) {
        if (existing.operationId !== id || !exact(existing.owner, handle.binding)) fail('IDEMPOTENCY_OWNER_MISMATCH');
        return existing;
      }
      if (op.status !== 'pending') fail('OP_NOT_PENDING');
      const effect = { idempotencyKey, operationId: id, owner: handle.binding, synthetic: true };
      await tx.put('effects', [handle.binding.tenant, idempotencyKey], effect);
      await tx.put('operations', [handle.binding.tenant, id], { ...op, status: 'committed' });
      current(handle.binding);
      if (abort) tx.abort();
      return effect;
    });
  };
  const onHint = async (hint) => {
    const binding = active;
    if (!binding || hint?.tenant !== binding.tenant) return;
    try { await assertBinding(binding); } catch { /* assert suspends only captured runtime; never grants */ }
  };
  const changeIdentity = (next) => {
    identity = { ...identity, ...next }; active = null; status = 'LOCKED'; sequence += 1;
  };
  return { prepare, grant, capture, invalidate, beginOperation, commit, onHint, changeIdentity,
    blockStorage: (value = true) => { inaccessible = value; },
    state: () => ({ status, generation: sequence, binding: active, identity: { ...identity } }) };
};
