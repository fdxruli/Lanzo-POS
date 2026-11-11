// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserMultiFormatReader,
  ChecksumException,
  DecodeHintType,
  FormatException,
  NotFoundException,
} from '@zxing/library';
import { isRecoverableDecodeError, useZxingScanner } from '../useZxingScanner';
import {
  expandNormalizedRoi,
  getCoveredVideoRect,
  mapVisibleRegionToSource,
} from '../../../components/scanner/scannerGeometry';

const zxing = vi.hoisted(() => ({
  instances: [],
  queues: {
    normal: [],
    hard: [],
  },
  contexts: [],
}));

vi.mock('@zxing/library', async () => {
  const actual = await vi.importActual('@zxing/library');

  return {
    ...actual,
    BrowserMultiFormatReader: vi.fn(function MockBrowserMultiFormatReader(hints) {
      const hard = hints?.get?.(actual.DecodeHintType.TRY_HARDER) === true;
      const reader = {
        hard,
        reset: vi.fn(),
        decodeBitmap: vi.fn(() => {
          const queue = zxing.queues[hard ? 'hard' : 'normal'];
          const next = queue.length > 0
            ? queue.shift()
            : actual.NotFoundException.getNotFoundInstance();

          if (typeof next === 'function') return next();
          if (next?.type === 'result') return next.value;
          throw next;
        }),
      };

      Object.assign(this, reader);
      zxing.instances.push(this);
    }),
  };
});

const ScannerHarness = (props) => {
  const { ref, torch, toggleTorch } = useZxingScanner(props);
  return (
    <>
      <video ref={ref} />
      {torch.supported && (
        <button type="button" onClick={toggleTorch} disabled={torch.pending}
          aria-pressed={torch.enabled}>
          Linterna
        </button>
      )}
    </>
  );
};

const createResult = (text = '7501234567890') => ({
  getText: () => text,
});

const createNotFoundError = () => NotFoundException.getNotFoundInstance();

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

const createTrack = ({
  focusMode,
  torch = false,
  settings,
  includeCapabilities = true,
  applyConstraints = vi.fn(),
} = {}) => {
  const listeners = new Map();
  const track = {
    kind: 'video',
    readyState: 'live',
    stop: vi.fn(() => { track.readyState = 'ended'; }),
    applyConstraints,
    getSettings: vi.fn(settings || (() => ({ facingMode: 'environment' }))),
    addEventListener: vi.fn((type, handler) => {
      const handlers = listeners.get(type) || new Set();
      handlers.add(handler);
      listeners.set(type, handlers);
    }),
    removeEventListener: vi.fn((type, handler) => {
      listeners.get(type)?.delete(handler);
    }),
    dispatchEvent: vi.fn((event) => {
      listeners.get(event.type)?.forEach((handler) => handler(event));
      return true;
    }),
  };

  track.emitEnded = () => {
    track.readyState = 'ended';
    track.dispatchEvent(new Event('ended'));
  };

  if (includeCapabilities) {
    track.getCapabilities = vi.fn(() => ({ focusMode, ...(torch ? { torch: true } : {}) }));
  }

  return track;
};

const createStream = (track) => ({
  getVideoTracks: vi.fn(() => [track]),
  getTracks: vi.fn(() => [track]),
});

const getNormalReader = () => zxing.instances.find((reader) => !reader.hard);
const getHardReader = () => zxing.instances.find((reader) => reader.hard);
const getLatestNormalReader = () => [...zxing.instances].reverse()
  .find((reader) => !reader.hard);
const queueMisses = (count, kind = 'normal') => {
  zxing.queues[kind].push(...Array.from({ length: count }, createNotFoundError));
};

const renderScanner = async ({
  track,
  stream: providedStream,
  getUserMediaImplementation,
  videoSize = { width: 1920, height: 1080 },
  ...props
} = {}) => {
  const stream = providedStream || createStream(track);
  const previousAcquisitions = navigator.mediaDevices.getUserMedia.mock.calls.length;
  if (getUserMediaImplementation) {
    navigator.mediaDevices.getUserMedia.mockImplementation(getUserMediaImplementation);
  } else {
    navigator.mediaDevices.getUserMedia.mockResolvedValue(stream);
  }
  const view = render(<ScannerHarness paused={false} {...props} />);
  const video = view.container.querySelector('video');

  Object.defineProperties(video, {
    videoWidth: { configurable: true, value: videoSize.width },
    videoHeight: { configurable: true, value: videoSize.height },
  });

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(previousAcquisitions + 1);
  return { stream, track, video, view };
};

const flushTimers = async (milliseconds) => {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await Promise.resolve();
    await Promise.resolve();
  });
};

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('recoverable ZXing error classification', () => {
  it.each([
    ['NotFoundException', NotFoundException, () => NotFoundException.getNotFoundInstance()],
    ['ChecksumException', ChecksumException, () => ChecksumException.getChecksumInstance()],
    ['FormatException', FormatException, () => FormatException.getFormatInstance()],
  ])('recognizes a real %s instance', (_label, ErrorType, createError) => {
    const error = createError();

    expect(error).toBeInstanceOf(ErrorType);
    expect(error.getKind()).toBe(ErrorType.kind);
    expect(isRecoverableDecodeError(error)).toBe(true);
  });

  it('does not treat constructor names or ordinary errors as authoritative', () => {
    expect(isRecoverableDecodeError({ name: 'NotFoundException' })).toBe(false);
    expect(isRecoverableDecodeError(new Error('decoder broke'))).toBe(false);
    expect(isRecoverableDecodeError({ getKind: () => NotFoundException.kind })).toBe(true);
  });
});

beforeEach(() => {
  zxing.instances.length = 0;
  zxing.queues.normal.length = 0;
  zxing.queues.hard.length = 0;
  zxing.contexts.length = 0;
  BrowserMultiFormatReader.mockClear();

  vi.useRealTimers();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });

  const contextsByCanvas = new Map();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext() {
    if (contextsByCanvas.has(this)) return contextsByCanvas.get(this);

    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn((_x, _y, width, height) => ({
        data: new Uint8ClampedArray(width * height * 4),
      })),
    };
    contextsByCanvas.set(this, context);
    zxing.contexts.push(context);
    return context;
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useZxingScanner camera enhancement', () => {
  it('offers torch only when the active track advertises it', async () => {
    const supported = createTrack({ torch: true });
    const first = await renderScanner({ track: supported });
    expect(first.view.queryByRole('button', { name: 'Linterna' })).not.toBeNull();
    expect(supported.applyConstraints).not.toHaveBeenCalled();
    first.view.unmount();

    const unsupported = createTrack();
    const second = await renderScanner({ track: unsupported });
    expect(second.view.queryByRole('button', { name: 'Linterna' })).toBeNull();
    expect(unsupported.applyConstraints).not.toHaveBeenCalled();
  });

  it('hides torch when the track advertises it but cannot apply constraints', async () => {
    const track = createTrack({ torch: true });
    track.applyConstraints = undefined;
    const { view } = await renderScanner({ track });
    expect(view.queryByRole('button', { name: 'Linterna' })).toBeNull();
  });

  it('switches the light on and off without replacing video or ZXing', async () => {
    let light = false;
    const track = createTrack({
      torch: true,
      settings: () => ({ torch: light }),
      applyConstraints: vi.fn(async ({ advanced }) => { light = advanced[0].torch; }),
    });
    const { view, stream, video } = await renderScanner({ track });
    const button = view.getByRole('button', { name: 'Linterna' });
    await act(async () => { fireEvent.click(button); });
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(video.srcObject).toBe(stream);

    await act(async () => { fireEvent.click(button); });
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(getNormalReader().reset).not.toHaveBeenCalled();
  });

  it('reports optional torch failure while decoding continues', async () => {
    vi.useFakeTimers();
    const track = createTrack({
      torch: true,
      applyConstraints: vi.fn().mockRejectedValue(new Error('torch blocked')),
    });
    const onTorchError = vi.fn();
    const onError = vi.fn();
    const { view } = await renderScanner({ track, onTorchError, onError });
    const button = view.getByRole('button', { name: 'Linterna' });
    await act(async () => { fireEvent.click(button); });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(onTorchError).toHaveBeenCalledTimes(1);
    await flushTimers(1);
    expect(getNormalReader().decodeBitmap).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not claim light is on when track settings contradict a successful call', async () => {
    const track = createTrack({ torch: true, settings: () => ({ torch: false }) });
    const onTorchError = vi.fn();
    const { view } = await renderScanner({ track, onTorchError });
    const button = view.getByRole('button', { name: 'Linterna' });
    await act(async () => { fireEvent.click(button); });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(onTorchError).toHaveBeenCalledTimes(1);
  });

  it('ignores an in-flight torch rejection after unmount', async () => {
    const operation = createDeferred();
    const track = createTrack({ torch: true, applyConstraints: vi.fn(() => operation.promise) });
    const onTorchError = vi.fn();
    const { view, video } = await renderScanner({ track, onTorchError });
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Linterna' })); });
    expect(track.applyConstraints).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => { operation.reject(new Error('late torch failure')); });
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBe(null);
    expect(onTorchError).not.toHaveBeenCalled();
  });

  it('does not let an old torch operation change the next scanner session', async () => {
    const pending = createDeferred();
    const oldTrack = createTrack({ torch: true, applyConstraints: vi.fn(() => pending.promise) });
    const old = await renderScanner({ track: oldTrack });
    await act(async () => { fireEvent.click(old.view.getByRole('button', { name: 'Linterna' })); });
    old.view.unmount();

    const newTrack = createTrack({ torch: true });
    const fresh = await renderScanner({ track: newTrack });
    const button = fresh.view.getByRole('button', { name: 'Linterna' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await act(async () => { pending.resolve(); });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(newTrack.applyConstraints).not.toHaveBeenCalled();
  });

  it('rejects repeated clicks while a torch request is pending', async () => {
    const pending = createDeferred();
    const track = createTrack({ torch: true, applyConstraints: vi.fn(() => pending.promise) });
    const { view } = await renderScanner({ track });
    const button = view.getByRole('button', { name: 'Linterna' });
    await act(async () => { fireEvent.click(button); fireEvent.click(button); });
    expect(track.applyConstraints).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    await act(async () => { pending.resolve(); });
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('sequences torch after optional focus without blocking decoding', async () => {
    vi.useFakeTimers();
    const focus = createDeferred();
    let light = false;
    const track = createTrack({
      focusMode: ['continuous'],
      torch: true,
      settings: () => ({ torch: light }),
      applyConstraints: vi.fn(({ advanced }) => {
        if (advanced[0].focusMode === 'continuous' && !('torch' in advanced[0])) {
          return focus.promise;
        }
        light = advanced[0].torch;
        return Promise.resolve();
      }),
    });
    const { view } = await renderScanner({ track });
    const button = view.getByRole('button', { name: 'Linterna' });
    await act(async () => { fireEvent.click(button); });
    expect(track.applyConstraints).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    await flushTimers(1);
    expect(getNormalReader().decodeBitmap).toHaveBeenCalled();

    await act(async () => { focus.resolve(); });
    expect(track.applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ torch: true, focusMode: 'continuous' }],
    });
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('drops a queued torch request when the camera track ends', async () => {
    const focus = createDeferred();
    const track = createTrack({
      focusMode: ['continuous'],
      torch: true,
      applyConstraints: vi.fn(() => focus.promise),
    });
    const onTorchError = vi.fn();
    const { view } = await renderScanner({ track, onTorchError });
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Linterna' })); });
    track.emitEnded();
    await act(async () => { focus.resolve(); });
    expect(track.applyConstraints).toHaveBeenCalledTimes(1);
    expect(view.queryByRole('button', { name: 'Linterna' })).toBeNull();
    expect(onTorchError).not.toHaveBeenCalled();
  });

  it('applies continuous autofocus after acquiring a capable camera track', async () => {
    const track = createTrack({ focusMode: ['manual', 'single-shot', 'continuous'] });
    await renderScanner({ track });

    await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: 'continuous' }],
    }));

    expect(track.getCapabilities).toHaveBeenCalledTimes(1);
    expect(track.getSettings).toHaveBeenCalledTimes(1);
  });

  it('starts playback and decodes while continuous autofocus remains pending', async () => {
    vi.useFakeTimers();
    const autofocus = createDeferred();
    const track = createTrack({
      focusMode: ['continuous'],
      applyConstraints: vi.fn(() => autofocus.promise),
    });
    const onDecodeResult = vi.fn();
    zxing.queues.normal.push({ type: 'result', value: createResult('PENDING_FOCUS') });

    const { stream, video } = await renderScanner({ track, onDecodeResult });

    expect(track.applyConstraints).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBe(stream);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    await flushTimers(1);
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(1);
    expect(onDecodeResult.mock.calls[0][0].getText()).toBe('PENDING_FOCUS');

    autofocus.resolve();
    await flushPromises();
  });

  it('keeps decoding operational when continuous focus is unsupported', async () => {
    const track = createTrack({ focusMode: ['manual', 'single-shot'] });
    await renderScanner({ track });

    await waitFor(() => expect(getNormalReader().decodeBitmap).toHaveBeenCalled());
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  it('fails open when getCapabilities is unavailable', async () => {
    const track = createTrack({ includeCapabilities: false });
    await renderScanner({ track });

    await waitFor(() => expect(getNormalReader().decodeBitmap).toHaveBeenCalled());
    expect(track.getSettings).toHaveBeenCalledTimes(1);
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  it('fails open when the optional autofocus constraint is rejected', async () => {
    const onError = vi.fn();
    const applyConstraints = vi.fn().mockRejectedValue(new Error('focus not available'));
    const track = createTrack({
      focusMode: ['continuous'],
      applyConstraints,
    });
    await renderScanner({ track, onError });

    await waitFor(() => expect(applyConstraints).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getNormalReader().decodeBitmap).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores late autofocus rejection after closing an active scanner', async () => {
    vi.useFakeTimers();
    const autofocus = createDeferred();
    const track = createTrack({
      focusMode: ['continuous'],
      applyConstraints: vi.fn(() => autofocus.promise),
    });
    const onError = vi.fn();
    const { video, view } = await renderScanner({ track, onError });
    const reader = getNormalReader();

    expect(track.applyConstraints).toHaveBeenCalledTimes(1);
    await flushTimers(1);
    const attempts = reader.decodeBitmap.mock.calls.length;
    view.unmount();
    autofocus.reject(new Error('late optional autofocus failure'));
    await flushPromises();
    await flushTimers(1000);

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBe(null);
    expect(reader.reset).toHaveBeenCalled();
    expect(reader.decodeBitmap).toHaveBeenCalledTimes(attempts);
    expect(onError).not.toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('stops readers and the active track on cleanup without reapplying focus', async () => {
    const track = createTrack({ focusMode: ['continuous'] });
    const { view } = await renderScanner({ track });
    await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledTimes(1));

    const autofocusCalls = track.applyConstraints.mock.calls.length;
    view.unmount();

    await Promise.resolve();
    expect(getNormalReader().reset).toHaveBeenCalled();
    expect(getHardReader().reset).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(track.applyConstraints).toHaveBeenCalledTimes(autofocusCalls);
  });

  it('attaches the acquired stream manually and calls getUserMedia once per session', async () => {
    const track = createTrack();
    const { stream, video } = await renderScanner({ track });

    await waitFor(() => expect(getNormalReader().decodeBitmap).toHaveBeenCalled());
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBe(stream);
    expect(video.autoplay).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.muted).toBe(true);
    expect(getNormalReader().decodeFromStream).toBeUndefined();
  });

  it('constructs an independent hard reader with the exact normal format set plus TRY_HARDER', async () => {
    const hints = new Map([
      [DecodeHintType.POSSIBLE_FORMATS, ['EAN_13', 'CODE_128']],
    ]);
    const track = createTrack();
    await renderScanner({ track, hints });

    expect(zxing.instances).toHaveLength(2);
    const normalHints = BrowserMultiFormatReader.mock.calls[0][0];
    const hardHints = BrowserMultiFormatReader.mock.calls[1][0];
    expect(normalHints).toBe(hints);
    expect(hardHints).not.toBe(hints);
    expect(hardHints.get(DecodeHintType.POSSIBLE_FORMATS))
      .toBe(normalHints.get(DecodeHintType.POSSIBLE_FORMATS));
    expect(hardHints.get(DecodeHintType.TRY_HARDER)).toBe(true);
    expect(hardHints.size).toBe(2);
  });

  it('does not add QR or any other format to hard hints', async () => {
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, ['EAN_13']]]);
    const track = createTrack();
    await renderScanner({ track, hints });

    const hardHints = BrowserMultiFormatReader.mock.calls[1][0];
    expect(hardHints.get(DecodeHintType.POSSIBLE_FORMATS)).toEqual(['EAN_13']);
    expect(hardHints.get(DecodeHintType.POSSIBLE_FORMATS)).not.toContain('QR_CODE');
  });

  it('runs ROI normal first and skips full-frame fallback after ROI success', async () => {
    const decodeRegionRef = { current: { x: 0.1, y: 0.35, width: 0.8, height: 0.3 } };
    zxing.queues.normal.push({ type: 'result', value: createResult('ROI') });
    const track = createTrack();
    const { video } = await renderScanner({ track, decodeRegionRef });

    await waitFor(() => expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(1));
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(1);
    expect(zxing.contexts[0].drawImage).toHaveBeenCalledWith(
      video,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      0,
      0,
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('captures the source rectangle aligned with a cover viewport crop', async () => {
    const coveredRect = getCoveredVideoRect({
      containerWidth: 400,
      containerHeight: 800,
      videoWidth: 1920,
      videoHeight: 1080,
    });
    const visibleReticle = { x: 0.1, y: 0.4, width: 0.8, height: 0.2 };
    const decodeRegionRef = {
      current: expandNormalizedRoi(
        mapVisibleRegionToSource(visibleReticle, coveredRect),
      ),
    };
    zxing.queues.normal.push({ type: 'result', value: createResult('COVER') });
    const track = createTrack();
    const { video } = await renderScanner({ track, decodeRegionRef });

    await waitFor(() => expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(1));
    expect(zxing.contexts[0].drawImage).toHaveBeenCalledWith(
      video,
      722,
      421,
      476,
      238,
      0,
      0,
      476,
      238,
    );
  });

  it('runs full-frame normal after a recoverable ROI miss', async () => {
    const decodeRegionRef = { current: { x: 0.1, y: 0.35, width: 0.8, height: 0.3 } };
    zxing.queues.normal.push(
      createNotFoundError(),
      { type: 'result', value: createResult('FULL') },
    );
    const track = createTrack();
    await renderScanner({ track, decodeRegionRef });

    await waitFor(() => expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(2));
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(2);
  });

  it('allows a barcode outside the ROI to succeed through full-frame fallback', async () => {
    const decodeRegionRef = { current: { x: 0.4, y: 0.35, width: 0.2, height: 0.3 } };
    const onDecodeResult = vi.fn();
    zxing.queues.normal.push(
      createNotFoundError(),
      { type: 'result', value: createResult('OUTSIDE') },
    );
    const track = createTrack();
    await renderScanner({ track, decodeRegionRef, onDecodeResult });

    await waitFor(() => expect(onDecodeResult).toHaveBeenCalledWith(expect.objectContaining({
      getText: expect.any(Function),
    })));
    expect(onDecodeResult.mock.calls[0][0].getText()).toBe('OUTSIDE');
  });

  it('keeps full-frame normal available when ROI geometry is absent', async () => {
    zxing.queues.normal.push({ type: 'result', value: createResult('FULL_ONLY') });
    const track = createTrack();
    await renderScanner({ track, decodeRegionRef: { current: null } });

    await waitFor(() => expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(1));
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(1);
  });

  it('exposes one recoverable miss only after the complete ROI plus full-frame cycle', async () => {
    const decodeRegionRef = { current: { x: 0.1, y: 0.35, width: 0.8, height: 0.3 } };
    const onDecodeError = vi.fn();
    zxing.queues.normal.push(
      createNotFoundError(),
      createNotFoundError(),
    );
    const track = createTrack();
    await renderScanner({ track, decodeRegionRef, onDecodeError });

    await waitFor(() => expect(onDecodeError).toHaveBeenCalledTimes(1));
    expect(onDecodeError.mock.calls[0][0]).toBeInstanceOf(NotFoundException);
    expect(onDecodeError.mock.calls[0][0].getKind()).toBe(NotFoundException.kind);
  });

  it('keeps the retry cadence after real ROI and full-frame NotFound instances', async () => {
    vi.useFakeTimers();
    const decodeRegionRef = { current: { x: 0.1, y: 0.35, width: 0.8, height: 0.3 } };
    const onError = vi.fn();
    queueMisses(4, 'normal');
    const track = createTrack();
    await renderScanner({ track, decodeRegionRef, onError });

    await flushTimers(1);
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();

    await flushTimers(150);
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(4);
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps TRY_HARDER off during the first seven complete misses', async () => {
    vi.useFakeTimers();
    queueMisses(7, 'normal');
    const onDecodeError = vi.fn();
    const track = createTrack();
    await renderScanner({ track, onDecodeError });

    await flushTimers(1);
    for (let index = 0; index < 6; index += 1) {
      await flushTimers(150);
    }

    expect(getHardReader().decodeBitmap).not.toHaveBeenCalled();
    expect(onDecodeError).toHaveBeenCalledTimes(7);
  });

  it('runs TRY_HARDER on the eighth complete miss and reuses the same full canvas', async () => {
    vi.useFakeTimers();
    queueMisses(8, 'normal');
    queueMisses(1, 'hard');
    const track = createTrack();
    await renderScanner({ track });

    await flushTimers(1);
    for (let index = 0; index < 7; index += 1) {
      await flushTimers(150);
    }

    expect(getHardReader().decodeBitmap).toHaveBeenCalledTimes(1);
    expect(zxing.contexts.filter((context) => context.drawImage.mock.calls.length > 0))
      .toHaveLength(1);
    expect(zxing.contexts[0].drawImage).toHaveBeenCalledTimes(8);
    // Eight full frames -> eight pixel reads, not a ninth on TRY_HARDER.
    expect(zxing.contexts[0].getImageData).toHaveBeenCalledTimes(8);
    expect(getHardReader().decodeBitmap.mock.calls[0][0])
      .toBe(getNormalReader().decodeBitmap.mock.calls[7][0]);
  });

  it('reuses the full bitmap on a hard pass after ROI fallback misses', async () => {
    vi.useFakeTimers();
    const decodeRegionRef = { current: { x: 0.1, y: 0.35, width: 0.8, height: 0.3 } };
    queueMisses(16, 'normal');
    queueMisses(1, 'hard');
    const track = createTrack();
    await renderScanner({ track, decodeRegionRef });

    await flushTimers(1);
    for (let index = 0; index < 7; index += 1) {
      await flushTimers(150);
    }

    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(16);
    expect(getHardReader().decodeBitmap).toHaveBeenCalledTimes(1);
    const fullBitmap = getNormalReader().decodeBitmap.mock.calls[15][0];
    expect(getHardReader().decodeBitmap.mock.calls[0][0]).toBe(fullBitmap);
    expect(getNormalReader().decodeBitmap.mock.calls[14][0]).not.toBe(fullBitmap);
    // The ROI and full-frame source each have eight captures, with no extra
    // pixel extraction for the intensive pass.
    expect(zxing.contexts).toHaveLength(2);
    expect(zxing.contexts[0].getImageData).toHaveBeenCalledTimes(8);
    expect(zxing.contexts[1].getImageData).toHaveBeenCalledTimes(8);
  });

  it('resets the miss window after a hard success', async () => {
    vi.useFakeTimers();
    queueMisses(8, 'normal');
    zxing.queues.hard.push({ type: 'result', value: createResult('HARD') });
    queueMisses(7, 'normal');
    const track = createTrack();
    await renderScanner({ track });

    await flushTimers(1);
    for (let index = 0; index < 7; index += 1) {
      await flushTimers(150);
    }
    await flushTimers(500);
    for (let index = 0; index < 6; index += 1) {
      await flushTimers(150);
    }

    expect(getHardReader().decodeBitmap).toHaveBeenCalledTimes(1);
  });

  it('resets the miss window after a normal success', async () => {
    vi.useFakeTimers();
    queueMisses(2, 'normal');
    zxing.queues.normal.push({ type: 'result', value: createResult('NORMAL') });
    queueMisses(7, 'normal');
    const track = createTrack();
    await renderScanner({ track });

    await flushTimers(1);
    await flushTimers(150);
    await flushTimers(150);
    await flushTimers(500);
    for (let index = 0; index < 6; index += 1) {
      await flushTimers(150);
    }

    expect(getHardReader().decodeBitmap).not.toHaveBeenCalled();
  });

  it('does not start a second decode pipeline while one decode is unresolved', async () => {
    let resolveDecode;
    const pendingDecode = new Promise((resolve) => { resolveDecode = resolve; });
    zxing.queues.normal.push(() => pendingDecode);
    const track = createTrack();
    await renderScanner({ track });

    await waitFor(() => expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(1);
    resolveDecode(createResult('PENDING'));
  });

  it('preserves 500ms success cadence', async () => {
    vi.useFakeTimers();
    zxing.queues.normal.push({ type: 'result', value: createResult('SUCCESS') });
    queueMisses(1, 'normal');
    const track = createTrack();
    await renderScanner({ track });

    await flushTimers(1);
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(1);
    await flushTimers(499);
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(1);
    await flushTimers(1);
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(2);
  });

  it('preserves 150ms miss cadence', async () => {
    vi.useFakeTimers();
    queueMisses(2, 'normal');
    const track = createTrack();
    await renderScanner({ track });

    await flushTimers(1);
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(1);
    await flushTimers(149);
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(1);
    await flushTimers(1);
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale decode result after unmount and cleans stream state', async () => {
    let resolveDecode;
    const pendingDecode = new Promise((resolve) => { resolveDecode = resolve; });
    zxing.queues.normal.push(() => pendingDecode);
    const onDecodeResult = vi.fn();
    const track = createTrack();
    const { view, video } = await renderScanner({ track, onDecodeResult });

    await waitFor(() => expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(1));
    view.unmount();
    resolveDecode(createResult('STALE'));
    await Promise.resolve();
    await Promise.resolve();

    expect(onDecodeResult).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(video.srcObject).toBe(null);
    expect(getNormalReader().reset).toHaveBeenCalled();
    expect(getHardReader().reset).toHaveBeenCalled();
  });

  it('releases a getUserMedia stream that resolves after unmount', async () => {
    const acquisition = createDeferred();
    const track = createTrack();
    navigator.mediaDevices.getUserMedia.mockImplementation(() => acquisition.promise);
    const view = render(<ScannerHarness paused={false} />);
    const video = view.container.querySelector('video');

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    view.unmount();
    acquisition.resolve(createStream(track));
    await flushPromises();

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject ?? null).toBe(null);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(getNormalReader().decodeBitmap).not.toHaveBeenCalled();
  });

  it('stops scheduled decoder work when paused and resumes with a new session', async () => {
    vi.useFakeTimers();
    queueMisses(2, 'normal');
    const track = createTrack();
    const view = await renderScanner({ track });

    await flushTimers(1);
    const callsBeforePause = getNormalReader().decodeBitmap.mock.calls.length;
    view.view.rerender(<ScannerHarness paused />);
    await flushTimers(1000);
    expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(callsBeforePause);
    expect(track.stop).toHaveBeenCalled();

    const nextTrack = createTrack();
    const nextStream = createStream(nextTrack);
    navigator.mediaDevices.getUserMedia.mockResolvedValue(nextStream);
    view.view.rerender(<ScannerHarness paused={false} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    expect(nextTrack.readyState).toBe('live');
  });

  it('releases camera resources across three consecutive openings', async () => {
    vi.useFakeTimers();
    const tracks = Array.from({ length: 3 }, () => createTrack());
    const streams = tracks.map(createStream);
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(streams[0])
      .mockResolvedValueOnce(streams[1])
      .mockResolvedValueOnce(streams[2]);
    const { view, video } = await renderScanner({
      track: tracks[0],
      stream: streams[0],
      getUserMediaImplementation: getUserMedia,
    });

    for (let index = 0; index < tracks.length; index += 1) {
      expect(video.srcObject).toBe(streams[index]);
      await flushTimers(1);
      const reader = getLatestNormalReader();
      expect(reader.decodeBitmap).toHaveBeenCalledTimes(1);

      view.rerender(<ScannerHarness paused />);
      expect(tracks[index].stop).toHaveBeenCalledTimes(1);
      expect(video.srcObject).toBe(null);
      expect(reader.reset).toHaveBeenCalled();

      if (index < tracks.length - 1) {
        view.rerender(<ScannerHarness paused={false} />);
        await flushPromises();
      }
    }

    expect(getUserMedia).toHaveBeenCalledTimes(3);
  });

  it('does not let stale autofocus cleanup stop a newer session', async () => {
    const autofocus = createDeferred();
    const trackA = createTrack({
      focusMode: ['continuous'],
      applyConstraints: vi.fn(() => autofocus.promise),
    });
    const trackB = createTrack();
    const streamA = createStream(trackA);
    const streamB = createStream(trackB);
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(streamA)
      .mockResolvedValueOnce(streamB);
    const { view, video } = await renderScanner({
      track: trackA,
      stream: streamA,
      getUserMediaImplementation: getUserMedia,
    });

    expect(trackA.applyConstraints).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(<ScannerHarness paused={false} deviceId="new-camera" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const readerB = getLatestNormalReader();
    await waitFor(() => expect(readerB.decodeBitmap).toHaveBeenCalledTimes(1));
    expect(video.srcObject).toBe(streamB);
    expect(trackB.stop).not.toHaveBeenCalled();

    autofocus.resolve();
    await flushPromises();

    expect(video.srcObject).toBe(streamB);
    expect(trackB.stop).not.toHaveBeenCalled();
    expect(readerB.reset).not.toHaveBeenCalled();
  });

  it('does not let stale autofocus completion invalidate new session ownership', async () => {
    vi.useFakeTimers();
    const autofocus = createDeferred();
    const trackA = createTrack({
      focusMode: ['continuous'],
      applyConstraints: vi.fn(() => autofocus.promise),
    });
    const trackB = createTrack();
    const streamA = createStream(trackA);
    const streamB = createStream(trackB);
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(streamA)
      .mockResolvedValueOnce(streamB);
    const { view, video } = await renderScanner({
      track: trackA,
      stream: streamA,
      getUserMediaImplementation: getUserMedia,
    });

    await act(async () => {
      view.rerender(<ScannerHarness paused={false} deviceId="new-camera" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const readerB = getLatestNormalReader();
    await flushTimers(1);
    expect(readerB.decodeBitmap).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBe(streamB);

    autofocus.resolve();
    await flushPromises();
    await flushTimers(1000);

    expect(video.srcObject).toBe(streamB);
    expect(trackB.stop).not.toHaveBeenCalled();
    expect(readerB.reset).not.toHaveBeenCalled();
  });

  it('does not let stale cleanup clear a newer session timer', async () => {
    vi.useFakeTimers();
    const autofocus = createDeferred();
    const trackA = createTrack({
      focusMode: ['continuous'],
      applyConstraints: vi.fn(() => autofocus.promise),
    });
    const trackB = createTrack();
    const streamA = createStream(trackA);
    const streamB = createStream(trackB);
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(streamA)
      .mockResolvedValueOnce(streamB);
    const { view } = await renderScanner({
      track: trackA,
      stream: streamA,
      getUserMediaImplementation: getUserMedia,
    });

    await act(async () => {
      view.rerender(<ScannerHarness paused={false} deviceId="new-camera" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const readerB = getLatestNormalReader();
    autofocus.resolve();
    await flushPromises();
    expect(readerB.decodeBitmap).not.toHaveBeenCalled();

    await flushTimers(1);
    expect(readerB.decodeBitmap).toHaveBeenCalledTimes(1);
  });

  it('does not let a late session finish clear a newer in-flight lock', async () => {
    vi.useFakeTimers();
    const decodeA = createDeferred();
    const decodeB = createDeferred();
    zxing.queues.normal.push(
      () => decodeA.promise,
      () => decodeB.promise,
    );
    const trackA = createTrack();
    const trackB = createTrack();
    const streamA = createStream(trackA);
    const streamB = createStream(trackB);
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(streamA)
      .mockResolvedValueOnce(streamB);
    const { view } = await renderScanner({
      track: trackA,
      stream: streamA,
      getUserMediaImplementation: getUserMedia,
    });
    const readerA = getLatestNormalReader();

    await flushTimers(1);
    expect(readerA.decodeBitmap).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(<ScannerHarness paused={false} deviceId="new-camera" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const readerB = getLatestNormalReader();
    await flushTimers(1);
    expect(readerB.decodeBitmap).toHaveBeenCalledTimes(1);

    decodeA.resolve(createResult('STALE'));
    await flushPromises();
    await flushTimers(5000);

    expect(readerB.decodeBitmap).toHaveBeenCalledTimes(1);
    decodeB.resolve(createResult('CURRENT'));
    await flushPromises();
  });

  it('does not let stale cleanup reset a newer session reader', async () => {
    const autofocus = createDeferred();
    const trackA = createTrack({
      focusMode: ['continuous'],
      applyConstraints: vi.fn(() => autofocus.promise),
    });
    const trackB = createTrack();
    const streamA = createStream(trackA);
    const streamB = createStream(trackB);
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(streamA)
      .mockResolvedValueOnce(streamB);
    const { view } = await renderScanner({
      track: trackA,
      stream: streamA,
      getUserMediaImplementation: getUserMedia,
    });

    await act(async () => {
      view.rerender(<ScannerHarness paused={false} deviceId="new-camera" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const readerB = getLatestNormalReader();
    await waitFor(() => expect(readerB.decodeBitmap).toHaveBeenCalledTimes(1));
    autofocus.resolve();
    await flushPromises();

    expect(readerB.reset).not.toHaveBeenCalled();
  });

  it('aborts startup when video.play throws synchronously', async () => {
    vi.useFakeTimers();
    const playError = new Error('play threw');
    HTMLMediaElement.prototype.play.mockImplementation(() => {
      throw playError;
    });
    const onError = vi.fn();
    const track = createTrack();
    const { video } = await renderScanner({ track, onError });

    await flushPromises();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(playError);
    expect(video.srcObject).toBe(null);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(getNormalReader().decodeBitmap).not.toHaveBeenCalled();

    await flushTimers(1000);
    expect(getNormalReader().decodeBitmap).not.toHaveBeenCalled();
  });

  it('aborts startup and cleans owned media when video.play rejects', async () => {
    vi.useFakeTimers();
    const play = createDeferred();
    HTMLMediaElement.prototype.play.mockImplementation(() => play.promise);
    const playError = new Error('play rejected');
    const onError = vi.fn();
    const track = createTrack();
    const { video } = await renderScanner({ track, onError });

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(getNormalReader().decodeBitmap).not.toHaveBeenCalled();
    play.reject(playError);
    await flushPromises();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(playError);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBe(null);
    await flushTimers(1000);
    expect(getNormalReader().decodeBitmap).not.toHaveBeenCalled();
  });

  it('does not let stale play rejection affect a newer session', async () => {
    vi.useFakeTimers();
    const playA = createDeferred();
    HTMLMediaElement.prototype.play
      .mockImplementationOnce(() => playA.promise)
      .mockImplementation(() => Promise.resolve());
    const onError = vi.fn();
    const trackA = createTrack();
    const trackB = createTrack();
    const streamA = createStream(trackA);
    const streamB = createStream(trackB);
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(streamA)
      .mockResolvedValueOnce(streamB);
    const { view, video } = await renderScanner({
      track: trackA,
      stream: streamA,
      getUserMediaImplementation: getUserMedia,
      onError,
    });

    await act(async () => {
      view.rerender(<ScannerHarness paused={false} deviceId="new-camera" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const readerB = getLatestNormalReader();
    await flushTimers(1);
    expect(readerB.decodeBitmap).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBe(streamB);

    playA.reject(new Error('stale play rejected'));
    await flushPromises();

    expect(onError).not.toHaveBeenCalled();
    expect(trackB.stop).not.toHaveBeenCalled();
    expect(video.srcObject).toBe(streamB);
    expect(readerB.reset).not.toHaveBeenCalled();
  });

  it('does not resume decoding after a track ends during pending autofocus', async () => {
    vi.useFakeTimers();
    const autofocus = createDeferred();
    const track = createTrack({
      focusMode: ['continuous'],
      applyConstraints: vi.fn(() => autofocus.promise),
    });
    const onError = vi.fn();
    const { video, stream } = await renderScanner({ track, onError });

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBe(stream);
    track.emitEnded();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBe(null);

    autofocus.resolve();
    await flushPromises();
    await flushTimers(1000);
    expect(getNormalReader().decodeBitmap).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it('cancels the first decode timer when a track ends after play', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const track = createTrack();
    const { video } = await renderScanner({ track, onError });

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    track.emitEnded();
    expect(onError).toHaveBeenCalledTimes(1);
    await flushTimers(1000);

    expect(getNormalReader().decodeBitmap).not.toHaveBeenCalled();
    expect(video.srcObject).toBe(null);
  });

  it('ignores a decode result when the track ends in flight', async () => {
    vi.useFakeTimers();
    const decode = createDeferred();
    zxing.queues.normal.push(() => decode.promise);
    const onDecodeResult = vi.fn();
    const onError = vi.fn();
    const track = createTrack();
    const { video } = await renderScanner({ track, onDecodeResult, onError });
    const reader = getNormalReader();

    await flushTimers(1);
    expect(reader.decodeBitmap).toHaveBeenCalledTimes(1);
    track.emitEnded();
    expect(onError).toHaveBeenCalledTimes(1);

    decode.resolve(createResult('STALE_TRACK_RESULT'));
    await flushPromises();
    await flushTimers(5000);

    expect(onDecodeResult).not.toHaveBeenCalled();
    expect(reader.decodeBitmap).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBe(null);
  });

  it('reports an ended active track at most once', async () => {
    const onError = vi.fn();
    const track = createTrack();
    await renderScanner({ track, onError });

    track.emitEnded();
    track.emitEnded();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('routes unexpected decoder errors to onError without treating them as misses', async () => {
    const onError = vi.fn();
    const unexpected = new Error('decoder broke');
    zxing.queues.normal.push(unexpected);
    const track = createTrack();
    await renderScanner({ track, onError });

    await waitFor(() => expect(onError).toHaveBeenCalledWith(unexpected));
  });

  it('does not expose NotFoundException as a camera error or console warning', async () => {
    const onError = vi.fn();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    queueMisses(1, 'normal');
    const track = createTrack();
    await renderScanner({ track, onError });

    await waitFor(() => expect(getNormalReader().decodeBitmap).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('does not expose an ROI miss as a duplicate external decode error', async () => {
    const decodeRegionRef = { current: { x: 0.1, y: 0.35, width: 0.8, height: 0.3 } };
    const onDecodeError = vi.fn();
    zxing.queues.normal.push(
      createNotFoundError(),
      { type: 'result', value: createResult('FULL') },
    );
    const track = createTrack();
    await renderScanner({ track, decodeRegionRef, onDecodeError });

    await waitFor(() => expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(2));
    expect(onDecodeError).not.toHaveBeenCalled();
  });
});
