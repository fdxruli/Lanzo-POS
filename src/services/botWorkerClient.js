import { projectBotSales, projectBotStock } from './botComputationProjection';
import { BOT_READ_INTENTS } from '../workers/botProtocol';
export const BOT_TIMEOUT_MS = 15000;
const failure = code => Object.assign(new Error(code), { code });
export const createBotWorker = () => new Worker(new URL('../workers/bot.worker.js', import.meta.url), { type: 'module', name: 'lanzo-bot' });
const readBusiness = async (intent, timeframe, options) => {
  const { readBotBusinessData } = await import('./botReadService');
  if (options.signal.aborted) throw failure('BOT_CANCELLED');
  return readBotBusinessData(intent, timeframe, options);
};

/** One disposable worker, no background polling, no main-thread engine fallback. */
export const createBotWorkerClient = (context, { workerFactory = createBotWorker, read = readBusiness } = {}) => {
  let worker;
  let closed = false;
  let sequence = 0;
  let asking = false;
  const pending = new Map();
  const stop = (code = 'BOT_CANCELLED') => {
    if (closed) return;
    closed = true;
    worker?.removeEventListener('message', onMessage);
    worker?.removeEventListener('error', onError);
    worker?.removeEventListener('messageerror', onError);
    worker?.terminate();
    for (const request of [...pending.values()]) request.finish(failure(code));
  };
  const onError = () => stop('BOT_WORKER_FAILED');
  const onMessage = ({ data }) => {
    const request = pending.get(data?.id);
    if (!request) return;
    if (data.type === 'READ') {
      if (request.type !== 'QUESTION' || request.readStarted || !BOT_READ_INTENTS.includes(data.intent)) { stop('BOT_INVALID_MESSAGE'); return; }
      request.readStarted = true;
      Promise.resolve().then(() => {
        if (request.controller.signal.aborted) throw failure('BOT_CANCELLED');
        return read(data.intent, data.timeframe, { signal: request.controller.signal, compute: async (operation, sales, check) => {
          const guard = () => { if (request.controller.signal.aborted) throw failure('BOT_CANCELLED'); check(); };
          guard(); await send('COMPUTE_START', { operation });
          for (let offset = 0; offset < sales.length; offset += 128) {
            guard(); await send('COMPUTE_CHUNK', { sales: (operation === 'stock' ? projectBotStock : projectBotSales)(sales.slice(offset, offset + 128)) });
          }
          guard(); const value = await send('COMPUTE_END', {}); guard(); return value;
        } });
      }).then(value => request.finish(null, value), error => { request.finish(error); stop('BOT_PROCESSING_FAILED'); });
    } else if (data.type === 'RESULT') request.finish(null, data.value);
    else stop(data.code || 'BOT_INVALID_MESSAGE');
  };
  const send = (type, payload, timeout = BOT_TIMEOUT_MS) => new Promise((resolve, reject) => {
    if (closed) { reject(failure('BOT_WORKER_UNAVAILABLE')); return; }
    const id = ++sequence;
    const controller = new AbortController();
    const request = { type, controller, finish(error, value) {
      if (!pending.has(id)) return;
      pending.delete(id); clearTimeout(timer); controller.abort();
      if (error) reject(error); else resolve(value);
    } };
    const timer = setTimeout(() => stop('BOT_TIMEOUT'), timeout);
    pending.set(id, request);
    try { worker.postMessage({ id, type, payload }); } catch { stop('BOT_NOT_SERIALIZABLE'); }
  });
  let ready;
  try {
    worker = workerFactory();
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onError);
    ready = send('CONTEXT', context, 5000).then(value => {
      if (!value || typeof value.label !== 'string' || !Array.isArray(value.guides)) {
        stop('BOT_INVALID_RESPONSE'); throw failure('BOT_INVALID_RESPONSE');
      }
      return value;
    });
  } catch { stop('BOT_WORKER_UNAVAILABLE'); ready = Promise.reject(failure('BOT_WORKER_UNAVAILABLE')); }
  // Idle initialization failures are observed even when the user has not asked a question.
  ready.catch(() => {});
  return {
    ready,
    get closed() { return closed; },
    async ask(text, questionContext = context) {
      if (asking) throw failure('BOT_BUSY');
      asking = true;
      try {
        await ready;
        if (closed) throw failure('BOT_CANCELLED');
        const response = await send('QUESTION', { text, context: questionContext });
        if (!response?.title || typeof response.message !== 'string') throw failure('BOT_INVALID_RESPONSE');
        return response;
      } finally { asking = false; }
    },
    stop
  };
};
