export const MIN_LENGTH_DEFAULT = 4;
export const MAX_BUFFER_DEFAULT = 128;
export const EXPECTED_MEDIAN_GAP_MS = 40;
export const EXPECTED_MAX_GAP_MS = 120;
export const MAX_TOTAL_BURST_MS = 1200;
export const MAX_MEDIAN_GAP_MS = 80;

export const KEYBOARD_WEDGE_DEFAULTS = Object.freeze({
  minLength: MIN_LENGTH_DEFAULT,
  maxBuffer: MAX_BUFFER_DEFAULT,
  expectedMedianGapMs: EXPECTED_MEDIAN_GAP_MS,
  maxMedianGapMs: MAX_MEDIAN_GAP_MS,
  maxInterKeyGapMs: EXPECTED_MAX_GAP_MS,
  maxTotalBurstMs: MAX_TOTAL_BURST_MS,
  allowTabTerminator: false
});

const TERMINATOR_KEYS = new Set(['Enter', 'NumpadEnter']);

const isFiniteTimestamp = (value) => Number.isFinite(value);

const isPrintableCharacter = (value) => {
  if (typeof value !== 'string' || value.length !== 1) return false;
  const codePoint = value.codePointAt(0);
  return codePoint >= 0x20 && codePoint !== 0x7f;
};

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const makeState = () => ({
  phase: 'IDLE',
  characters: [],
  startedAt: null,
  lastKeyAt: null,
  interKeyDelays: [],
  terminator: null,
  invalidSignal: false,
  discardReason: null
});

const result = (status, extra = {}) => ({ status, ...extra });

/**
 * Pure keyboard-wedge state machine.
 *
 * The adapter passes a short snapshot of KeyboardEvent fields and a clock
 * value. This object never stores a DOM event, so it can be tested without a
 * browser and cannot retain arbitrary event data.
 */
export function createKeyboardWedgeClassifier(options = {}) {
  const config = {
    ...KEYBOARD_WEDGE_DEFAULTS,
    ...(options || {})
  };

  config.minLength = Math.min(
    MAX_BUFFER_DEFAULT,
    Math.max(1, Math.floor(Number(config.minLength) || MIN_LENGTH_DEFAULT))
  );
  config.maxBuffer = Math.min(
    MAX_BUFFER_DEFAULT,
    Math.max(config.minLength, Math.floor(Number(config.maxBuffer) || MAX_BUFFER_DEFAULT))
  );
  const configuredMedianGap = Number(config.maxMedianGapMs);
  const configuredInterKeyGap = Number(config.maxInterKeyGapMs);
  const configuredBurst = Number(config.maxTotalBurstMs);
  config.maxMedianGapMs = Number.isFinite(configuredMedianGap)
    ? Math.max(0, configuredMedianGap)
    : MAX_MEDIAN_GAP_MS;
  config.maxInterKeyGapMs = Number.isFinite(configuredInterKeyGap)
    ? Math.max(0, configuredInterKeyGap)
    : EXPECTED_MAX_GAP_MS;
  config.maxTotalBurstMs = Number.isFinite(configuredBurst)
    ? Math.max(0, configuredBurst)
    : MAX_TOTAL_BURST_MS;
  config.allowTabTerminator = config.allowTabTerminator === true;

  let enabled = options?.enabled !== false;
  let state = makeState();

  const reset = () => {
    state = makeState();
  };

  const enterDiscarding = (reason, timestamp) => {
    state = {
      ...makeState(),
      phase: 'DISCARDING',
      startedAt: timestamp,
      lastKeyAt: timestamp,
      invalidSignal: true,
      discardReason: reason
    };
  };

  const setEnabled = (nextEnabled) => {
    const normalized = nextEnabled === true;
    if (enabled !== normalized) reset();
    enabled = normalized;
  };

  const getState = () => ({
    ...state,
    characters: [...state.characters],
    interKeyDelays: [...state.interKeyDelays]
  });

  const isTerminator = (key) => (
    TERMINATOR_KEYS.has(key) || (config.allowTabTerminator && key === 'Tab')
  );

  const classify = (terminator, timestamp) => {
    const code = state.characters.join('');
    const burstDuration = timestamp - state.startedAt;
    const allDelays = [...state.interKeyDelays];
    if (state.lastKeyAt !== null) allDelays.push(timestamp - state.lastKeyAt);

    const metrics = {
      length: state.characters.length,
      burstDuration,
      medianInterKeyDelay: median(allDelays),
      maxInterKeyDelay: allDelays.length > 0 ? Math.max(...allDelays) : 0
    };

    let reason = null;
    if (state.invalidSignal) reason = 'invalid-signal';
    else if (state.characters.length < config.minLength) reason = 'minimum-length';
    else if (state.characters.length > config.maxBuffer) reason = 'max-buffer';
    else if (code.trim().length === 0) reason = 'empty-code';
    else if (burstDuration > config.maxTotalBurstMs) reason = 'burst-timeout';
    else if (metrics.maxInterKeyDelay > config.maxInterKeyGapMs) reason = 'inter-key-gap';
    else if (metrics.medianInterKeyDelay > config.maxMedianGapMs) reason = 'median-inter-key-gap';

    if (reason) {
      reset();
      return result('discard', { reason, metrics });
    }

    const emitted = result('emit', {
      code,
      timestamp,
      terminator,
      metrics
    });
    reset();
    return emitted;
  };

  const handleTimeout = (timestamp = Date.now()) => {
    if (state.phase === 'DISCARDING') {
      reset();
      return result('discard', { reason: 'timeout' });
    }

    if (state.phase !== 'COLLECTING') return result('ignored', { reason: 'idle' });

    const elapsedSinceLastKey = timestamp - state.lastKeyAt;
    const burstDuration = timestamp - state.startedAt;
    if (elapsedSinceLastKey > config.maxInterKeyGapMs || burstDuration > config.maxTotalBurstMs) {
      reset();
      return result('discard', { reason: 'timeout' });
    }

    return result('collecting');
  };

  const handleKeyDown = (input = {}, timestamp = input.timestamp ?? input.timeStamp ?? Date.now()) => {
    const event = input || {};
    const now = isFiniteTimestamp(timestamp) ? timestamp : Date.now();

    if (!enabled) {
      reset();
      return result('ignored', { reason: 'disabled' });
    }

    if (event.focusEligible === false) {
      reset();
      return result('ignored', { reason: 'focus' });
    }

    const key = event.key;
    if (typeof key !== 'string') {
      reset();
      return result('discard', { reason: 'invalid-key' });
    }

    if (state.phase === 'DISCARDING') {
      const elapsedSinceLastKey = now - state.lastKeyAt;
      const burstDuration = now - state.startedAt;
      if (elapsedSinceLastKey > config.maxInterKeyGapMs || burstDuration > config.maxTotalBurstMs) {
        reset();
        return handleKeyDown(event, now);
      }

      const discardReason = state.discardReason || 'invalid-signal';
      state.lastKeyAt = now;
      if (TERMINATOR_KEYS.has(key) || (config.allowTabTerminator && key === 'Tab')) {
        reset();
      }
      return result('discard', { reason: discardReason });
    }

    if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.repeat) {
      enterDiscarding('invalid-signal', now);
      return result('discard', { reason: 'invalid-signal' });
    }

    // Shift-generated characters arrive in event.key already. The bare Shift
    // modifier is therefore ignored without entering the candidate buffer.
    if (key === 'Shift') return result('ignored', { reason: 'modifier' });

    if (isTerminator(key)) {
      if (state.phase !== 'COLLECTING') return result('discard', { reason: 'minimum-length' });

      const timeoutResult = handleTimeout(now);
      if (timeoutResult.status === 'discard') return timeoutResult;
      state.terminator = key;
      return classify(key, now);
    }

    if (!isPrintableCharacter(key)) {
      enterDiscarding('unexpected-control', now);
      return result('discard', { reason: 'unexpected-control' });
    }

    if (state.phase === 'COLLECTING') {
      const interKeyDelay = now - state.lastKeyAt;
      const burstDuration = now - state.startedAt;
      if (interKeyDelay > config.maxInterKeyGapMs || burstDuration > config.maxTotalBurstMs) {
        reset();
      }
    }

    if (state.characters.length >= config.maxBuffer) {
      enterDiscarding('max-buffer', now);
      return result('discard', { reason: 'max-buffer' });
    }

    if (state.phase === 'IDLE') {
      state.phase = 'COLLECTING';
      state.startedAt = now;
    } else {
      state.interKeyDelays.push(now - state.lastKeyAt);
    }

    state.characters.push(key);
    state.lastKeyAt = now;
    return result('collecting', { length: state.characters.length });
  };

  return {
    config: Object.freeze({ ...config }),
    handleKeyDown,
    handleTimeout,
    reset,
    setEnabled,
    getState
  };
}
