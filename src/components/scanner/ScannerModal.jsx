// src/components/scanner/ScannerModal.jsx
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { resolveWithCache } from '../../services/barcodeCache';
import { playBeep, playErrorBeep } from '../../services/audioBeep';
import Logger from '../../services/Logger';
import { useScannerCart } from '../../hooks/scanner/useScannerCart';
import { useZxingScanner } from '../../hooks/scanner/useZxingScanner';
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
const FEEDBACK_CLEAR_DELAY_MS = 800;

/**
 * Icono X (cerrar) SVG
 */
const CloseIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/**
 * Componente de Feedback Memoizado
 * Aísla las actualizaciones de feedback para evitar re-renders del modal completo
 */
export default function ScannerModal({ show, onClose, onScanSuccess }) {
  if (!show) {
    return null;
  }

  return (
    <ScannerModalContent
      show={show}
      onClose={onClose}
      onScanSuccess={onScanSuccess}
    />
  );
}

function ScannerModalContent({ show, onClose, onScanSuccess }) {
  const addMultipleScannedProducts = useActiveOrders(
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
  const [cameraError, setCameraError] = useState(null);
  const [scanCount, setScanCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const mode = onScanSuccess ? 'single' : 'pos';

  // Refs para control de flujo sin causar re-renders
  const processingLockRef = useRef(false);
  const pauseTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);

  // Cleanup al desmontar
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
        pauseTimeoutRef.current = null;
      }
    };
  }, []);

  const clearFeedback = useCallback(() => {
    if (isMountedRef.current) {
      setScanFeedback('');
    }
  }, []);

  // El feedback ya se muestra dentro del viewport; aqui solo controlamos su expiracion.
  useEffect(() => {
    if (!scanFeedback) {
      return undefined;
    }

    const timer = setTimeout(() => {
      clearFeedback();
    }, FEEDBACK_CLEAR_DELAY_MS);

    return () => clearTimeout(timer);
  }, [clearFeedback, scanFeedback]);

  // Reactivar escaneo lógico después del delay (sin pausar video)
  const scheduleReactivation = useCallback(() => {
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
    }

    pauseTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        processingLockRef.current = false;
        setIsProcessing(false);
      }
      pauseTimeoutRef.current = null;
    }, REACTIVATION_DELAY_MS);
  }, []);

  // Cerrar modal - limpieza completa
  const handleClose = useCallback(() => {
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
      pauseTimeoutRef.current = null;
    }

    processingLockRef.current = false;
    setIsProcessing(false);
    clearCart();
    setScanFeedback('');
    setCameraError(null);
    setScanCount(0);
    onClose();
  }, [clearCart, onClose]);

  // Procesar código escaneado con protección contra race conditions
  const processScannedCode = useCallback(
    async (code) => {
      if (!isMountedRef.current) return;

      setScanFeedback(`Buscando: ${code}...`);

      try {
        const product = await resolveWithCache(code);

        // Verificar si el componente sigue montado antes de actualizar estado
        if (!isMountedRef.current) return;

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
        if (!isMountedRef.current) return;

        Logger.error('Error procesando codigo escaneado:', error);
        playErrorBeep();
        setScanFeedback('Error de base de datos');
        scheduleReactivation();
      }
    },
    [addItem, addUnknownCode, scheduleReactivation]
  );

  // Handler de decodificación con bloqueo lógico estricto
  const handleDecodeResult = useCallback(
    (result) => {
      // Bloqueo lógico: ignorar si está procesando o confirmando
      if (processingLockRef.current || isConfirming) {
        return;
      }

      const code = result.getText();
      processingLockRef.current = true;
      setIsProcessing(true);
      setScanCount((count) => count + 1);

      // Modo simple: escanear y cerrar inmediatamente
      if (mode === 'single' && onScanSuccess) {
        playBeep(1200, 'sine');
        if (navigator.vibrate) navigator.vibrate(50);
        onScanSuccess(code);
        handleClose();
        return;
      }

      // Modo POS: procesar y mantener abierto
      playBeep(1000, 'sine');
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
      processScannedCode(code);
    },
    [isConfirming, mode, onScanSuccess, processScannedCode, handleClose]
  );

  // Manejo de errores de cámara
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

  // Hook de escaneo - SIEMPRE activo cuando show=true e isConfirming=false
  // La pausa lógica se maneja via processingLockRef, NO via paused
  const { ref: videoRef } = useZxingScanner({
    paused: !show || isConfirming, // Solo pausar por condiciones de UI, no por lógica
    onDecodeResult: handleDecodeResult,
    onError: handleError,
    constraints: CAMERA_CONSTRAINTS,
    hints: SCAN_HINTS,
    timeBetweenDecodingAttempts: 150,
  });

  // Retry de cámara
  const handleRetryCamera = useCallback(() => {
    setCameraError(null);
    processingLockRef.current = false;
    setIsProcessing(false);
  }, []);

  // Confirmar carrito con manejo robusto de errores
  const handleConfirmScan = useCallback(async () => {
    if (mode !== 'pos' || items.length === 0 || isConfirming) {
      return;
    }

    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
      pauseTimeoutRef.current = null;
    }

    setIsConfirming(true);
    processingLockRef.current = true;
    setIsProcessing(true);

    try {
      // Convertir items agrupados a array plano
      const flatItems = items.flatMap((item) =>
        Array.from({ length: item.quantity }, () => ({
          ...item,
          quantity: 1,
          uniqueLineId: `${item.uniqueLineId || item.id}-${Math.random().toString(36).slice(2, 8)}`,
        }))
      );

      const result = addMultipleScannedProducts(flatItems);

      if (!isMountedRef.current) return;

      // Analizar resultado detalladamente
      const hasPartialSuccess =
        (result?.addedCount || 0) > 0 || (result?.incrementedCount || 0) > 0;
      const hasFailures = (result?.failedCount || 0) > 0;

      if (hasFailures) {
        playErrorBeep();
        Logger.warn('Confirmacion parcial del carrito temporal del escaner.', {
          addedCount: result?.addedCount || 0,
          incrementedCount: result?.incrementedCount || 0,
          failedCount: result?.failedCount || 0,
        });

        if (!hasPartialSuccess) {
          // Fallo total - no reanudar escaneo automáticamente
          setScanFeedback(
            `Error: No se pudo agregar ningun producto (${result?.failedCount} fallos)`
          );
          setIsConfirming(false);
          setIsProcessing(false);
          // No reactivar processingLockRef - requiere acción del usuario
          return;
        }

        // Éxito parcial - notificar pero cerrar modal
        setScanFeedback(
          `Agregados ${result?.addedCount || 0}, ${result?.failedCount} fallos`
        );
        // Pequeño delay para que el usuario vea el mensaje
        setTimeout(() => {
          if (isMountedRef.current) {
            handleClose();
          }
        }, 1000);
        return;
      }

      if (!result?.success) {
        // Fallo completo sin detalles
        playErrorBeep();
        setScanFeedback('No se pudo confirmar el escaneo');
        setIsConfirming(false);
        setIsProcessing(false);
        return;
      }

      // Éxito total
      handleClose();
    } catch (error) {
      if (!isMountedRef.current) return;

      Logger.error('Error confirmando carrito temporal del escaner:', error);
      playErrorBeep();
      setScanFeedback('Error critico al confirmar');
      setIsConfirming(false);
      setIsProcessing(false);
      // No reactivar processingLockRef - requiere acción del usuario
    }
  }, [
    addMultipleScannedProducts,
    handleClose,
    isConfirming,
    items,
    mode,
    setIsConfirming,
  ]);

  // Inicialización cuando se abre el modal
  useEffect(() => {
    if (show) {
      clearCart();
      setScanFeedback('');
      setCameraError(null);
      setScanCount(0);
      processingLockRef.current = false;
      setIsProcessing(false);
      setIsConfirming(false);
    }
  }, [show, clearCart, setIsConfirming]);

  return (
    <div id="scanner-modal" className="modal" style={{ display: 'flex' }}>
      <div
        className={`modal-content scanner-modal-content ${mode === 'pos' ? 'pos-scan-mode' : 'simple-scan-mode'
          }`}
      >
        <h2 className="modal-title">
          Escanear Codigos{scanCount > 0 ? ` (${scanCount})` : ''}
        </h2>

        <div className="scanner-main-container">
          <div className="scanner-video-container">
            <button
              className="scanner-close-btn"
              onClick={handleClose}
              disabled={isConfirming}
              aria-label="Cerrar escaner"
              title="Cerrar"
            >
              <CloseIcon />
            </button>

            <CameraViewport
              videoRef={videoRef}
              cameraError={cameraError}
              scanFeedback={scanFeedback}
              isScanning={!isProcessing && !isConfirming}
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

        {mode === 'pos' && (
          <div className="scanner-actions">
            <button
              type="button"
              className="btn btn-primary scanner-confirm-btn"
              onClick={handleConfirmScan}
              disabled={items.length === 0 || isConfirming}
            >
              {isConfirming ? 'Confirmando...' : `Confirmar (${itemCount})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
