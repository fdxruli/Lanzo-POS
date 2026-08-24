import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: null,
  listener: null,
}));

vi.mock('../../services/auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_STATUS: { GRANTED: 'granted' },
  actorRuntimeController: {
    getState: vi.fn(() => mocks.actor),
    subscribe: vi.fn((listener) => {
      mocks.listener = listener;
      return vi.fn();
    }),
  },
}));

import { useMessageStore } from '../useMessageStore';

beforeEach(() => {
  mocks.actor = { status: 'granted', generation: 7 };
  useMessageStore.setState({
    isOpen: false,
    message: '',
    onConfirm: null,
    options: {},
    actorGeneration: null,
  });
});

describe('actor-owned message callbacks', () => {
  it('removes a privileged callback and resolves cancellation on actor lock', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    useMessageStore.getState().show('Confirmar', onConfirm, { onCancel });

    expect(useMessageStore.getState()).toMatchObject({
      isOpen: true,
      actorGeneration: 7,
    });

    mocks.listener({ status: 'locked', generation: 8 });

    expect(useMessageStore.getState()).toMatchObject({
      isOpen: false,
      onConfirm: null,
      actorGeneration: null,
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps the callback while the same granted actor generation is current', () => {
    const onCancel = vi.fn();
    useMessageStore.getState().show('Confirmar', vi.fn(), { onCancel });

    mocks.listener({ status: 'granted', generation: 7 });

    expect(useMessageStore.getState().isOpen).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
