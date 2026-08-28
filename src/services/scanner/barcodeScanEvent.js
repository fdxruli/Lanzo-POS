export const BARCODE_SCAN_SOURCES = Object.freeze({
  CAMERA: 'camera',
  KEYBOARD_WEDGE: 'keyboard-wedge'
});

export const TECHNICAL_DUPLICATE_WINDOW_MS = 125;

const VALID_SOURCES = new Set(Object.values(BARCODE_SCAN_SOURCES));

/**
 * Creates the small source-agnostic value passed from scanner adapters to
 * business consumers. The code is intentionally not trimmed or otherwise
 * rewritten: scanner adapters must preserve the characters they received.
 */
export function createBarcodeScanEvent({ source, code, timestamp = Date.now() } = {}) {
  if (!VALID_SOURCES.has(source)) return null;
  if (typeof code !== 'string' || code.length === 0 || code.trim().length === 0) return null;
  if (!Number.isFinite(timestamp)) return null;

  return Object.freeze({ source, code, timestamp });
}

export function isBarcodeScanEvent(value) {
  return Boolean(
    value
      && VALID_SOURCES.has(value.source)
      && typeof value.code === 'string'
      && value.code.length > 0
      && value.code.trim().length > 0
      && Number.isFinite(value.timestamp)
  );
}

export function isTechnicalDuplicateScan(
  previousEvent,
  nextEvent,
  windowMs = TECHNICAL_DUPLICATE_WINDOW_MS
) {
  if (!isBarcodeScanEvent(previousEvent) || !isBarcodeScanEvent(nextEvent)) return false;
  if (previousEvent.source !== nextEvent.source || previousEvent.code !== nextEvent.code) return false;
  if (!Number.isFinite(windowMs) || windowMs < 0) return false;

  const elapsed = nextEvent.timestamp - previousEvent.timestamp;
  return elapsed >= 0 && elapsed <= windowMs;
}
