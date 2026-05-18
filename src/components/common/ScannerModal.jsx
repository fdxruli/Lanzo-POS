import { useState, useEffect, useRef, useCallback } from 'react';
import { useZxing } from 'react-zxing';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import {
  useOrderStore,
  summarizeScannedProducts,
} from '../../store/useOrderStore';
import { resolveWithCache } from '../../services/barcodeCache';
import { playBeep, playErrorBeep } from '../../services/audioBeep';
import './ScannerModal.css';
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

const buildScanLineId = (product) =>
  `${product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function ScannerModal({ show, onClose, onScanSuccess }) {
  const addMultipleScannedProducts = useOrderStore(
    (state) => state.addMultipleScannedProducts
  );

  const [scannedItems, setScannedItems] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [scanFeedback, setScanFeedback] = useState('');
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

  const resetModalState = useCallback(() => {
    clearAllTimeouts();
    setScannedItems([]);
    setIsScanning(false);
    setIsConfirming(false);
    setCameraError(null);
    setScanFeedback('');
    setScanCount(0);
    processingRef.current = false;
  }, [clearAllTimeouts]);

  const scheduleReactivation = useCallback(() => {
    clearAllTimeouts();

    feedbackTimeoutRef.current = setTimeout(() => {
      setScanFeedback('');
    }, FEEDBACK_RESET_MS);

    pauseTimeoutRef.current = setTimeout(() => {
      processingRef.current = false;
      setIsScanning(true);
    }, REACTIVATION_DELAY_MS);
  }, [clearAllTimeouts]);

  const handleClose = useCallback(() => {
    resetModalState();
    onClose();
  }, [onClose, resetModalState]);

  const processScannedCode = useCallback(
    async (code) => {
      try {
        setScanFeedback(`Buscando: ${code}...`);

        const product = await resolveWithCache(code);

        if (!product) {
          playErrorBeep();
          setScanFeedback(`No encontrado: ${code}`);
          return;
        }

        setScannedItems((prevItems) => [
          ...prevItems,
          {
            ...product,
            quantity: 1,
            uniqueLineId: buildScanLineId(product),
          },
        ]);
        setScanFeedback(`OK ${product.name} - $${product.price.toFixed(2)}`);
      } catch (error) {
        Logger.error('Error procesando codigo escaneado:', error);
        playErrorBeep();
        setScanFeedback('Error de base de datos');
      } finally {
        scheduleReactivation();
      }
    },
    [scheduleReactivation]
  );

  const handleConfirmScan = useCallback(async () => {
    if (mode !== 'pos' || scannedItems.length === 0 || isConfirming) {
      return;
    }

    setIsConfirming(true);
    setIsScanning(false);
    clearAllTimeouts();
    processingRef.current = true;

    try {
      const result = addMultipleScannedProducts(scannedItems);

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
        processingRef.current = false;
        setIsConfirming(false);
        setIsScanning(true);
        return;
      }

      handleClose();
    } catch (error) {
      Logger.error('Error confirmando carrito temporal del escaner:', error);
      playErrorBeep();
      setScanFeedback('No se pudo confirmar el escaneo');
      processingRef.current = false;
      setIsConfirming(false);
      setIsScanning(true);
    }
  }, [
    addMultipleScannedProducts,
    clearAllTimeouts,
    handleClose,
    isConfirming,
    mode,
    scannedItems,
  ]);

  const { ref: videoRef } = useZxing({
    paused: !show || !isScanning || isConfirming,
    onDecodeResult(result) {
      const code = result.getText();

      if (processingRef.current || isConfirming) {
        return;
      }

      processingRef.current = true;
      setIsScanning(false);
      setScanCount((count) => count + 1);

      if (onScanSuccess) {
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
    onError(error) {
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
    },
    constraints: CAMERA_CONSTRAINTS,
    hints: SCAN_HINTS,
    timeBetweenDecodingAttempts: 150,
  });

  useEffect(() => {
    if (show) {
      setScannedItems([]);
      setIsScanning(true);
      setIsConfirming(false);
      setCameraError(null);
      setScanFeedback('');
      setScanCount(0);
      processingRef.current = false;
      return () => {
        clearAllTimeouts();
      };
    }

    resetModalState();

    return () => {
      clearAllTimeouts();
    };
  }, [show, clearAllTimeouts, resetModalState]);

  const groupedScannedItems = summarizeScannedProducts(scannedItems);
  const totalScaneado = groupedScannedItems.reduce(
    (total, item) => total + item.price * item.quantity,
    0
  );

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
            {cameraError ? (
              <div className="camera-error-feedback">
                <p>{cameraError}</p>
                <button
                  onClick={() => {
                    setCameraError(null);
                    setIsScanning(true);
                    processingRef.current = false;
                  }}
                  className="btn btn-secondary"
                  disabled={isConfirming}
                >
                  Reintentar
                </button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  id="scanner-video"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transform: 'translateZ(0)',
                    backfaceVisibility: 'hidden',
                    filter: isScanning ? 'none' : 'brightness(0.5) blur(2px)',
                    transition: 'filter 0.3s ease',
                  }}
                />

                {scanFeedback && (
                  <div className="scan-feedback-overlay">
                    <div className="scan-feedback-message">{scanFeedback}</div>
                  </div>
                )}

                <div
                  className="scanner-reticle"
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '70%',
                    height: '40%',
                    border: '3px solid rgba(0, 255, 0, 0.5)',
                    borderRadius: '12px',
                    pointerEvents: 'none',
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.3)',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '-30px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      color: 'white',
                      fontSize: '0.9rem',
                      textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isConfirming
                      ? 'Guardando carrito temporal...'
                      : isScanning
                        ? 'Centra el codigo aqui'
                        : 'Procesando...'}
                  </div>
                </div>
              </>
            )}
          </div>

          {mode === 'pos' && (
            <div className="scanner-results-container">
              <h3 className="subtitle">Carrito Temporal</h3>
              <div className="scanned-items-list">
                {groupedScannedItems.length === 0 ? (
                  <p className="empty-message" style={{ padding: '2rem 0' }}>
                    Escanea tu primer producto
                  </p>
                ) : (
                  groupedScannedItems.map((item, index) => (
                    <div
                      key={item.uniqueLineId || `${item.id}-${item.batchId ?? index}`}
                      className="scanned-item"
                    >
                      <span
                        className="scanned-item-name"
                        style={{
                          flex: 1,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.name}
                      </span>
                      <span
                        className="scanned-item-controls"
                        style={{ margin: '0 10px', fontWeight: 'bold' }}
                      >
                        x{item.quantity}
                      </span>
                      <span className="scanned-item-price">
                        ${(item.price * item.quantity).toFixed(2)}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className="scanner-total-container">
                <span>Total:</span>
                <span>${totalScaneado.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="scanner-actions">
          {mode === 'pos' && (
            <button
              className="btn btn-process"
              onClick={handleConfirmScan}
              disabled={scannedItems.length === 0 || isConfirming}
            >
              {isConfirming
                ? 'Confirmando...'
                : `Confirmar (${scannedItems.length})`}
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
