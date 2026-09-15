import { describe, expect, it } from 'vitest';
import { createPWASlice } from './createPWASlice';

const createSliceHarness = () => {
  let state;
  const set = (update) => {
    const patch = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...patch };
  };
  const get = () => state;
  state = createPWASlice(set, get);
  return { state: () => state, actions: state };
};

describe('createPWASlice install invitation', () => {
  it('does not open the automatic modal when the app becomes installable', () => {
    const harness = createSliceHarness();

    harness.actions.setDeferredPrompt({ prompt: () => {} });
    expect(harness.state().isInstallable).toBe(true);
    expect(harness.state().showInstallModal).toBe(false);

    harness.actions.setInstallContext({ isIOS: true, isStandalone: false });
    expect(harness.state().showInstallModal).toBe(false);
  });

  it('keeps explicit opening available for the delayed policy', () => {
    const harness = createSliceHarness();
    harness.actions.setDeferredPrompt({ prompt: () => {} });

    harness.actions.openInstallModal();

    expect(harness.state().showInstallModal).toBe(true);
  });
});
