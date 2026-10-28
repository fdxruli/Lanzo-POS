import { beforeEach, afterEach, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createBootstrapLifecycle as createScope } from '../../../src/services/bootstrap/bootstrapLifecycle.js';
let scopes = [];
export const createBootstrapLifecycle = options => {
  const scope = createScope(options), counters = { registered: 0, started: 0, finished: 0 };
  scopes.push({ scope, counters });
  return Object.freeze({ ...scope, track(factory) {
    counters.registered++;
    return scope.track(async () => {
      counters.started++;
      try { return await factory(); } finally { counters.finished++; }
    });
  } });
};
export const installTraceRecorder = (name, { readState = () => ({ authority: 'not_exercised' }), metrics = () => ({}) } = {}) => {
  const traces = [];
  let initial;
  beforeEach(() => { scopes = []; initial = readState(); });
  afterEach(({ task }) => {
    traces.push({ contract: task.name, initial, final: readState(), metrics: metrics(),
      scopes: scopes.map(({scope,counters}) => ({ ...counters, ...scope.getSnapshot() })),
      result: task.result?.state || 'see_matrix_json',
      limitations: 'Synthetic providers and fake timers where declared. No server, physical PWA, real payment or whole-App drainage.' });
  });
  afterAll(() => {
    mkdirSync('scripts/qa/single-instance-f012b/evidence/traces', { recursive: true });
    writeFileSync(`scripts/qa/single-instance-f012b/evidence/traces/${name}.json`, JSON.stringify(traces,null,2));
  });
};
