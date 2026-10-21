// SYNTHETIC_BOUNDARY_ONLY. No application bootstrap or backend.
import * as prototype from '/prototype.mjs';
import { admissionDecision } from '/admission.mjs';
const query = new URL(location).searchParams;
const id = query.get('id') || 'cache-case';
const kind = query.get('kind') || 'legacy';
// Exact binding format required by main; never opened as an IndexedDB name.
const tenant = { opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', generation: 1 };
window.ready = (async () => {
  const db = await prototype.openPrototype(`supervised-${id}`);
  window.lab = { kind, id, db, prototype, admission: admissionDecision(), executedSource: kind === 'legacy' ? 'MAIN_EXACT_MODULE' : 'RESEARCH_PROTOTYPE' };
  if (kind === 'legacy') {
    const legacy = await import('/main.mjs');
    const mount = async () => {
      await legacy.prepareActorScopedStorage({ tenant, actorKey: 'admin:fixture', actorGeneration: 1 });
      legacy.activateActorScopedStorage({ tenant, actorKey: 'admin:fixture', generation: 1 });
      legacy.resumeActorScopedStorageWrites();
      window.lab.handle = legacy.captureActorScopedStorageHandle();
    };
    await mount();
    Object.assign(window.lab, { legacy, mount, write: async () => {
      try { window.lab.handle.assertCurrent(); window.lab.handle.setItem('commercial-ai-sales-profitability-history-v1', 'synthetic-effect'); return { committed: true }; }
      catch (error) { return { committed: false, error: error.code || error.name }; }
    }});
  } else {
    const client = prototype.createClient(db, { tenant: 'synthetic-T', actor: 'admin:B', session: 'session-B', device: 'device-A' });
    // Deliberately bypass admission ONLY for a counterexample, never a real grant.
    const handle = await client.grant(client.prepare());
    Object.assign(window.lab, { client, handle, sequence: 0, write: async () => {
      try { const operation = `probe-${++window.lab.sequence}`; await client.beginOperation(handle, operation); await client.commit(handle, operation, operation); return { committed: true }; }
      catch (error) { return { committed: false, error: error.code || error.name }; }
    }});
  }
  window.lab.snapshot = async () => ({ kind, id, admission: admissionDecision(), runtime: window.lab.client?.state() || 'NOT_LOADED_storage_only', durable: await prototype.snapshot(db), legacy: localStorage.getItem('lanzo:t:t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:actor-runtime-context:v1') });
  window.addEventListener('pageshow', (event) => { window.lab.pageshowPersisted = event.persisted; });
  return true;
})();
