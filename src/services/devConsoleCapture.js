/* eslint-disable no-console */
import { projectDiagnosticEvent } from './diagnostics/incidentDiagnostics';
import { captureAsyncIncidentNotice } from './diagnostics/incidentEventCenter';
import { setDiagnosticConsoleSink } from './diagnostics/consoleEventBus';

const MAX_ENTRIES = 300;
const MAX_TEXT_LENGTH = 5000;
const METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table'];

const createState = () => ({
  entries: [],
  listeners: new Set(),
  originals: {},
  installed: false,
  sequence: 0,
  notifying: false,
  timer: null,
  recording: false,
});

const state = createState();

const truncate = (text) => {
  if (text.length <= MAX_TEXT_LENGTH) return text;
  return `${text.slice(0, MAX_TEXT_LENGTH)}\n... recortado`;
};

const notify = () => {
  if (!state.listeners.size) return;
  const snapshot = getDevConsoleEntries();
  state.notifying = true;
  state.listeners.forEach((listener) => {
    try { listener(snapshot); } catch { /* A diagnostic subscriber must not interrupt the POS. */ }
  });
  state.notifying = false;
};

const addEntry = (level, args, source = 'console', location = null) => {
  if (!state.recording || state.notifying) return;
  const now = new Date();
  const diagnostic = projectDiagnosticEvent(level, args, source, location);
  const previous = state.entries.at(-1);
  const repeated = diagnostic.groupable && previous?.level === level
    && previous.source === source && previous.text === diagnostic.text
    && previous.severity === diagnostic.severity
    && !diagnostic.technical && !previous.technical
    && now.getTime() - Date.parse(previous.timestamp) <= 30_000;
  const entry = Object.freeze({
    ...diagnostic,
    id: repeated ? previous.id : `${now.getTime()}-${state.sequence += 1}`,
    level,
    source,
    timestamp: now.toISOString(),
    time: now.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    firstTimestamp: repeated ? previous.firstTimestamp : now.toISOString(),
    count: repeated ? previous.count + 1 : 1,
    text: truncate(diagnostic.text),
  });

  if (repeated) state.entries[state.entries.length - 1] = entry;
  else {
    state.entries.push(entry);
    if (state.entries.length > MAX_ENTRIES) state.entries.shift();
  }
  // One visual update per burst, independent of the frequency of POS logs.
  if (state.listeners.size && !state.timer) state.timer = window.setTimeout(() => {
    state.timer = null;
    notify();
  }, 100);
};

const callOriginal = (method, args) => {
  const original = state.originals[method];
  if (typeof original === 'function') {
    original(...args);
  }
};

export const installDevConsoleCapture = () => {
  if (typeof window === 'undefined') return;
  setDiagnosticConsoleSink(addEntry);
  if (state.installed) return;
  state.installed = true;

  METHODS.forEach((method) => {
    const original = console[method]?.bind(console);
    if (!original) return;

    state.originals[method] = original;
    console[method] = (...args) => {
      try { addEntry(method, args); } catch { /* Always forward the original call. */ }
      callOriginal(method, args);
    };
  });

  window.addEventListener('error', (event) => {
    try {
      addEntry('error', [event.message, event.error], 'window.error', {
        filename: event.filename, line: event.lineno, column: event.colno,
        resourceError: typeof ErrorEvent === 'undefined' || !(event instanceof ErrorEvent)
      });
    } catch { /* best effort */ }
    try { captureAsyncIncidentNotice(event.error || {
      name: 'Error',
      message: event.message || ''
    }, {
      source: 'window.error',
      pathname: window.location?.pathname,
      online: window.navigator?.onLine !== false
    }); } catch { /* A failed notice must not break other error handlers. */ }
  });

  window.addEventListener('unhandledrejection', (event) => {
    try { addEntry('error', [event.reason], 'unhandledrejection'); } catch { /* best effort */ }
    try { captureAsyncIncidentNotice(event.reason, {
      source: 'unhandledrejection',
      pathname: window.location?.pathname,
      online: window.navigator?.onLine !== false
    }); } catch { /* Recovery and visual recording are independent. */ }
  });

};

export const getDevConsoleEntries = () => state.recording ? [...state.entries] : [];

export const subscribeDevConsole = (listener) => {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
};

export const clearDevConsoleEntries = () => {
  if (state.timer) window.clearTimeout(state.timer);
  state.timer = null;
  state.entries = [];
  notify();
};

// The actor authority boundary suspends the module-private visual buffer.
// Global operational notices remain installed, regardless of panel visibility.
export const setDevConsoleRecording = enabled => {
  state.recording = enabled === true;
  clearDevConsoleEntries();
};

export const formatDevConsoleEntries = entries => entries.map(entry => (
  `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.source}: ${entry.text}`
  + (entry.evidence ? `\nDato técnico: ${entry.evidence}` : '')
  + `\nImpacto: ${entry.severity || 'unspecified'}`
  + (entry.count > 1 ? `\nEventos equivalentes: ${entry.count} · Desde: ${entry.firstTimestamp} · Hasta: ${entry.timestamp}` : '')
)).join('\n\n');
