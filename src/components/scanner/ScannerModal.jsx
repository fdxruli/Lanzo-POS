// src/components/scanner/ScannerModal.jsx
import { useCallback, useEffect, useState, useRef } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { resolveWithCache } from '../../services/barcodeCache';
import { playBeep, playErrorBeep } from '../../services/audioBeep';
import Logger from '../../services/Logger';
import { useScannerCart } from '../../hooks/scanner/useScannerCart';
import { useZxing } from 'react-zxing';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { CameraViewport } from './CameraViewport';
import { ScannerCartList } from './ScannerCartList';
import { UnknownCodesBanner } from './UnknownCodesBanner';
import './ScannerModal.css';

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

export default function ScannerModal({ show, onClose, onScanSuccess }) {
  const addMultipleScannedProducts = useOrderStore(
    (state) => state.addMultipleScannedProducts
  );

  const {
    items,
    unknownCodes,
    total,
    itemCount,
    isConfirming,
    setIsConfirming,
    addItem,
    addQuantity,
    removeQuantity,
    addUnknownCode,
    clearUnknownCodes,
    clearCart,
  } = useScannerCart();

  const [scanFeedback, setScanFeedback] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [scanCount, setScanCount] = useState(0);

  const mode = onScanSuccess ? 'single' : 'pos';
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

    pauseTimeoutRef.current = setTimeout(() => {
      processingRef.current = false;
      setIsScanning(true);
    }, REACTIVATION_DELAY_MS);
  }, [clearAllTimeouts]);

  const handleClose = useCallback(() => {
    clearAllTimeouts();
    clearCart();
    setScanFeedback('');
    setIsScanning(false);
    setCameraError(null);
    setScanCount(0);
    onClose();
  }, [clearAllTimeouts, clearCart, onClose]);

  const processScannedCode = useCallback(
    async (code) => {
      try {
        setScanFeedback(`Buscando: ${code}...`);
        setIsScanning(false);

        const product = await resolveWithCache(code);

        if (!product) {
          playErrorBeep();
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

          addUnknownCode(code);
          setScanFeedback(`Falló: ${code}`);
          scheduleReactivation();
          return;
        }

        addItem(product);
        setScanFeedback(`OK ${product.name} - $${product.price.toFixed(2)}`);
        scheduleReactivation();
      } catch (error) {
        Logger.error('Error procesando codigo escaneado:', error);
        playErrorBeep();
        setScanFeedback('Error de base de datos');
        scheduleReactivation();
      }
    },
    [addItem, addUnknownCode, scheduleReactivation]
  );

  const handleDecodeResult = useCallback(
    (result) => {
      const code = result.getText();

      if (processingRef.current || isConfirming) {
        return;
      }

      processingRef.current = true;
      setScanCount((count) => count + 1);

      if (mode === 'single' && onScanSuccess) {
        playBeep(1200, 'sine');
        if (navigator.vibrate) navigator.vibrate(50);
        onScanSuccess(code);
        handleClose();
        return;
      }

      playBeep(1000, 'sine');
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
      processScannedCode(code);
    },
    [isConfirming, mode, onScanSuccess, processScannedCode, handleClose]
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
    paused: !show || !isScanning || isConfirming,
    onDecodeResult: handleDecodeResult,
    onError: handleError,
    constraints: CAMERA_CONSTRAINTS,
    hints: SCAN_HINTS,
    timeBetweenDecodingAttempts: 150,
  });

  const handleRetryCamera = useCallback(() => {
    setCameraError(null);
    processingRef.current = false;
    setIsScanning(true);
  }, []);

  const handleConfirmScan = useCallback(async () => {
    if (mode !== 'pos' || items.length === 0 || isConfirming) {
      return;
    }

    setIsConfirming(true);
    setIsScanning(false);
    clearAllTimeouts();

    try {
      // Convert grouped items to flat array for the store
      const flatItems = items.flatMap((item) =>
        Array.from({ length: item.quantity }, () => ({
          ...item,
          quantity: 1,
          uniqueLineId: `${item.uniqueLineId || item.id}-${Math.random().toString(36).slice(2, 8)}`,
        }))
      );

      const result = addMultipleScannedProducts(flatItems);

      if (!result?.success || result.failedCount > 0) {
        playErrorBeep();
        Logger.warn('Confirmacion parcial del carrito temporal del escaner.', {
          addedCount: result?.addedCount || 0,
          incrementedCount: result?.incrementedCount || 0,
          failedCount: result?.failedCount || 0,
        });
      }

      if (!result?.success) {
        setScanFeedback('No se pudo confirmar el escaneo');
        setIsConfirming(false);
        setIsScanning(true);
        return;
      }

      handleClose();
    } catch (error) {
      Logger.error('Error confirmando carrito temporal del escaner:', error);
      playErrorBeep();
      setScanFeedback('No se pudo confirmar el escaneo');
      setIsConfirming(false);
      setIsScanning(true);
    }
  }, [
    addMultipleScannedProducts,
    clearAllTimeouts,
    handleClose,
    isConfirming,
    items,
    mode,
    setIsConfirming,
  ]);

  // Reset feedback after scan
  useEffect(() => {
    if (scanFeedback && !isConfirming) {
      const timeout = setTimeout(() => {
        setScanFeedback('');
        if (!processingRef.current) {
          setIsScanning(true);
        }
      }, 800);
      return () => clearTimeout(timeout);
    }
  }, [scanFeedback, isConfirming]);

  // Initialize when modal opens
  useEffect(() => {
    if (show) {
      clearCart();
      setScanFeedback('');
      setIsScanning(true);
      setIsConfirming(false);
      setCameraError(null);
      setScanCount(0);
      processingRef.current = false;
    }

    return () => {
      clearAllTimeouts();
    };
  }, [show, clearCart, clearAllTimeouts, setIsConfirming]);

  if (!show) {
    return null;
  }

  return (
    <div id="scanner-modal" className="modal" style={{ display: 'flex' }}>
      <div
        className={`modal-content scanner-modal-content ${
          mode === 'pos' ? 'pos-scan-mode' : 'simple-scan-mode'
        }`}
      >
        <h2 className="modal-title">
          Escanear Codigos{scanCount > 0 ? ` (${scanCount})` : ''}
        </h2>

        <div className="scanner-main-container">
          <div className="scanner-video-container">
            <CameraViewport
              videoRef={videoRef}
              cameraError={cameraError}
              scanFeedback={scanFeedback}
              isScanning={isScanning}
              isConfirming={isConfirming}
              onRetryCamera={handleRetryCamera}
            />
          </div>

          {mode === 'pos' && (
            <div className="scanner-results-container">
              <h3 className="subtitle">Carrito Temporal</h3>
              <UnknownCodesBanner
                unknownCodes={unknownCodes}
                onClear={clearUnknownCodes}
              />
              <ScannerCartList
                items={items}
                total={total}
                isConfirming={isConfirming}
                onAddQuantity={addQuantity}
                onRemoveQuantity={removeQuantity}
              />
            </div>
          )}
        </div>

        <div className="scanner-actions">
          {mode === 'pos' && (
            <button
              className="btn btn-process"
              onClick={handleConfirmScan}
              disabled={items.length === 0 || isConfirming}
            >
              {isConfirming
                ? 'Confirmando...'
                : `Confirmar (${itemCount})`}
            </button>
          )}
          <button
            className="btn btn-cancel"
            onClick={handleClose}
            disabled={isConfirming}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
