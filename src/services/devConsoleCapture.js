/* eslint-disable no-console */
const MAX_ENTRIES = 300;
const MAX_TEXT_LENGTH = 5000;
const METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table'];
const STATE_KEY = '__LANZO_DEV_CONSOLE_STATE__';

const createState = () => ({
  entries: [],
  listeners: new Set(),
  originals: {},
  installed: false,
  sequence: 0,
});

const state = (() => {
  if (typeof window === 'undefined') return createState();
  window[STATE_KEY] = window[STATE_KEY] || createState();
  return window[STATE_KEY];
})();

const truncate = (text) => {
  if (text.length <= MAX_TEXT_LENGTH) return text;
  return `${text.slice(0, MAX_TEXT_LENGTH)}\n... recortado`;
};

const stringifyObject = (value) => {
  const seen = new WeakSet();

  return JSON.stringify(
    value,
    (_key, nestedValue) => {
      if (typeof nestedValue === 'bigint') return `${nestedValue.toString()}n`;
      if (typeof nestedValue === 'function') return `[Function ${nestedValue.name || 'anonymous'}]`;
      if (typeof nestedValue === 'object' && nestedValue !== null) {
        if (seen.has(nestedValue)) return '[Circular]';
        seen.add(nestedValue);
      }
      return nestedValue;
    },
    2
  );
};

const formatValue = (value) => {
  if (value instanceof Error) {
    return truncate(value.stack || `${value.name}: ${value.message}`);
  }

  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  try {
    return truncate(stringifyObject(value));
  } catch {
    return truncate(String(value));
  }
};

const notify = () => {
  const snapshot = getDevConsoleEntries();
  state.listeners.forEach((listener) => listener(snapshot));
};

const addEntry = (level, args, source = 'console') => {
  const now = new Date();
  const normalizedArgs = Array.from(args);
  const entry = {
    id: `${now.getTime()}-${state.sequence += 1}`,
    level,
    source,
    time: now.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    text: normalizedArgs.map(formatValue).join(' '),
  };

  state.entries = [...state.entries, entry].slice(-MAX_ENTRIES);
  notify();
};

const callOriginal = (method, args) => {
  const original = state.originals[method];
  if (typeof original === 'function') {
    original(...args);
  }
};

export const installDevConsoleCapture = () => {
  if (!import.meta.env.DEV || typeof window === 'undefined' || state.installed) return;

  METHODS.forEach((method) => {
    const original = console[method]?.bind(console);
    if (!original) return;

    state.originals[method] = original;
    console[method] = (...args) => {
      addEntry(method, args);
      callOriginal(method, args);
    };
  });

  window.addEventListener('error', (event) => {
    addEntry('error', [
      event.message || 'Error global sin mensaje',
      event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '',
      event.error,
    ], 'window.error');
  });

  window.addEventListener('unhandledrejection', (event) => {
    addEntry('error', ['Promesa rechazada sin manejar', event.reason], 'unhandledrejection');
  });

  window.__LANZO_DEV_CONSOLE__ = {
    clear: clearDevConsoleEntries,
    getEntries: getDevConsoleEntries,
  };

  state.installed = true;
};

export const getDevConsoleEntries = () => [...state.entries];

export const subscribeDevConsole = (listener) => {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
};

export const clearDevConsoleEntries = () => {
  state.entries = [];
  notify();
};
