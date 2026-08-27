// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useZxingScanner } from '../useZxingScanner';

const zxing = vi.hoisted(() => ({
  instances: [],
  stream: null,
}));

vi.mock('@zxing/library', () => ({
  BrowserMultiFormatReader: vi.fn(function MockBrowserMultiFormatReader() {
    const reader = {
      timeBetweenDecodingAttempts: null,
      reset: vi.fn(),
      decodeFromStream: vi.fn((_stream, videoElement) => {
        videoElement.srcObject = _stream;
        return Promise.resolve();
      }),
    };

    Object.assign(this, reader);
    zxing.instances.push(this);
  }),
}));

import { BrowserMultiFormatReader } from '@zxing/library';

const ScannerHarness = (props) => {
  const { ref } = useZxingScanner(props);
  return <video ref={ref} />;
};

const createTrack = ({ focusMode, includeCapabilities = true, applyConstraints = vi.fn() } = {}) => {
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

const renderScanner = ({ track, ...props } = {}) => {
  zxing.stream = createStream(track);
  navigator.mediaDevices.getUserMedia.mockResolvedValue(zxing.stream);
  return render(<ScannerHarness paused={false} {...props} />);
};

beforeEach(() => {
  zxing.instances.length = 0;
  zxing.stream = null;
  BrowserMultiFormatReader.mockClear();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
});

describe('useZxingScanner camera enhancement', () => {
  it('applies continuous autofocus after acquiring a capable camera track', async () => {
    const track = createTrack({ focusMode: ['manual', 'single-shot', 'continuous'] });
    renderScanner({ track });

    await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: 'continuous' }],
    }));

    expect(track.getCapabilities).toHaveBeenCalledTimes(1);
    expect(track.getSettings).toHaveBeenCalledTimes(1);
    expect(zxing.instances[0].decodeFromStream).toHaveBeenCalledTimes(1);
  });

  it('keeps decoding operational when continuous focus is unsupported', async () => {
    const track = createTrack({ focusMode: ['manual', 'single-shot'] });
    renderScanner({ track });

    await waitFor(() => expect(zxing.instances[0].decodeFromStream).toHaveBeenCalledTimes(1));
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  it('fails open when getCapabilities is unavailable', async () => {
    const track = createTrack({ includeCapabilities: false });
    renderScanner({ track });

    await waitFor(() => expect(zxing.instances[0].decodeFromStream).toHaveBeenCalledTimes(1));
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
    renderScanner({ track, onError });

    await waitFor(() => expect(applyConstraints).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
    expect(zxing.instances[0].decodeFromStream).toHaveBeenCalledTimes(1);
  });

  it('stops the reader and active track on cleanup without applying focus to a stale track', async () => {
    const track = createTrack({ focusMode: ['continuous'] });
    const view = renderScanner({ track });
    await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledTimes(1));

    const reader = zxing.instances[0];
    const autofocusCalls = track.applyConstraints.mock.calls.length;
    view.unmount();

    await Promise.resolve();
    expect(reader.reset).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(track.applyConstraints).toHaveBeenCalledTimes(autofocusCalls);
  });
});
