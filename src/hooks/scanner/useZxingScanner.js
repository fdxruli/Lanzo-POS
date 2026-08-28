import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  BinaryBitmap,
  BrowserMultiFormatReader,
  ChecksumException,
  DecodeHintType,
  FormatException,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
  NotFoundException,
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

const RECOVERABLE_DECODE_ERROR_TYPES = [
  NotFoundException,
  ChecksumException,
  FormatException,
];

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

export const isRecoverableDecodeError = (error) => {
  if (RECOVERABLE_DECODE_ERROR_TYPES.some((ErrorType) => error instanceof ErrorType)) {
    return true;
  }

  let kind = null;
  try {
    kind = error?.getKind?.() ?? null;
  } catch {
    kind = null;
  }

  return RECOVERABLE_DECODE_ERROR_TYPES.some((ErrorType) => kind === ErrorType.kind);
};

const createSyntheticNotFoundError = () => NotFoundException.getNotFoundInstance();

/**
 * Build the public ZXing bitmap surface from a reusable canvas. Decoding still
 * goes through BrowserMultiFormatReader.decodeBitmap; no private reader APIs
 * are required here.
 */
export const createBinaryBitmapFromCanvas = (canvas) => {
  if (!canvas) {
    throw new Error('A capture canvas is required for barcode decoding.');
  }

  // Lanzo owns multiple decode passes per logical frame. Use deterministic
  // normal-polarity luminance for each pass instead of ZXing's static global
  // auto-invert frame parity.
  const luminanceSource = new HTMLCanvasElementLuminanceSource(canvas, false);
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

const attachStreamToVideo = async (videoElement, stream) => {
  // These are standard HTMLMediaElement properties and keep the existing
  // mobile autoplay/inline behavior when stream ownership is manual.
  videoElement.autoplay = true;
  videoElement.playsInline = true;
  videoElement.muted = true;
  videoElement.srcObject = stream;

  if (typeof videoElement.play !== 'function') return;

  await videoElement.play();
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
  const activeSessionRef = useRef(null);
  const sessionIdRef = useRef(0);

  const decodeResultHandlerRef = useRef(onDecodeResult);
  const decodeErrorHandlerRef = useRef(onDecodeError);
  const errorHandlerRef = useRef(onError);

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

  const cleanupSession = useCallback((session) => {
    if (!session || session.cancelled) return;

    session.cancelled = true;

    if (session.timer !== null) {
      clearTimeout(session.timer);
      session.timer = null;
    }

    session.pipelineInFlight = false;
    session.completeMissCount = 0;

    const {
      videoElement,
      stream,
      track,
      trackEndedHandler,
      readers,
    } = session;

    if (
      track
      && trackEndedHandler
      && typeof track.removeEventListener === 'function'
    ) {
      track.removeEventListener('ended', trackEndedHandler);
    }
    session.trackEndedHandler = null;

    if (typeof track?.stop === 'function' && track.readyState !== 'ended') {
      track.stop();
    }

    stopStreamTracks(stream, track);

    safelyResetReader(readers?.normalReader);
    safelyResetReader(readers?.hardReader);

    if (videoElement && videoElement.srcObject === stream) {
      videoElement.srcObject = null;
    }

    if (activeSessionRef.current === session) {
      activeSessionRef.current = null;
    }
  }, []);

  const stopDecoding = useCallback(() => {
    const session = activeSessionRef.current;
    cleanupSession(session);
  }, [cleanupSession]);

  useEffect(() => {
    const videoElement = videoRef.current;

    if (paused || !videoElement) {
      stopDecoding();
      return undefined;
    }

    const session = {
      id: sessionIdRef.current + 1,
      cancelled: false,
      videoElement,
      stream: null,
      track: null,
      trackEndedHandler: null,
      timer: null,
      pipelineInFlight: false,
      completeMissCount: 0,
      readers: {
        normalReader: new BrowserMultiFormatReader(hints),
        hardReader: new BrowserMultiFormatReader(getHardHints(hints)),
      },
      canvasRefs: { roi: null, full: null },
      errorReported: false,
    };
    sessionIdRef.current = session.id;

    const previousSession = activeSessionRef.current;
    activeSessionRef.current = session;
    if (previousSession && previousSession !== session) {
      cleanupSession(previousSession);
    }

    const isSessionActive = (candidateSession = session) => (
      !candidateSession.cancelled
      && activeSessionRef.current === candidateSession
      && sessionIdRef.current === candidateSession.id
    );

    const reportUnexpectedError = (error) => {
      if (!isSessionActive() || session.errorReported) return false;

      session.errorReported = true;
      errorHandlerRef.current(error);
      return true;
    };

    const handleSessionFailure = (error) => {
      if (!isSessionActive()) return false;

      reportUnexpectedError(error);
      cleanupSession(session);
      return false;
    };

    const ensureSessionCanContinue = ({ requireAttachedStream = false } = {}) => {
      if (!isSessionActive()) return false;

      if (session.track?.readyState === 'ended') {
        return handleSessionFailure(new Error('Camera video track ended unexpectedly.'));
      }

      if (
        requireAttachedStream
        && session.stream
        && videoElement.srcObject !== session.stream
      ) {
        return handleSessionFailure(new Error('Camera video stream was detached unexpectedly.'));
      }

      return true;
    };

    const handleTrackEnded = () => {
      if (!isSessionActive()) return;

      handleSessionFailure(new Error('Camera video track ended unexpectedly.'));
    };

    const scheduleNextCycle = (delay) => {
      if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;

      if (session.timer !== null) {
        clearTimeout(session.timer);
      }

      session.timer = setTimeout(() => {
        session.timer = null;
        if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;
        void runDecodeCycle();
      }, delay);
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
        canvasRefs: session.canvasRefs,
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
        canvasRefs: session.canvasRefs,
        kind: 'roi',
        sourceRect,
      });
    };

    const deliverSuccess = (result) => {
      if (!ensureSessionCanContinue({ requireAttachedStream: true })) return false;

      session.completeMissCount = 0;
      decodeResultHandlerRef.current(result);
      return true;
    };

    const deliverCompleteMiss = (error) => {
      if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;

      // A ROI miss is internal. Only this completed ROI+full-frame pipeline
      // miss reaches the hook's optional public callback, exactly once.
      decodeErrorHandlerRef.current(error);
    };

    const runDecodeCycle = async () => {
      if (
        !ensureSessionCanContinue({ requireAttachedStream: true })
        || session.pipelineInFlight
      ) return;

      session.pipelineInFlight = true;

      try {
        const region = readNormalizedDecodeRegion(decodeRegionRef);

        if (region) {
          if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;
          const roiFrame = captureRoiFrame(region);
          if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;

          if (roiFrame) {
            try {
              const roiResult = await decodeCanvas(
                session.readers.normalReader,
                roiFrame,
              );
              if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;

              if (roiResult) {
                deliverSuccess(roiResult);
                scheduleNextCycle(SUCCESS_DELAY_MS);
                return;
              }
            } catch (error) {
              if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;

              if (!isRecoverableDecodeError(error)) {
                reportUnexpectedError(error);
                return;
              }
            }
          }
        }

        if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;
        const fullFrame = captureFullFrame();
        if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;

        // Metadata can lag stream attachment. Wait for a usable intrinsic
        // frame without exposing a camera error or creating a tight loop.
        if (!fullFrame) {
          scheduleNextCycle(missDelay);
          return;
        }

        let fullNormalError = null;
        try {
          const fullNormalResult = await decodeCanvas(
            session.readers.normalReader,
            fullFrame,
          );
          if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;

          if (fullNormalResult) {
            deliverSuccess(fullNormalResult);
            scheduleNextCycle(SUCCESS_DELAY_MS);
            return;
          }

          fullNormalError = createSyntheticNotFoundError();
        } catch (error) {
          if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;

          if (!isRecoverableDecodeError(error)) {
            reportUnexpectedError(error);
            return;
          }

          fullNormalError = error;
        }

        session.completeMissCount += 1;
        const shouldTryHarder = (
          session.completeMissCount >= TRY_HARDER_AFTER_COMPLETE_MISSES
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
          const hardResult = await decodeCanvas(
            session.readers.hardReader,
            fullFrame,
          );
          if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;

          // The threshold window ends regardless of hard success or miss.
          session.completeMissCount = 0;

          if (hardResult) {
            deliverSuccess(hardResult);
            scheduleNextCycle(SUCCESS_DELAY_MS);
            return;
          }

          hardError = createSyntheticNotFoundError();
        } catch (error) {
          if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;

          session.completeMissCount = 0;
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
        session.pipelineInFlight = false;
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

        session.stream = stream;
        session.track = getActiveVideoTrackFromStream(stream);

        if (session.track && typeof session.track.addEventListener === 'function') {
          session.track.addEventListener('ended', handleTrackEnded);
          session.trackEndedHandler = handleTrackEnded;
        }

        if (session.track) {
          await applyContinuousAutofocus(session.track);
        }

        if (!ensureSessionCanContinue()) return;

        await attachStreamToVideo(videoElement, stream);

        if (!ensureSessionCanContinue({ requireAttachedStream: true })) return;

        // Initial work is deferred to the event loop; subsequent work always
        // uses the bounded success/miss cadence above.
        scheduleNextCycle(1);
      } catch (error) {
        if (isSessionActive()) {
          reportUnexpectedError(error);
        }
        cleanupSession(session);
      }
    };

    void startDecoding();

    return () => {
      cleanupSession(session);
    };
  }, [
    constraints,
    decodeRegionRef,
    deviceId,
    hints,
    missDelay,
    paused,
    cleanupSession,
    stopDecoding,
  ]);

  useEffect(() => () => {
    stopDecoding();
  }, [stopDecoding]);

  return {
    ref: videoRef,
  };
}
