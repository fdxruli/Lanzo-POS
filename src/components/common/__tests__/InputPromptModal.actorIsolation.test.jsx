// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: null,
  listener: null,
  unsubscribe: vi.fn(),
}));

vi.mock('../../../services/auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_STATUS: { GRANTED: 'granted' },
  actorRuntimeController: {
    getState: vi.fn(() => mocks.actor),
    subscribe: vi.fn((listener) => {
      mocks.listener = listener;
      return mocks.unsubscribe;
    }),
  },
}));

vi.mock('../../../hooks/useDismissibleHistoryLayer', () => ({
  useDismissibleHistoryLayer: ({ onDismiss }) => onDismiss,
}));

import { showInputPromptModal } from '../InputPromptModal';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listener = null;
  mocks.actor = { status: 'granted', generation: 11 };
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('InputPromptModal actor ownership', () => {
  it('unmounts and resolves as cancelled when the actor generation changes', async () => {
    let promptResult;
    await act(async () => {
      promptResult = showInputPromptModal({ title: 'Accion privilegiada' });
      await Promise.resolve();
    });

    expect(screen.getByRole('dialog', { name: 'Accion privilegiada' })).toBeInTheDocument();

    await act(async () => {
      mocks.listener({ status: 'locked', generation: 12 });
      await Promise.resolve();
    });

    await expect(promptResult).resolves.toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
