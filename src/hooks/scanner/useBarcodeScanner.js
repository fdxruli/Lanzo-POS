// src/hooks/scanner/useBarcodeScanner.js
import { useRef, useCallback, useEffect, useState } from 'react';
import { useZxing } from 'react-zxing';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { playBeep, playErrorBeep } from '../../services/audioBeep';
import Logger from '../../services/Logger';

const CAMERA_CONSTRAINTS = {
  video: {
    facingMode: 'environment',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
};

const SCAN_HINTS = new Map([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.CODE_128,
      BarcodeFormat.QR_CODE,
    ],
  ],
]);

const REACTIVATION_DELAY_MS = 500;
const FEEDBACK_RESET_MS = 800;

export function useBarcodeScanner({ isActive, isConfirming, onValidCode, mode, onSingleScan }) {
  const [scanCount, setScanCount] = useState(0);
  const [cameraError, setCameraError] = useState(null);
  const processingRef = useRef(false);
  const pauseTimeoutRef = useRef(null);
  const feedbackTimeoutRef = useRef(null);

  const clearAllTimeouts = useCallback(() => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
      pauseTimeoutRef.current = null;
    }
  }, []);

  const scheduleReactivation = useCallback(() => {
    clearAllTimeouts();

    feedbackTimeoutRef.current = setTimeout(() => {
      // Feedback reset handled externally
    }, FEEDBACK_RESET_MS);

    pauseTimeoutRef.current = setTimeout(() => {
      processingRef.current = false;
    }, REACTIVATION_DELAY_MS);
  }, [clearAllTimeouts]);

  const handleDecode = useCallback(
    (result) => {
      const code = result.getText();

      if (processingRef.current || isConfirming) {
        return;
      }

      processingRef.current = true;
      setScanCount((prev) => prev + 1);

      // Single scan mode (for lookups)
      if (mode === 'single' && onSingleScan) {
        playBeep(1200, 'sine');
        if (navigator.vibrate) navigator.vibrate(50);
        onSingleScan(code);
        return;
      }

      // POS mode - emit valid code for processing
      playBeep(1000, 'sine');
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
      onValidCode(code);
    },
    [isConfirming, mode, onSingleScan, onValidCode]
  );

  const handleError = useCallback((error) => {
    if (error.name === 'NotFoundException') {
      return;
    }

    if (error.name === 'NotAllowedError') {
      setCameraError('Permiso de camara denegado.');
      return;
    }

    if (error.name === 'NotFoundError') {
      setCameraError('No se encontro camara en este dispositivo.');
      return;
    }

    Logger.warn('Advertencia ZXing:', error.message);
  }, []);

  const { ref: videoRef } = useZxing({
    paused: !isActive || isConfirming,
    onDecodeResult: handleDecode,
    onError: handleError,
    constraints: CAMERA_CONSTRAINTS,
    hints: SCAN_HINTS,
    timeBetweenDecodingAttempts: 150,
  });

  const retryCamera = useCallback(() => {
    setCameraError(null);
    processingRef.current = false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAllTimeouts();
    };
  }, [clearAllTimeouts]);

  // Reset processing when activated
  useEffect(() => {
    if (isActive) {
      processingRef.current = false;
    }
  }, [isActive]);

  return {
    videoRef,
    scanCount,
    cameraError,
    scheduleReactivation,
    clearAllTimeouts,
    retryCamera,
    playSuccessBeep: () => playBeep(1000, 'sine'),
    playErrorBeep,
  };
}
