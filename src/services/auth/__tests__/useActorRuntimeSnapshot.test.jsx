// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listener: null,
  snapshot: null,
  unsubscribe: vi.fn(),
}));

vi.mock('../actorRuntimeController', () => ({
  actorRuntimeController: {
    getState: vi.fn(() => mocks.snapshot),
    subscribe: vi.fn((listener) => {
      mocks.listener = listener;
      return mocks.unsubscribe;
    }),
  },
}));

import { useActorRuntimeSnapshot } from '../useActorRuntimeSnapshot';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listener = null;
  mocks.snapshot = {
    status: 'granted',
    actorType: 'admin',
    actorId: 'admin-1',
    sessionId: 'session-1',
    generation: 1,
  };
});

afterEach(() => cleanup());

describe('useActorRuntimeSnapshot', () => {
  it('publishes actor lock/switch snapshots immediately and unsubscribes', () => {
    const view = renderHook(() => useActorRuntimeSnapshot());
    expect(view.result.current.actorId).toBe('admin-1');

    act(() => {
      mocks.listener({
        status: 'granted',
        actorType: 'staff',
        actorId: 'staff-b',
        sessionId: 'session-2',
        generation: 2,
      });
    });

    expect(view.result.current).toMatchObject({
      actorType: 'staff',
      actorId: 'staff-b',
      generation: 2,
    });

    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
