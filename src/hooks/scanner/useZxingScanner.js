import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  BinaryBitmap,
  BrowserMultiFormatReader,
  DecodeHintType,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
} from '@zxing/library';
import { mapNormalizedRegionToSource } from '../../components/scanner/scannerGeometry';

const DEFAULT_CONSTRAINTS = {
  video: {
    facingMode: 'environment',
  },
  audio: false,
};

const CONTINUOUS_FOCUS_MODE = 'continuous';
const DEFAULT_MISS_DELAY_MS = 150;
const SUCCESS_DELAY_MS = 500;
const TRY_HARDER_AFTER_COMPLETE_MISSES = 8;

const RECOVERABLE_DECODE_ERROR_NAMES = new Set([
  'NotFoundException',
  'ChecksumException',
  'FormatException',
]);

const getVideoTracks = (stream) => {
  if (!stream || typeof stream.getVideoTracks !== 'function') {
    return [];
  }

  try {
    return stream.getVideoTracks() || [];
  } catch {
    return [];
  }
};

const getActiveVideoTrackFromStream = (stream) => {
  const tracks = getVideoTracks(stream);

  return tracks.find((track) => track?.readyState !== 'ended') || tracks[0] || null;
};

export const getActiveVideoTrack = (videoElement) => {
  return getActiveVideoTrackFromStream(videoElement?.srcObject);
};

export const inspectVideoTrack = (track) => {
  let capabilities = null;
  let settings = null;

  if (typeof track?.getCapabilities === 'function') {
    try {
      capabilities = track.getCapabilities() || null;
    } catch {
      capabilities = null;
    }
  }

  if (typeof track?.getSettings === 'function') {
    try {
      settings = track.getSettings() || null;
    } catch {
      settings = null;
    }
  }

  return { capabilities, settings };
};

export const applyContinuousAutofocus = async (track) => {
  if (
    !track
    || track.readyState === 'ended'
    || typeof track.applyConstraints !== 'function'
  ) {
    return false;
  }

  const { capabilities } = inspectVideoTrack(track);
  const focusModes = capabilities?.focusMode;

  if (
    track.readyState === 'ended'
    || !Array.isArray(focusModes)
    || !focusModes.includes(CONTINUOUS_FOCUS_MODE)
  ) {
    return false;
  }

  try {
    await track.applyConstraints({
      advanced: [{ focusMode: CONTINUOUS_FOCUS_MODE }],
    });
    return true;
  } catch {
    // Autofocus is a progressive enhancement. The browser's default focus
    // behavior remains available when the optional constraint is rejected.
    return false;
  }
};

const stopStreamTracks = (stream, excludedTrack = null) => {
  if (!stream || typeof stream.getTracks !== 'function') {
    return;
  }

  let tracks = [];
  try {
    tracks = stream.getTracks() || [];
  } catch {
    return;
  }

  tracks.forEach((track) => {
    if (
      track !== excludedTrack
      && typeof track?.stop === 'function'
      && track.readyState !== 'ended'
    ) {
      track.stop();
    }
  });
};

const safelyResetReader = (reader) => {
  try {
    reader?.reset?.();
  } catch {
    // Reset is best-effort during cancellation and cleanup.
  }
};

export const isRecoverableDecodeError = (error) => (
  RECOVERABLE_DECODE_ERROR_NAMES.has(error?.name)
);

const createSyntheticNotFoundError = () => ({
  name: 'NotFoundException',
  message: 'No barcode found in captured frame.',
});

/**
 * Build the public ZXing bitmap surface from a reusable canvas. Decoding still
 * goes through BrowserMultiFormatReader.decodeBitmap; no private reader APIs
 * are required here.
 */
export const createBinaryBitmapFromCanvas = (canvas) => {
  if (!canvas) {
    throw new Error('A capture canvas is required for barcode decoding.');
  }

  // Keep the alternating inversion behavior used by ZXing's video capture
  // path while still supplying our own reusable canvas pixels.
  const luminanceSource = new HTMLCanvasElementLuminanceSource(canvas, true);
  const hybridBinarizer = new HybridBinarizer(luminanceSource);
  return new BinaryBitmap(hybridBinarizer);
};

const getSafeMissDelay = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) return DEFAULT_MISS_DELAY_MS;
  return Math.max(1, numericValue);
};

const getIntrinsicVideoSize = (videoElement) => {
  const width = Math.floor(Number(videoElement?.videoWidth));
  const height = Math.floor(Number(videoElement?.videoHeight));

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null;
  }

  return { width, height };
};

const getCanvas = (canvasRefs, kind) => {
  if (!canvasRefs[kind] && typeof document !== 'undefined') {
    canvasRefs[kind] = document.createElement('canvas');
  }

  return canvasRefs[kind] || null;
};

const prepareCanvas = (canvasRefs, kind, width, height) => {
  const canvas = getCanvas(canvasRefs, kind);
  if (!canvas) {
    throw new Error('Canvas capture is unavailable in this environment.');
  }

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const context = canvas.getContext?.('2d');
  if (!context || typeof context.drawImage !== 'function') {
    throw new Error('A 2D canvas context is required for barcode decoding.');
  }

  return { canvas, context };
};

const captureVideoFrame = ({ videoElement, canvasRefs, kind, sourceRect }) => {
  const canvasCapture = prepareCanvas(
    canvasRefs,
    kind,
    sourceRect.width,
    sourceRect.height,
  );

  canvasCapture.context.drawImage(
    videoElement,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    0,
    0,
    sourceRect.width,
    sourceRect.height,
  );

  return canvasCapture.canvas;
};

const attachStreamToVideo = (videoElement, stream, onPlayError) => {
  // These are standard HTMLMediaElement properties and keep the existing
  // mobile autoplay/inline behavior when stream ownership is manual.
  videoElement.autoplay = true;
  videoElement.playsInline = true;
  videoElement.muted = true;
  videoElement.srcObject = stream;

  if (typeof videoElement.play !== 'function') return;

  let playPromise;
  try {
    playPromise = videoElement.play();
  } catch (error) {
    onPlayError(error);
    return;
  }

  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(onPlayError);
  }
};

const readNormalizedDecodeRegion = (decodeRegionRef) => {
  const region = decodeRegionRef?.current;

  if (!region || typeof region !== 'object') return null;

  const values = ['x', 'y', 'width', 'height'].map((key) => Number(region[key]));
  const [x, y, width, height] = values;

  if (
    values.some((value) => !Number.isFinite(value))
    || width <= 0
    || height <= 0
    || x < 0
    || y < 0
    || x + width > 1
    || y + height > 1
  ) {
    return null;
  }

  return { x, y, width, height };
};

const getHardHints = (hints) => {
  const hardHints = hints instanceof Map ? new Map(hints) : new Map();
  hardHints.set(DecodeHintType.TRY_HARDER, true);
  return hardHints;
};

export function useZxingScanner({
  paused = false,
  constraints = DEFAULT_CONSTRAINTS,
  deviceId,
  hints,
  decodeRegionRef,
  timeBetweenDecodingAttempts = DEFAULT_MISS_DELAY_MS,
  onDecodeResult = () => {},
  onDecodeError = () => {},
  onError = () => {},
} = {}) {
  const videoRef = useRef(null);
  const activeVideoElementRef = useRef(null);
  const activeStreamRef = useRef(null);
  const activeTrackRef = useRef(null);
  const sessionIdRef = useRef(0);
  const pendingTimerRef = useRef(null);
  const pipelineInFlightRef = useRef(false);
  const completeMissCountRef = useRef(0);
  const canvasRefs = useRef({ roi: null, full: null });

  const decodeResultHandlerRef = useRef(onDecodeResult);
  const decodeErrorHandlerRef = useRef(onDecodeError);
  const errorHandlerRef = useRef(onError);

  const readers = useMemo(() => {
    const normalReader = new BrowserMultiFormatReader(hints);
    const hardReader = new BrowserMultiFormatReader(getHardHints(hints));
    return { normalReader, hardReader };
  }, [hints]);

  const missDelay = useMemo(
    () => getSafeMissDelay(timeBetweenDecodingAttempts),
    [timeBetweenDecodingAttempts],
  );

  useEffect(() => {
    decodeResultHandlerRef.current = onDecodeResult;
  }, [onDecodeResult]);

  useEffect(() => {
    decodeErrorHandlerRef.current = onDecodeError;
  }, [onDecodeError]);

  useEffect(() => {
    errorHandlerRef.current = onError;
  }, [onError]);

  const stopDecoding = useCallback(() => {
    sessionIdRef.current += 1;

    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }

    pipelineInFlightRef.current = false;
    completeMissCountRef.current = 0;

    const videoElement = videoRef.current || activeVideoElementRef.current;
    const activeStream = activeStreamRef.current;
    const attachedStream = videoElement?.srcObject;
    const activeTrack = activeTrackRef.current;
    activeStreamRef.current = null;
    activeTrackRef.current = null;
    activeVideoElementRef.current = null;

    if (typeof activeTrack?.stop === 'function' && activeTrack.readyState !== 'ended') {
      activeTrack.stop();
    }

    stopStreamTracks(activeStream, activeTrack);
    if (attachedStream && attachedStream !== activeStream) {
      stopStreamTracks(attachedStream);
    }

    safelyResetReader(readers.normalReader);
    safelyResetReader(readers.hardReader);

    if (videoElement && videoElement.srcObject === attachedStream) {
      videoElement.srcObject = null;
    }
  }, [readers]);

  useEffect(() => {
    const videoElement = videoRef.current;

    if (paused || !videoElement) {
      stopDecoding();
      return undefined;
    }

    const sessionId = sessionIdRef.current + 1;
    sessionIdRef.current = sessionId;
    activeVideoElementRef.current = videoElement;
    let didCancel = false;

    completeMissCountRef.current = 0;
    pipelineInFlightRef.current = false;

    const isSessionActive = () => (
      !didCancel && sessionId === sessionIdRef.current
    );

    const scheduleNextCycle = (delay) => {
      if (!isSessionActive()) return;

      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
      }

      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        if (!isSessionActive()) return;
        void runDecodeCycle();
      }, delay);
    };

    const reportUnexpectedError = (error) => {
      if (isSessionActive()) {
        errorHandlerRef.current(error);
      }
    };

    const decodeCanvas = async (reader, canvas) => {
      const binaryBitmap = createBinaryBitmapFromCanvas(canvas);
      const result = await reader.decodeBitmap(binaryBitmap);
      return result || null;
    };

    const captureFullFrame = () => {
      const videoSize = getIntrinsicVideoSize(videoElement);
      if (!videoSize) return null;

      return captureVideoFrame({
        videoElement,
        canvasRefs: canvasRefs.current,
        kind: 'full',
        sourceRect: {
          x: 0,
          y: 0,
          width: videoSize.width,
          height: videoSize.height,
        },
      });
    };

    const captureRoiFrame = (region) => {
      const videoSize = getIntrinsicVideoSize(videoElement);
      const sourceRect = videoSize
        ? mapNormalizedRegionToSource(region, videoSize.width, videoSize.height)
        : null;

      if (!sourceRect) return null;

      return captureVideoFrame({
        videoElement,
        canvasRefs: canvasRefs.current,
        kind: 'roi',
        sourceRect,
      });
    };

    const deliverSuccess = (result) => {
      if (!isSessionActive()) return false;

      completeMissCountRef.current = 0;
      decodeResultHandlerRef.current(result);
      return true;
    };

    const deliverCompleteMiss = (error) => {
      if (!isSessionActive()) return;

      // A ROI miss is internal. Only this completed ROI+full-frame pipeline
      // miss reaches the hook's optional public callback, exactly once.
      decodeErrorHandlerRef.current(error);
    };

    const runDecodeCycle = async () => {
      if (!isSessionActive() || pipelineInFlightRef.current) return;

      pipelineInFlightRef.current = true;

      try {
        const region = readNormalizedDecodeRegion(decodeRegionRef);

        if (region) {
          if (!isSessionActive()) return;
          const roiFrame = captureRoiFrame(region);
          if (!isSessionActive()) return;

          if (roiFrame) {
            try {
              const roiResult = await decodeCanvas(readers.normalReader, roiFrame);
              if (!isSessionActive()) return;

              if (roiResult) {
                deliverSuccess(roiResult);
                scheduleNextCycle(SUCCESS_DELAY_MS);
                return;
              }
            } catch (error) {
              if (!isSessionActive()) return;

              if (!isRecoverableDecodeError(error)) {
                reportUnexpectedError(error);
                return;
              }
            }
          }
        }

        if (!isSessionActive()) return;
        const fullFrame = captureFullFrame();
        if (!isSessionActive()) return;

        // Metadata can lag stream attachment. Wait for a usable intrinsic
        // frame without exposing a camera error or creating a tight loop.
        if (!fullFrame) {
          scheduleNextCycle(missDelay);
          return;
        }

        let fullNormalError = null;
        try {
          const fullNormalResult = await decodeCanvas(readers.normalReader, fullFrame);
          if (!isSessionActive()) return;

          if (fullNormalResult) {
            deliverSuccess(fullNormalResult);
            scheduleNextCycle(SUCCESS_DELAY_MS);
            return;
          }

          fullNormalError = createSyntheticNotFoundError();
        } catch (error) {
          if (!isSessionActive()) return;

          if (!isRecoverableDecodeError(error)) {
            reportUnexpectedError(error);
            return;
          }

          fullNormalError = error;
        }

        completeMissCountRef.current += 1;
        const shouldTryHarder = (
          completeMissCountRef.current >= TRY_HARDER_AFTER_COMPLETE_MISSES
        );

        if (!shouldTryHarder) {
          deliverCompleteMiss(fullNormalError);
          scheduleNextCycle(missDelay);
          return;
        }

        // The full-frame canvas is intentionally reused for the sparse hard
        // pass. No second capture occurs in this cycle.
        let hardError = null;
        try {
          const hardResult = await decodeCanvas(readers.hardReader, fullFrame);
          if (!isSessionActive()) return;

          // The threshold window ends regardless of hard success or miss.
          completeMissCountRef.current = 0;

          if (hardResult) {
            deliverSuccess(hardResult);
            scheduleNextCycle(SUCCESS_DELAY_MS);
            return;
          }

          hardError = createSyntheticNotFoundError();
        } catch (error) {
          if (!isSessionActive()) return;

          completeMissCountRef.current = 0;
          if (!isRecoverableDecodeError(error)) {
            reportUnexpectedError(error);
            return;
          }

          hardError = error;
        }

        deliverCompleteMiss(hardError || fullNormalError);
        scheduleNextCycle(missDelay);
      } catch (error) {
        reportUnexpectedError(error);
      } finally {
        pipelineInFlightRef.current = false;
      }
    };

    const startDecoding = async () => {
      try {
        const cameraConstraints = deviceId
          ? {
            video: { deviceId: { exact: deviceId } },
            audio: false,
          }
          : constraints || DEFAULT_CONSTRAINTS;
        const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints);

        if (!isSessionActive()) {
          stopStreamTracks(stream);
          return;
        }

        activeStreamRef.current = stream;
        const activeTrack = getActiveVideoTrackFromStream(stream);
        if (activeTrack) {
          activeTrackRef.current = activeTrack;
          await applyContinuousAutofocus(activeTrack);
        }

        if (
          !isSessionActive()
          || activeTrackRef.current !== activeTrack
          || activeTrack?.readyState === 'ended'
        ) {
          stopDecoding();
          return;
        }

        attachStreamToVideo(videoElement, stream, (error) => {
          reportUnexpectedError(error);
        });

        if (!isSessionActive()) return;

        // Initial work is deferred to the event loop; subsequent work always
        // uses the bounded success/miss cadence above.
        scheduleNextCycle(1);
      } catch (error) {
        if (isSessionActive()) {
          errorHandlerRef.current(error);
        }
      }
    };

    void startDecoding();

    return () => {
      didCancel = true;
      stopDecoding();
    };
  }, [
    constraints,
    decodeRegionRef,
    deviceId,
    missDelay,
    paused,
    readers,
    stopDecoding,
  ]);

  useEffect(() => () => {
    stopDecoding();
  }, [stopDecoding]);

  return {
    ref: videoRef,
  };
}
