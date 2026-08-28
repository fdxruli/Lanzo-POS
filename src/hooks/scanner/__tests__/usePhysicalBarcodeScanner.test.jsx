// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePhysicalBarcodeScanner } from '../usePhysicalBarcodeScanner';

const press = (target, key, options = {}, advanceMs = 20) => {
  fireEvent.keyDown(target, { key, bubbles: true, ...options });
  if (advanceMs > 0) vi.advanceTimersByTime(advanceMs);
};

const sendScan = (target, code, terminator = 'Enter', options = {}) => {
  for (const key of code) press(target, key, options);
  press(target, terminator, {}, 0);
};

const appendTarget = (tagName, attributes = {}) => {
  const target = document.createElement(tagName);
  Object.entries(attributes).forEach(([name, value]) => target.setAttribute(name, value));
  document.body.appendChild(target);
  return target;
};

describe('usePhysicalBarcodeScanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('emits a normalized rapid EAN-13 event from the route-scoped listener', () => {
    const onScan = vi.fn();
    renderHook(() => usePhysicalBarcodeScanner({ enabled: true, onScan }));

    sendScan(document.body, '7501234567890');

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith(expect.objectContaining({
      source: 'keyboard-wedge',
      code: '7501234567890',
      timestamp: expect.any(Number)
    }));
    expect(Object.keys(onScan.mock.calls[0][0])).toEqual(['source', 'code', 'timestamp']);
  });

  it('accepts a CODE128-like string and preserves case and Shift-generated characters', () => {
    const onScan = vi.fn();
    renderHook(() => usePhysicalBarcodeScanner({ enabled: true, onScan }));

    press(document.body, 'Shift');
    sendScan(document.body, 'AbC-09/$x');

    expect(onScan).toHaveBeenCalledWith(expect.objectContaining({ code: 'AbC-09/$x' }));
  });

  it('does not prevent candidate characters and prevents only a high-confidence terminator', () => {
    const onScan = vi.fn();
    const preventDefault = vi.spyOn(Event.prototype, 'preventDefault');
    renderHook(() => usePhysicalBarcodeScanner({ enabled: true, onScan }));

    press(document.body, 'A');
    press(document.body, 'B');
    press(document.body, 'C');
    expect(preventDefault).not.toHaveBeenCalled();

    press(document.body, '9', {}, 20);
    press(document.body, 'Enter', {}, 0);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('supports NumpadEnter and keeps bare Enter from emitting', () => {
    const onScan = vi.fn();
    renderHook(() => usePhysicalBarcodeScanner({ enabled: true, onScan }));

    press(document.body, 'Enter', {}, 0);
    sendScan(document.body, 'ABC9', 'NumpadEnter');

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan.mock.calls[0][0]).toMatchObject({ code: 'ABC9' });
  });

  it('keeps Tab disabled by default and makes optional Tab termination configurable', () => {
    const disabledOnTab = vi.fn();
    const first = renderHook(() => usePhysicalBarcodeScanner({ enabled: true, onScan: disabledOnTab }));
    sendScan(document.body, 'ABC9', 'Tab');
    expect(disabledOnTab).not.toHaveBeenCalled();
    first.unmount();

    const enabledOnTab = vi.fn();
    renderHook(() => usePhysicalBarcodeScanner({ enabled: true, onScan: enabledOnTab, allowTabTerminator: true }));
    sendScan(document.body, 'ABC9', 'Tab');
    expect(enabledOnTab).toHaveBeenCalledWith(expect.objectContaining({ code: 'ABC9' }));
  });

  it('rejects slow human typing and burst timeout without invoking the consumer', () => {
    const onScan = vi.fn();
    renderHook(() => usePhysicalBarcodeScanner({ enabled: true, onScan }));

    press(document.body, 'A', {}, 180);
    press(document.body, 'B', {}, 180);
    press(document.body, 'C', {}, 180);
    press(document.body, '9', {}, 180);
    press(document.body, 'Enter', {}, 0);
    expect(onScan).not.toHaveBeenCalled();

    press(document.body, 'A', {}, 0);
    press(document.body, 'B', {}, 0);
    vi.advanceTimersByTime(200);
    press(document.body, 'Enter', {}, 0);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('ignores normal input, textarea, select, and contenteditable focus', () => {
    const onScan = vi.fn();
    renderHook(() => usePhysicalBarcodeScanner({ enabled: true, onScan }));
    const targets = [
      appendTarget('input'),
      appendTarget('textarea'),
      appendTarget('select'),
      appendTarget('div', { contenteditable: 'true' })
    ];

    targets.forEach((target) => sendScan(target, 'ABC9'));

    expect(onScan).not.toHaveBeenCalled();
  });

  it('allows the explicit ProductForm barcode field while preserving manual field behavior', () => {
    const onScan = vi.fn();
    const barcodeInput = appendTarget('input', { 'data-scanner-physical-capture': 'true' });
    renderHook(() => usePhysicalBarcodeScanner({
      enabled: true,
      onScan,
      isExplicitCaptureTarget: (target) => target?.dataset?.scannerPhysicalCapture === 'true'
    }));

    sendScan(barcodeInput, 'Sku-9A');

    expect(onScan).toHaveBeenCalledWith(expect.objectContaining({ code: 'Sku-9A' }));
  });

  it.each([
    ['repeat', { repeat: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Meta', { metaKey: true }],
    ['IME', { isComposing: true }]
  ])('does not emit %s input', (_label, invalidOptions) => {
    const onScan = vi.fn();
    renderHook(() => usePhysicalBarcodeScanner({ enabled: true, onScan }));

    press(document.body, '7', {}, 20);
    press(document.body, 'A', invalidOptions, 20);
    press(document.body, 'Enter', {}, 0);

    expect(onScan).not.toHaveBeenCalled();
  });

  it('resets on paste and never turns Ctrl+V into a scan', () => {
    const onScan = vi.fn();
    renderHook(() => usePhysicalBarcodeScanner({ enabled: true, onScan }));

    press(document.body, '7', {}, 20);
    fireEvent.paste(document.body, { clipboardData: { getData: () => '7501234567890' } });
    sendScan(document.body, 'ABC9', 'Enter', { ctrlKey: true });
    expect(onScan).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onScan).not.toHaveBeenCalled();
  });

  it('suppresses a technical duplicate but allows a legitimate repeated scan after the window', () => {
    const onScan = vi.fn();
    renderHook(() => usePhysicalBarcodeScanner({ enabled: true, onScan }));

    sendScan(document.body, 'ABC9');
    sendScan(document.body, 'ABC9');
    expect(onScan).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(126);
    sendScan(document.body, 'ABC9');
    expect(onScan).toHaveBeenCalledTimes(2);
  });

  it('does not emit a rejected short or over-limit burst', () => {
    const onScan = vi.fn();
    renderHook(() => usePhysicalBarcodeScanner({ enabled: true, onScan, maxBuffer: 4 }));

    sendScan(document.body, 'ABC');
    sendScan(document.body, 'ABCDE');

    expect(onScan).not.toHaveBeenCalled();
  });

  it('stops listening when disabled and cleans the listener and timer on unmount', () => {
    const onScan = vi.fn();
    const { rerender, unmount } = renderHook(
      (props) => usePhysicalBarcodeScanner(props),
      { initialProps: { enabled: true, onScan } }
    );

    press(document.body, 'A', {}, 0);
    rerender({ enabled: false, onScan });
    sendScan(document.body, 'ABC9');
    expect(onScan).not.toHaveBeenCalled();

    unmount();
    sendScan(document.body, '7501234567890');
    expect(onScan).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not capture a scan while a blocking dialog owns focus', () => {
    const onScan = vi.fn();
    const dialogButton = appendTarget('button');
    const dialog = appendTarget('div', { role: 'dialog', 'aria-modal': 'true' });
    dialog.appendChild(dialogButton);
    renderHook(() => usePhysicalBarcodeScanner({ enabled: true, onScan }));

    sendScan(dialogButton, 'ABC9');

    expect(onScan).not.toHaveBeenCalled();
  });
});
