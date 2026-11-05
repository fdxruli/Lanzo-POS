import { getConsoleOperation } from './consoleOperations';

// Logger's production-suppressed structured levels reach the in-app diagnostics
// without printing raw arguments to the browser console. No events are queued
// until the POS capture installs its sink.
let sink = null;
export const setDiagnosticConsoleSink = receiver => { sink = receiver; };
export const emitDiagnosticConsoleEvent = (level, args) => {
  // Preserve production debug suppression for arbitrary application logs.
  // Only registered operations opt in; direct console calls retain their level.
  if (!args.slice(0, 30).some(getConsoleOperation)) return;
  try { sink?.(level, args); } catch { /* diagnostics cannot change a POS result */ }
};
