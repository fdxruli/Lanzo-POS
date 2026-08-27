import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BrowserMultiFormatReader } from '@zxing/library';

const DEFAULT_CONSTRAINTS = {
  video: {
    facingMode: 'environment',
  },
  audio: false,
};

const CONTINUOUS_FOCUS_MODE = 'continuous';

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

const stopStreamTracks = (stream) => {
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
    if (typeof track?.stop === 'function' && track.readyState !== 'ended') {
      track.stop();
    }
  });
};

export function useZxingScanner({
  paused = false,
  constraints = DEFAULT_CONSTRAINTS,
  deviceId,
  hints,
  timeBetweenDecodingAttempts = 500,
  onDecodeResult = () => {},
  onDecodeError = () => {},
  onError = () => {},
} = {}) {
  const videoRef = useRef(null);
  const activeStreamRef = useRef(null);
  const activeTrackRef = useRef(null);
  const sessionIdRef = useRef(0);
  const decodeResultHandlerRef = useRef(onDecodeResult);
  const decodeErrorHandlerRef = useRef(onDecodeError);
  const errorHandlerRef = useRef(onError);

  const reader = useMemo(() => {
    const nextReader = new BrowserMultiFormatReader(hints);
    nextReader.timeBetweenDecodingAttempts = timeBetweenDecodingAttempts;
    return nextReader;
  }, [hints, timeBetweenDecodingAttempts]);

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

    const videoElement = videoRef.current;
    const activeStream = activeStreamRef.current;
    const attachedStream = videoElement?.srcObject;
    const activeTrack = activeTrackRef.current;
    activeStreamRef.current = null;
    activeTrackRef.current = null;

    if (typeof activeTrack?.stop === 'function' && activeTrack.readyState !== 'ended') {
      activeTrack.stop();
    }

    stopStreamTracks(activeStream);
    if (attachedStream && attachedStream !== activeStream) {
      stopStreamTracks(attachedStream);
    }
    reader.reset();

    if (videoElement && videoElement.srcObject === attachedStream) {
      videoElement.srcObject = null;
    }
  }, [reader]);

  useEffect(() => {
    const videoElement = videoRef.current;
    let didCancel = false;
    const sessionId = sessionIdRef.current + 1;
    sessionIdRef.current = sessionId;

    if (paused || !videoElement) {
      stopDecoding();
      return undefined;
    }

    const handleDecode = (result, error) => {
      if (didCancel || sessionId !== sessionIdRef.current) return;

      if (result) {
        decodeResultHandlerRef.current(result);
      }

      if (error) {
        decodeErrorHandlerRef.current(error);
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
        activeStreamRef.current = stream;

        if (didCancel || sessionId !== sessionIdRef.current) {
          stopDecoding();
          return;
        }

        const activeTrack = getActiveVideoTrackFromStream(stream);
        if (activeTrack) {
          activeTrackRef.current = activeTrack;
          await applyContinuousAutofocus(activeTrack);
        }

        if (
          didCancel
          || sessionId !== sessionIdRef.current
          || activeTrackRef.current !== activeTrack
          || activeTrack.readyState === 'ended'
        ) {
          stopDecoding();
          return;
        }

        const decodingPromise = reader.decodeFromStream(stream, videoElement, handleDecode);
        if (decodingPromise && typeof decodingPromise.catch === 'function') {
          decodingPromise.catch((error) => {
            if (!didCancel && sessionId === sessionIdRef.current) {
              errorHandlerRef.current(error);
            }
          });
        }
      } catch (error) {
        if (!didCancel && sessionId === sessionIdRef.current) {
          errorHandlerRef.current(error);
        }
      }
    };

    startDecoding();

    return () => {
      didCancel = true;
      stopDecoding();
    };
  }, [constraints, deviceId, paused, reader, stopDecoding]);

  useEffect(() => () => {
    stopDecoding();
  }, [stopDecoding]);

  return {
    ref: videoRef,
  };
}
