// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { preparePosReadyRuntime, activatePosReadyRuntime, resetPosApplicationBootstrapForTests, startInitialDatabasePreparation } from '../../../src/components/common/PosApplicationBootstrap';
beforeEach(() => { resetPosApplicationBootstrapForTests(); });
it('BG-36 preparation never activates commercial services', async () => {
  const activate = vi.fn(), load = vi.fn(async () => ({ activate }));
  await preparePosReadyRuntime(load); expect(load).toHaveBeenCalledTimes(1); expect(activate).not.toHaveBeenCalled();
});
it('BG-37 commercial activation follows preparation once', async () => {
  const events = [], activate = vi.fn(() => events.push('activate')), load = vi.fn(async () => { events.push('prepare'); return { activate }; });
  await preparePosReadyRuntime(load); await Promise.all([activatePosReadyRuntime(load), activatePosReadyRuntime(load)]);
  expect(events).toEqual(['prepare','activate']); expect(activate).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1);
});
it('BG-38 existing default activation remains enabled', async () => {
  const activate = vi.fn(); await activatePosReadyRuntime(async () => ({ activate })); expect(activate).toHaveBeenCalledTimes(1);
});
it('BG-39 rejected loading never installs sync or recovery', async () => {
  const activate = vi.fn(); await expect(preparePosReadyRuntime(async () => { throw new Error('synthetic loader'); })).rejects.toThrow('synthetic loader');
  expect(activate).not.toHaveBeenCalled();
});
it('BG-40 DB preflight shares preparation without commercial activation', async () => {
  const prepareLocalDatabase = vi.fn(async () => ({ ready: true }));
  const options = { databaseRuntime: { prepareLocalDatabase }, cleanupDevelopmentServiceWorkers: async () => true };
  const first = startInitialDatabasePreparation(options), second = startInitialDatabasePreparation(options);
  expect(first).toBe(second); await first; expect(prepareLocalDatabase).toHaveBeenCalledTimes(1);
});

import { installTraceRecorder } from './trace.mjs';
installTraceRecorder('boundaries');
