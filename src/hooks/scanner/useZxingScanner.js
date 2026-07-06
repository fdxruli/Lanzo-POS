import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BrowserMultiFormatReader } from '@zxing/library';

const DEFAULT_CONSTRAINTS = {
  video: {
    facingMode: 'environment',
  },
  audio: false,
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
    reader.reset();
  }, [reader]);

  useEffect(() => {
    const videoElement = videoRef.current;
    let didCancel = false;

    if (paused || !videoElement) {
      stopDecoding();
      return undefined;
    }

    const handleDecode = (result, error) => {
      if (didCancel) return;

      if (result) {
        decodeResultHandlerRef.current(result);
      }

      if (error) {
        decodeErrorHandlerRef.current(error);
      }
    };

    const startDecoding = async () => {
      try {
        if (deviceId) {
          await reader.decodeFromVideoDevice(deviceId, videoElement, handleDecode);
          return;
        }

        await reader.decodeFromConstraints(
          constraints || DEFAULT_CONSTRAINTS,
          videoElement,
          handleDecode
        );
      } catch (error) {
        if (!didCancel) {
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
