import { describe, expect, it } from 'vitest';
import {
  createKeyboardWedgeClassifier,
  MAX_BUFFER_DEFAULT,
  MAX_TOTAL_BURST_MS
} from '../keyboardWedgeClassifier';

const scan = (classifier, code, {
  start = 0,
  step = 20,
  terminator = 'Enter',
  focusEligible = true
} = {}) => {
  let timestamp = start;
  for (const key of code) {
    classifier.handleKeyDown({ key, focusEligible }, timestamp);
    timestamp += step;
  }
  return classifier.handleKeyDown({ key: terminator, focusEligible }, timestamp);
};

describe('keyboard-wedge classifier', () => {
  it('emits a rapid EAN-13 candidate with Enter', () => {
    const classifier = createKeyboardWedgeClassifier();

    expect(scan(classifier, '7501234567890')).toMatchObject({
      status: 'emit',
      code: '7501234567890',
      terminator: 'Enter'
    });
  });

  it('emits a rapid CODE128-like candidate and preserves case and symbols', () => {
    const classifier = createKeyboardWedgeClassifier();

    expect(scan(classifier, 'AbC-09/$x')).toMatchObject({
      status: 'emit',
      code: 'AbC-09/$x'
    });
  });

  it('accepts NumpadEnter as a terminator', () => {
    const classifier = createKeyboardWedgeClassifier();

    expect(scan(classifier, 'ABC9', { terminator: 'NumpadEnter' })).toMatchObject({
      status: 'emit',
      code: 'ABC9',
      terminator: 'NumpadEnter'
    });
  });

  it('does not emit Enter without a candidate', () => {
    const classifier = createKeyboardWedgeClassifier();

    expect(classifier.handleKeyDown({ key: 'Enter', focusEligible: true }, 0)).toMatchObject({
      status: 'discard'
    });
  });

  it('keeps Tab disabled by default and allows it only when configured', () => {
    const disabled = createKeyboardWedgeClassifier();
    expect(scan(disabled, 'ABC9', { terminator: 'Tab' })).toMatchObject({ status: 'discard' });

    const enabled = createKeyboardWedgeClassifier({ allowTabTerminator: true });
    expect(scan(enabled, 'ABC9', { terminator: 'Tab' })).toMatchObject({
      status: 'emit',
      terminator: 'Tab'
    });
  });

  it('rejects slow human typing through multifactor timing checks', () => {
    const classifier = createKeyboardWedgeClassifier();

    expect(scan(classifier, 'ABC9', { step: 180 })).toMatchObject({
      status: 'discard',
      reason: expect.stringMatching(/gap|burst|timeout/i)
    });
  });

  it('rejects a median-gap failure even when no individual gap exceeds the maximum', () => {
    const classifier = createKeyboardWedgeClassifier();

    expect(scan(classifier, 'ABC9', { step: 90 })).toMatchObject({
      status: 'discard',
      reason: 'median-inter-key-gap'
    });
  });

  it('discards a candidate when the burst timeout fires', () => {
    const classifier = createKeyboardWedgeClassifier();
    classifier.handleKeyDown({ key: 'A', focusEligible: true }, 0);
    classifier.handleKeyDown({ key: 'B', focusEligible: true }, 20);

    expect(classifier.handleTimeout(200)).toMatchObject({ status: 'discard', reason: 'timeout' });
    expect(classifier.handleKeyDown({ key: 'Enter', focusEligible: true }, 210)).toMatchObject({ status: 'discard' });
  });

  it('rejects malformed short bursts', () => {
    const classifier = createKeyboardWedgeClassifier();

    expect(scan(classifier, 'ABC')).toMatchObject({ status: 'discard', reason: 'minimum-length' });
  });

  it('accepts exactly the configured maximum and discards the next character', () => {
    const classifier = createKeyboardWedgeClassifier({ maxBuffer: 4 });
    expect(scan(classifier, 'ABCD')).toMatchObject({ status: 'emit', code: 'ABCD' });
    for (const [index, key] of [...'ABCD'].entries()) {
      classifier.handleKeyDown({ key, focusEligible: true }, index * 20);
    }
    expect(classifier.handleKeyDown({ key: 'E', focusEligible: true }, 80)).toMatchObject({
      status: 'discard',
      reason: 'max-buffer'
    });
  });

  it('enforces the safe default maximum buffer of 128 characters', () => {
    const classifier = createKeyboardWedgeClassifier();
    const atBoundary = 'A'.repeat(MAX_BUFFER_DEFAULT);

    expect(scan(classifier, atBoundary, { step: 1 })).toMatchObject({ status: 'emit', code: atBoundary });
    for (const [index, key] of [...atBoundary].entries()) {
      classifier.handleKeyDown({ key, focusEligible: true }, 300 + index);
    }
    expect(classifier.handleKeyDown({ key: 'B', focusEligible: true }, 428)).toMatchObject({
      status: 'discard',
      reason: 'max-buffer'
    });
  });

  it('allows Shift-generated characters while preserving their actual event.key value', () => {
    const classifier = createKeyboardWedgeClassifier();
    classifier.handleKeyDown({ key: 'Shift', focusEligible: true }, 0);
    classifier.handleKeyDown({ key: 'A', shiftKey: true, focusEligible: true }, 20);
    classifier.handleKeyDown({ key: 'b', focusEligible: true }, 40);
    classifier.handleKeyDown({ key: '1', focusEligible: true }, 60);
    classifier.handleKeyDown({ key: '!', shiftKey: true, focusEligible: true }, 80);

    expect(classifier.handleKeyDown({ key: 'Enter', focusEligible: true }, 100)).toMatchObject({
      status: 'emit',
      code: 'Ab1!'
    });
  });

  it.each([
    ['repeat', { key: 'A', repeat: true }],
    ['Ctrl', { key: 'A', ctrlKey: true }],
    ['Alt', { key: 'A', altKey: true }],
    ['Meta', { key: 'A', metaKey: true }],
    ['IME composition', { key: 'A', isComposing: true }]
  ])('discards a candidate with %s input', (_label, invalidEvent) => {
    const classifier = createKeyboardWedgeClassifier();
    classifier.handleKeyDown({ key: '7', focusEligible: true }, 0);

    expect(classifier.handleKeyDown({ ...invalidEvent, focusEligible: true }, 20)).toMatchObject({
      status: 'discard',
      reason: 'invalid-signal'
    });
    expect(classifier.handleKeyDown({ key: 'Enter', focusEligible: true }, 40)).toMatchObject({ status: 'discard' });
  });

  it('does not turn Ctrl+V or unexpected controls into a scan', () => {
    const classifier = createKeyboardWedgeClassifier();
    classifier.handleKeyDown({ key: '7', focusEligible: true }, 0);
    expect(classifier.handleKeyDown({ key: 'v', ctrlKey: true, focusEligible: true }, 20)).toMatchObject({ status: 'discard' });
    expect(classifier.handleKeyDown({ key: 'Backspace', focusEligible: true }, 40)).toMatchObject({
      status: 'discard',
      reason: 'invalid-signal'
    });
  });

  it('does not classify input while an incompatible focus context owns it', () => {
    const classifier = createKeyboardWedgeClassifier();

    expect(scan(classifier, 'ABC9', { focusEligible: false })).toMatchObject({ status: 'ignored' });
    expect(classifier.getState()).toMatchObject({ phase: 'IDLE', characters: [] });
  });

  it('does not retain DOM event objects in its state', () => {
    const classifier = createKeyboardWedgeClassifier();
    const rawEvent = { key: 'A', target: { secret: true }, focusEligible: true };

    classifier.handleKeyDown(rawEvent, 0);
    const state = classifier.getState();
    expect(state).not.toHaveProperty('event');
    expect(state).not.toHaveProperty('target');
    expect(state.characters).toEqual(['A']);
  });

  it('can be disabled and re-enabled without carrying a previous burst', () => {
    const classifier = createKeyboardWedgeClassifier();
    classifier.setEnabled(false);
    expect(scan(classifier, 'ABC9')).toMatchObject({ status: 'ignored' });

    classifier.setEnabled(true);
    expect(scan(classifier, 'ABC9')).toMatchObject({ status: 'emit', code: 'ABC9' });
  });

  it('rejects a burst that exceeds the total synthetic validation window', () => {
    const classifier = createKeyboardWedgeClassifier({ maxTotalBurstMs: MAX_TOTAL_BURST_MS });

    expect(scan(classifier, 'ABC9', { step: 400 })).toMatchObject({
      status: 'discard',
      reason: expect.stringMatching(/burst|timeout|gap/i)
    });
  });
});
