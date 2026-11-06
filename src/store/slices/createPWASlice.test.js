import { beforeEach, describe, expect, it, vi } from 'vitest';

const updates = vi.hoisted(() => ({
  cartState: { hasOpenCart: false, checkoutLocked: false },
  confirm: vi.fn(async () => true),
  message: vi.fn()
}));

vi.mock('../../pwa/adminUpdateSafety', () => ({
  getAdminUpdateCartState: () => updates.cartState
}));
vi.mock('../../services/utils', () => ({
  showConfirmModal: updates.confirm,
  showMessageModal: updates.message
}));

beforeEach(() => {
  updates.cartState = { hasOpenCart: false, checkoutLocked: false };
  updates.confirm.mockReset().mockResolvedValue(true);
  updates.message.mockClear();
});
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


describe('createPWASlice update safety feedback', () => {
  it('asks before reloading a normal cart with items', async () => {
    const harness = createSliceHarness();
    const trigger = vi.fn(async () => true);
    updates.cartState.hasOpenCart = true;
    harness.actions.setUpdateAvailable(true);
    harness.actions.setTriggerUpdate(trigger);

    await harness.actions.runUpdate();

    expect(updates.confirm).toHaveBeenCalledOnce();
    expect(trigger).toHaveBeenCalledOnce();
  });

  it('does not update when the user postpones a cart warning', async () => {
    const harness = createSliceHarness();
    const trigger = vi.fn(async () => true);
    updates.cartState.hasOpenCart = true;
    updates.confirm.mockResolvedValueOnce(false);
    harness.actions.setUpdateAvailable(true);
    harness.actions.setTriggerUpdate(trigger);

    await harness.actions.runUpdate();

    expect(trigger).not.toHaveBeenCalled();
    expect(harness.state().isUpdating).toBe(false);
    expect(harness.state().updateAvailable).toBe(true);
  });

  it('never bypasses a checkout lock, even if the order is persisted', async () => {
    const harness = createSliceHarness();
    const trigger = vi.fn(async () => true);
    updates.cartState = { hasOpenCart: true, checkoutLocked: true };
    harness.actions.setUpdateAvailable(true);
    harness.actions.setTriggerUpdate(trigger);

    await harness.actions.runUpdate();

    expect(updates.confirm).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
    expect(updates.message).toHaveBeenCalledOnce();
    expect(harness.state().updateError).toMatch(/Termina o cancela el cobro/);
  });

  it('shows a visible warning if a critical operation becomes active after confirmation', async () => {
    const harness = createSliceHarness();
    const trigger = vi.fn(async () => { throw new Error('Espera a que termine la sincronización.'); });
    updates.cartState.hasOpenCart = true;
    harness.actions.setUpdateAvailable(true);
    harness.actions.setTriggerUpdate(trigger);

    await harness.actions.runUpdate();

    expect(trigger).toHaveBeenCalledOnce();
    expect(updates.message).toHaveBeenCalledWith(expect.stringContaining('sincronización'), null, { type: 'warning' });
    expect(harness.state().updateAvailable).toBe(true);
  });
});
