import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  createKeyboardWedgeClassifier,
  EXPECTED_MAX_GAP_MS,
  MAX_BUFFER_DEFAULT,
  MAX_MEDIAN_GAP_MS,
  MAX_TOTAL_BURST_MS,
  MIN_LENGTH_DEFAULT
} from '../../services/scanner/keyboardWedgeClassifier';
import {
  createBarcodeScanEvent,
  isTechnicalDuplicateScan,
  TECHNICAL_DUPLICATE_WINDOW_MS
} from '../../services/scanner/barcodeScanEvent';

const getElement = (target) => (
  target && typeof target === 'object' && typeof target.closest === 'function'
    ? target
    : null
);

const isEditableTarget = (target) => {
  const element = getElement(target);
  if (!element) return false;
  return Boolean(
    element.matches?.('input, textarea, select, [contenteditable="true"]')
      || element.isContentEditable
  );
};

const isBlockingDialogTarget = (target) => {
  const element = getElement(target);
  if (!element) return false;
  return Boolean(element.closest('[role="dialog"], [aria-modal="true"], .modal'));
};

const defaultFocusPolicy = (target, isExplicitCaptureTarget, requireExplicitCaptureTarget = false) => {
  if (requireExplicitCaptureTarget) return Boolean(isExplicitCaptureTarget?.(target));
  if (isExplicitCaptureTarget?.(target)) return true;
  return !isEditableTarget(target) && !isBlockingDialogTarget(target);
};

/**
 * Route-scoped browser adapter for keyboard-wedge scanners.
 *
 * The listener is installed only while enabled. It observes keydown events
 * passively and prevents the terminator only after the pure classifier has
 * produced a high-confidence scan.
 */
export function usePhysicalBarcodeScanner({
  enabled = false,
  onScan,
  isExplicitCaptureTarget,
  requireExplicitCaptureTarget = false,
  allowTabTerminator = false,
  minLength = MIN_LENGTH_DEFAULT,
  maxBuffer = MAX_BUFFER_DEFAULT,
  maxMedianGapMs = MAX_MEDIAN_GAP_MS,
  maxInterKeyGapMs = EXPECTED_MAX_GAP_MS,
  maxTotalBurstMs = MAX_TOTAL_BURST_MS,
  duplicateWindowMs = TECHNICAL_DUPLICATE_WINDOW_MS
} = {}) {
  const callbackRef = useRef(onScan);
  const explicitTargetRef = useRef(isExplicitCaptureTarget);
  const lastEventRef = useRef(null);

  useEffect(() => {
    callbackRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    explicitTargetRef.current = isExplicitCaptureTarget;
  }, [isExplicitCaptureTarget]);

  const classifier = useMemo(() => createKeyboardWedgeClassifier({
    minLength,
    maxBuffer,
    maxMedianGapMs,
    maxInterKeyGapMs,
    maxTotalBurstMs,
    allowTabTerminator,
    enabled: false
  }), [allowTabTerminator, maxBuffer, maxInterKeyGapMs, maxMedianGapMs, maxTotalBurstMs, minLength]);

  const clearTimer = useCallback((timerRef) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    classifier.reset();
    lastEventRef.current = null;
  }, [classifier]);

  useEffect(() => {
    const timeoutRef = { current: null };
    classifier.setEnabled(enabled);

    if (!enabled) {
      lastEventRef.current = null;
      return undefined;
    }

    const scheduleTimeout = () => {
      clearTimer(timeoutRef);
      timeoutRef.current = setTimeout(() => {
        classifier.handleTimeout(Date.now());
        timeoutRef.current = null;
      }, maxInterKeyGapMs + 1);
    };

    const handleKeyDown = (event) => {
      const focusEligible = defaultFocusPolicy(
        event.target,
        explicitTargetRef.current,
        requireExplicitCaptureTarget
      );
      const result = classifier.handleKeyDown({
        key: event.key,
        ctrlKey: event.ctrlKey === true,
        altKey: event.altKey === true,
        metaKey: event.metaKey === true,
        isComposing: event.isComposing === true,
        repeat: event.repeat === true,
        focusEligible
      }, Date.now());

      const classifierState = classifier.getState();
      if (result.status === 'collecting' || classifierState.phase === 'DISCARDING') {
        scheduleTimeout();
        if (result.status === 'collecting') return;
      }

      clearTimer(timeoutRef);
      if (result.status !== 'emit') return;

      const scanEvent = createBarcodeScanEvent({
        source: 'keyboard-wedge',
        code: result.code,
        timestamp: result.timestamp
      });
      if (!scanEvent) {
        classifier.reset();
        return;
      }

      // A duplicate terminator can otherwise submit a form or move focus even
      // though the scan itself is correctly suppressed.
      event.preventDefault();
      const isDuplicate = isTechnicalDuplicateScan(
        lastEventRef.current,
        scanEvent,
        duplicateWindowMs
      );
      lastEventRef.current = scanEvent;
      if (isDuplicate) return;

      callbackRef.current?.(scanEvent);
    };

    const handlePaste = () => {
      clearTimer(timeoutRef);
      classifier.reset();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('paste', handlePaste, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('paste', handlePaste, true);
      clearTimer(timeoutRef);
      classifier.reset();
      lastEventRef.current = null;
    };
  }, [classifier, clearTimer, duplicateWindowMs, enabled, maxInterKeyGapMs, requireExplicitCaptureTarget]);

  return {
    enabled: Boolean(enabled),
    reset
  };
}

export { defaultFocusPolicy, isEditableTarget };
