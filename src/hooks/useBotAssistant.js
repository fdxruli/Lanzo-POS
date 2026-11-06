import { useCallback, useEffect, useRef } from 'react';
import { processBotMessage } from '../utils/botIntelligence';

export const BOT_TIMEOUT_MS = 15000;
const loadEngine = () => ({ processBotMessage });
const botError = (code) => Object.assign(new Error(code), { code });

/** One engine loaded with the lazy assistant in the application's tenant runtime. No business data crosses a worker. */
export const useBotAssistant = (contextKey, loader = loadEngine) => {
  const active = useRef(null);
  useEffect(() => () => {
    active.current?.cancel();
  }, [contextKey]);

  const askBot = useCallback((text, context = {}) => {
    if (active.current) return Promise.reject(botError('BOT_BUSY'));
    const controller = new AbortController();
    const request = {};
    const result = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        controller.abort();
        if (active.current === request) active.current = null;
        if (error) reject(error); else resolve(response);
      };
      const timer = setTimeout(() => finish(botError('BOT_TIMEOUT')), BOT_TIMEOUT_MS);
      request.cancel = () => finish(botError('BOT_CANCELLED'));
      active.current = request;
      Promise.resolve().then(loader).then(async (engine) => {
        if (controller.signal.aborted) throw botError('BOT_CANCELLED');
        const response = await engine.processBotMessage(text, context, { signal: controller.signal });
        if (!response?.title || typeof response.message !== 'string') throw botError('BOT_INVALID_RESPONSE');
        finish(null, response);
      }).catch((error) => finish(error));
    });
    return result;
  }, [loader]);

  return { askBot };
};
