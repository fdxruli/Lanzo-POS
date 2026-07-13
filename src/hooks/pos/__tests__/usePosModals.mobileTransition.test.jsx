// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileCartModal } from '../usePosModals';

describe('useMobileCartModal modal transitions', () => {
  beforeEach(() => {
    window.history.replaceState({}, document.title, '/');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState({}, document.title, '/');
  });

  it('closes the mobile cart without a late popstate before opening another modal', () => {
    const historyBack = vi.spyOn(window.history, 'back');
    const { result } = renderHook(() => useMobileCartModal());

    act(() => result.current.openCart());
    expect(result.current.isOpen).toBe(true);
    expect(window.history.state).toHaveProperty('__lanzoDismissibleLayer');

    act(() => result.current.closeCartForModalTransition());

    expect(result.current.isOpen).toBe(false);
    expect(historyBack).not.toHaveBeenCalled();
    expect(window.history.state).not.toHaveProperty('__lanzoDismissibleLayer');
  });
});
