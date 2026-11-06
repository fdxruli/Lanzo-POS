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

describe('createPWASlice update deferral', () => {
  it('keeps the update available when the service worker defers reload', async () => {
    const harness = createSliceHarness();
    harness.actions.setUpdateAvailable(true);
    harness.actions.setTriggerUpdate(async () => false);

    await harness.actions.runUpdate();

    expect(harness.state()).toMatchObject({
      updateAvailable: true,
      showUpdateModal: true,
      isUpdating: false,
    });
  });
});

it('does not forget a pending update when reload was requested but canceled', async () => {
  const harness = createSliceHarness();
  harness.actions.setUpdateAvailable(true, 'build-b');
  harness.actions.setTriggerUpdate(async () => true);
  await harness.actions.runUpdate();
  expect(harness.state()).toMatchObject({ updateAvailable: true, updateError: 'Actualización pendiente de completar.' });
});

it('preserves a postponement for the same build and shows the next build', () => {
  const harness = createSliceHarness();
  harness.actions.setUpdateAvailable(true, 'build-b');
  harness.actions.closeUpdateModal();
  harness.actions.setUpdateAvailable(true, 'build-b');
  expect(harness.state().showUpdateModal).toBe(false);
  harness.actions.openUpdateModal();
  expect(harness.state().showUpdateModal).toBe(true);
  harness.actions.closeUpdateModal();
  harness.actions.setUpdateAvailable(true, 'build-c');
  expect(harness.state().showUpdateModal).toBe(true);
});
