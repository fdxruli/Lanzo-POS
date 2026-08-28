import { describe, expect, it } from 'vitest';
import {
  BARCODE_SCAN_SOURCES,
  createBarcodeScanEvent,
  isBarcodeScanEvent,
  isTechnicalDuplicateScan
} from '../barcodeScanEvent';

describe('barcode scan event contract', () => {
  it('normalizes camera and keyboard-wedge sources without changing code case', () => {
    expect(createBarcodeScanEvent({
      source: BARCODE_SCAN_SOURCES.CAMERA,
      code: 'AbC-123',
      timestamp: 10
    })).toEqual({ source: 'camera', code: 'AbC-123', timestamp: 10 });

    expect(createBarcodeScanEvent({
      source: BARCODE_SCAN_SOURCES.KEYBOARD_WEDGE,
      code: 'Sku-X9',
      timestamp: 20
    })).toEqual({ source: 'keyboard-wedge', code: 'Sku-X9', timestamp: 20 });
  });

  it('rejects invalid, empty, whitespace-only, and unknown-source events', () => {
    expect(createBarcodeScanEvent({ source: 'camera', code: '', timestamp: 1 })).toBeNull();
    expect(createBarcodeScanEvent({ source: 'camera', code: '   ', timestamp: 1 })).toBeNull();
    expect(createBarcodeScanEvent({ source: 'camera', code: 7501234567890, timestamp: 1 })).toBeNull();
    expect(createBarcodeScanEvent({ source: 'other', code: 'ABC', timestamp: 1 })).toBeNull();
    expect(createBarcodeScanEvent({ source: 'camera', code: 'ABC', timestamp: Number.NaN })).toBeNull();
  });

  it('keeps normalized events free of raw KeyboardEvent data', () => {
    const event = createBarcodeScanEvent({
      source: 'keyboard-wedge',
      code: '7501234567890',
      timestamp: 100
    });

    expect(isBarcodeScanEvent(event)).toBe(true);
    expect(Object.keys(event)).toEqual(['source', 'code', 'timestamp']);
    expect(event).not.toHaveProperty('target');
    expect(event).not.toHaveProperty('key');
    expect(event).not.toHaveProperty('rawEvent');
  });

  it('suppresses only a same-source same-code technical duplicate inside the short window', () => {
    const first = createBarcodeScanEvent({ source: 'keyboard-wedge', code: 'ABC', timestamp: 100 });
    const duplicate = createBarcodeScanEvent({ source: 'keyboard-wedge', code: 'ABC', timestamp: 225 });
    const legitimateRepeat = createBarcodeScanEvent({ source: 'keyboard-wedge', code: 'ABC', timestamp: 226 });
    const otherSource = createBarcodeScanEvent({ source: 'camera', code: 'ABC', timestamp: 110 });
    const otherCode = createBarcodeScanEvent({ source: 'keyboard-wedge', code: 'abc', timestamp: 110 });

    expect(isTechnicalDuplicateScan(first, duplicate, 125)).toBe(true);
    expect(isTechnicalDuplicateScan(first, legitimateRepeat, 125)).toBe(false);
    expect(isTechnicalDuplicateScan(first, otherSource, 125)).toBe(false);
    expect(isTechnicalDuplicateScan(first, otherCode, 125)).toBe(false);
  });
});
