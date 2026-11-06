import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createBotWorkerClient } from '../services/botWorkerClient';
export { BOT_TIMEOUT_MS } from '../services/botWorkerClient';

export const useBotAssistant = (contextKey, enabled = false, context = {}, factory = createBotWorkerClient) => {
  const client = useRef(null);
  const contextRef = useRef(context);
  const enabledRef = useRef(enabled);
  useLayoutEffect(() => { contextRef.current = context; enabledRef.current = enabled; }, [context, enabled]);
  const [screen, setScreen] = useState({ label: 'LANZO POS', guides: [] });
  const [error, setError] = useState(null);
  const ensureClient = useCallback(() => {
    if (!enabledRef.current) throw Object.assign(new Error('BOT_CANCELLED'), { code: 'BOT_CANCELLED' });
    if (!client.current || client.current.closed) {
      const instance = factory(contextRef.current);
      client.current = instance;
      setScreen({ label: 'LANZO POS', guides: [] });
      instance.ready.then(value => {
        if (enabledRef.current && client.current === instance) { setScreen(value); setError(null); }
      }, () => {
        if (enabledRef.current && client.current === instance) setError('No pude iniciar el motor. Reintenta la pregunta para recuperarlo.');
      });
    }
    return client.current;
  }, [factory]);
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const instance = ensureClient();
    setError(null);
    instance.ready.then(value => { if (mounted) setScreen(value); }, () => { if (mounted) setError('No pude iniciar el motor. Reintenta la pregunta para recuperarlo.'); });
    return () => { mounted = false; instance.stop(); client.current?.stop(); client.current = null; };
  }, [contextKey, enabled, ensureClient]);
  const askBot = useCallback((text, questionContext) => ensureClient().ask(text, questionContext), [ensureClient]);
  return { askBot, screen, error };
};
