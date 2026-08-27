// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserMultiFormatReader, DecodeHintType } from '@zxing/library';
import { useZxingScanner } from '../useZxingScanner';

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
            : { name: 'NotFoundException', message: 'miss' };

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
  const { ref } = useZxingScanner(props);
  return <video ref={ref} />;
};

const createResult = (text = '7501234567890') => ({
  getText: () => text,
});

const createTrack = ({
  focusMode,
  includeCapabilities = true,
  applyConstraints = vi.fn(),
} = {}) => {
  const track = {
    kind: 'video',
    readyState: 'live',
    stop: vi.fn(() => { track.readyState = 'ended'; }),
    applyConstraints,
    getSettings: vi.fn(() => ({ facingMode: 'environment' })),
  };

  if (includeCapabilities) {
    track.getCapabilities = vi.fn(() => ({ focusMode }));
  }

  return track;
};

const createStream = (track) => ({
  getVideoTracks: vi.fn(() => [track]),
  getTracks: vi.fn(() => [track]),
});

const getNormalReader = () => zxing.instances.find((reader) => !reader.hard);
const getHardReader = () => zxing.instances.find((reader) => reader.hard);
const queueMisses = (count, kind = 'normal') => {
  zxing.queues[kind].push(...Array.from({ length: count }, () => ({
    name: 'NotFoundException',
    message: 'miss',
  })));
};

const renderScanner = async ({ track, videoSize = { width: 1920, height: 1080 }, ...props } = {}) => {
  const stream = createStream(track);
  navigator.mediaDevices.getUserMedia.mockResolvedValue(stream);
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
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  return { stream, track, video, view };
};

const flushTimers = async (milliseconds) => {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await Promise.resolve();
    await Promise.resolve();
  });
};

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
  it('applies continuous autofocus after acquiring a capable camera track', async () => {
    const track = createTrack({ focusMode: ['manual', 'single-shot', 'continuous'] });
    await renderScanner({ track });

    await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: 'continuous' }],
    }));

    expect(track.getCapabilities).toHaveBeenCalledTimes(1);
    expect(track.getSettings).toHaveBeenCalledTimes(1);
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

  it('runs full-frame normal after a recoverable ROI miss', async () => {
    const decodeRegionRef = { current: { x: 0.1, y: 0.35, width: 0.8, height: 0.3 } };
    zxing.queues.normal.push(
      { name: 'NotFoundException', message: 'roi miss' },
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
      { name: 'NotFoundException' },
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
      { name: 'NotFoundException', message: 'roi miss' },
      { name: 'NotFoundException', message: 'full miss' },
    );
    const track = createTrack();
    await renderScanner({ track, decodeRegionRef, onDecodeError });

    await waitFor(() => expect(onDecodeError).toHaveBeenCalledTimes(1));
    expect(onDecodeError).toHaveBeenCalledWith(expect.objectContaining({
      name: 'NotFoundException',
    }));
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
      { name: 'NotFoundException' },
      { type: 'result', value: createResult('FULL') },
    );
    const track = createTrack();
    await renderScanner({ track, decodeRegionRef, onDecodeError });

    await waitFor(() => expect(getNormalReader().decodeBitmap).toHaveBeenCalledTimes(2));
    expect(onDecodeError).not.toHaveBeenCalled();
  });
});
