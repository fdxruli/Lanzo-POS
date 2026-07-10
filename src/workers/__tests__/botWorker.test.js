/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('bot.worker', () => {
  const originalOnMessage = self.onmessage;
  const originalPostMessage = self.postMessage;

  const hideLocalStorage = () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: undefined
    });

    return () => {
      if (descriptor) {
        Object.defineProperty(window, 'localStorage', descriptor);
      } else {
        delete window.localStorage;
      }
    };
  };

  afterEach(() => {
    self.onmessage = originalOnMessage;
    self.postMessage = originalPostMessage;
    vi.resetModules();
  });

  it('imports without localStorage and responds to PING', async () => {
    const restoreLocalStorage = hideLocalStorage();
    const postMessage = vi.fn();
    self.postMessage = postMessage;

    try {
      await expect(import('../bot.worker.js')).resolves.toBeTruthy();
      expect(typeof self.onmessage).toBe('function');

      await self.onmessage({
        data: {
          type: 'PING',
          payload: { messageId: 'ping-test' }
        }
      });

      expect(postMessage).toHaveBeenCalledWith({
        messageId: 'ping-test',
        success: true,
        type: 'PONG'
      });
    } finally {
      restoreLocalStorage();
    }
  });
});
