// src/components/scanner/ScannerModal.jsx
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { resolveWithCacheResult } from '../../services/barcodeCache';
import { playBeep, playErrorBeep } from '../../services/audioBeep';
import Logger from '../../services/Logger';
import { useScannerCart } from '../../hooks/scanner/useScannerCart';
import { useZxingScanner } from '../../hooks/scanner/useZxingScanner';
import { isRecoverableDecodeError } from '../../hooks/scanner/useZxingScanner';
import { createBarcodeScanEvent } from '../../services/scanner/barcodeScanEvent';
import { CameraViewport } from './CameraViewport';
import { COMMERCIAL_BARCODE_SCAN_HINTS } from './commercialBarcodeFormats';
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

const TorchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 3h10l-2 7H9L7 3Z" />
    <path d="M9 10v7a3 3 0 0 0 6 0v-7" />
    <path d="M9 21h6" />
  </svg>
);

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
  const [scanIssues, setScanIssues] = useState([]);
  const [cameraError, setCameraError] = useState(null);
  const [scanCount, setScanCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transferUncertain, setTransferUncertain] = useState(false);

  const mode = onScanSuccess ? 'single' : 'pos';

  // Refs para control de flujo sin causar re-renders
  const processingLockRef = useRef(false);
  const decodeRegionRef = useRef(null);
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
    setScanIssues([]);
    setScanFeedback('');
    setCameraError(null);
    setScanCount(0);
    setTransferUncertain(false);
    decodeRegionRef.current = null;
    onClose();
  }, [clearCart, onClose]);

  // Procesar código escaneado con protección contra race conditions
  const processScannedCode = useCallback(
    async (scanEvent) => {
      if (!isMountedRef.current) return;

      const code = scanEvent.code;
      setScanFeedback(`Buscando: ${code}...`);

      try {
        const result = await resolveWithCacheResult(code);

        if (!isMountedRef.current) return;

        if (result.status !== 'RESOLVED') {
          playErrorBeep();
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          const labels = {
            NOT_FOUND: 'Producto no registrado',
            DUPLICATE: 'Este código pertenece a varios productos',
            INACTIVE: 'Producto registrado, pero desactivado',
            NO_SELLABLE_BATCH: 'Producto registrado, sin lote disponible',
          };
          const message = labels[result.status] || 'No se pudo consultar el catálogo';
          setScanIssues((previous) => previous.some((issue) => (
            issue.code === code && issue.status === result.status
          )) ? previous : [...previous, {
            code, status: result.status, message,
            productName: result.product?.name || null,
            matches: result.matches || [],
          }]);
          setScanFeedback(message);
          scheduleReactivation();
          return;
        }

        const product = result.product;
        addItem(product);
        setScanFeedback(`Producto reconocido: ${product.name} - $${product.price.toFixed(2)}`);
        scheduleReactivation();
      } catch (error) {
        if (!isMountedRef.current) return;

        Logger.error('Error procesando codigo escaneado:', error);
        playErrorBeep();
        setScanFeedback('No se pudo consultar el catálogo');
        setScanIssues((previous) => previous.some((issue) => (
          issue.code === code && issue.status === 'ERROR'
        )) ? previous : [...previous, {
          code, status: 'ERROR', message: 'No se pudo consultar el catálogo',
        }]);
        scheduleReactivation();
      }
    },
    [addItem, scheduleReactivation]
  );

  // Handler de decodificación con bloqueo lógico estricto
  const handleDecodeResult = useCallback(
    (result) => {
      // Bloqueo lógico: ignorar si está procesando o confirmando
      if (processingLockRef.current || isConfirming) {
        return;
      }

      const scanEvent = createBarcodeScanEvent({
        source: 'camera',
        code: result.getText(),
        timestamp: Date.now()
      });
      if (!scanEvent) return;

      processingLockRef.current = true;
      setIsProcessing(true);
      setScanCount((count) => count + 1);

      // Modo simple: escanear y cerrar inmediatamente
      if (mode === 'single' && onScanSuccess) {
        playBeep(1200, 'sine');
        if (navigator.vibrate) navigator.vibrate(50);
        onScanSuccess(scanEvent);
        handleClose();
        return;
      }

      // Modo POS: procesar y mantener abierto
      playBeep(1000, 'sine');
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
      processScannedCode(scanEvent);
    },
    [isConfirming, mode, onScanSuccess, processScannedCode, handleClose]
  );

  // Un fallo fatal requiere una salida visible; la sesión se limpia en el hook.
  const handleError = useCallback((error) => {
    if (!isMountedRef.current || isRecoverableDecodeError(error)) return;

    if (error?.name === 'NotAllowedError') {
      setCameraError('Permiso de cámara denegado. Autorízalo y pulsa Reintentar.');
      return;
    }

    if (error?.name === 'NotFoundError') {
      setCameraError('No se encontró una cámara. Comprueba el dispositivo y pulsa Reintentar.');
      return;
    }

    Logger.warn('Fallo del escáner:', error?.message || error);
    setCameraError('El escáner se detuvo. Pulsa Reintentar para volver a abrir la cámara.');
  }, []);

  const handleTorchError = useCallback(() => {
    if (isMountedRef.current) {
      setScanFeedback('Error al cambiar la linterna. Puedes seguir escaneando.');
    }
  }, []);

  // Hook de escaneo - SIEMPRE activo cuando show=true e isConfirming=false
  // La pausa lógica se maneja via processingLockRef, NO via paused
  const { ref: videoRef, torch, toggleTorch, restartCamera } = useZxingScanner({
    paused: !show || isConfirming || transferUncertain, // Solo pausar por condiciones de UI, no por lógica
    onDecodeResult: handleDecodeResult,
    onError: handleError,
    onTorchError: handleTorchError,
    constraints: CAMERA_CONSTRAINTS,
    hints: COMMERCIAL_BARCODE_SCAN_HINTS,
    decodeRegionRef,
    timeBetweenDecodingAttempts: 150,
  });

  const handleDecodeRegionChange = useCallback((region) => {
    decodeRegionRef.current = region;
  }, []);

  // Reinicia una sesión física nueva sin borrar los artículos ya escaneados.
  // Un producto aún en resolución conserva su bloqueo contra duplicados.
  const handleRetryCamera = useCallback(() => {
    setCameraError(null);
    setScanFeedback('');
    restartCamera();
  }, [restartCamera]);

  // Confirmar carrito con manejo robusto de errores
  const handleConfirmScan = useCallback(async () => {
    if (
      mode !== 'pos' || items.length === 0 || isConfirming
      || isProcessing || processingLockRef.current || transferUncertain
    ) {
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

      const result = await addMultipleScannedProducts(flatItems);

      if (!isMountedRef.current) return;

      // The POS action reports affected quantities after its order update.
      // Retry only when every input unit is explicitly reported as failed.
      const addedCount = result?.addedCount ?? 0;
      const incrementedCount = result?.incrementedCount ?? 0;
      const failedCount = result?.failedCount ?? 0;
      const hasPartialSuccess = addedCount > 0 || incrementedCount > 0;
      const hasFailures = failedCount > 0;
      const verifiedTotalFailure = (
        result?.success === false
        && addedCount === 0
        && incrementedCount === 0
        && failedCount === flatItems.length
      );

      if (hasFailures && hasPartialSuccess) {
        // Preserve existing partial-success handling outside this PR's scope.
        playErrorBeep();
        Logger.warn('Confirmacion parcial del carrito temporal del escaner.', {
          addedCount,
          incrementedCount,
          failedCount,
        });
        setScanFeedback(`Agregados ${addedCount}, ${failedCount} fallos`);
        setTimeout(() => {
          if (isMountedRef.current) {
            handleClose();
          }
        }, 1000);
        return;
      }

      if (hasFailures || !result?.success) {
        playErrorBeep();
        if (verifiedTotalFailure) {
          setScanFeedback(`Error: No se pudo agregar ningun producto (${failedCount} fallos)`);
          processingLockRef.current = false;
        } else {
          // Uncertain result: do not risk transferring the same units twice.
          setTransferUncertain(true);
        }
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
      // A thrown error does not prove that no POS items were added.
      setTransferUncertain(true);
      setIsConfirming(false);
      setIsProcessing(false);
    }
  }, [
    addMultipleScannedProducts,
    handleClose,
    isConfirming,
    items,
    mode,
    isProcessing,
    transferUncertain,
    setIsConfirming,
  ]);

  // Inicialización cuando se abre el modal
  useEffect(() => {
    if (show) {
      clearCart();
      setScanIssues([]);
      setScanFeedback('');
      setCameraError(null);
      setScanCount(0);
      setTransferUncertain(false);
      decodeRegionRef.current = null;
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

        <button
          type="button"
          className="scanner-close-btn"
          onClick={handleClose}
          disabled={isConfirming}
          aria-label="Cerrar escaner"
          title="Cerrar"
        >
          <CloseIcon />
        </button>

        <div className="scanner-main-container">
          <div className="scanner-camera-panel">
            <div className="scanner-camera-controls">
              <span className="scanner-camera-label">Cámara</span>
            </div>

            <div className="scanner-video-container">
              <CameraViewport
                videoRef={videoRef}
                cameraError={cameraError}
                scanFeedback={scanFeedback}
                isScanning={!isProcessing && !isConfirming && !transferUncertain}
                isConfirming={isConfirming}
                onRetryCamera={handleRetryCamera}
                onDecodeRegionChange={handleDecodeRegionChange}
              />
              {torch.supported && !cameraError && (
                <button
                  type="button"
                  className={`scanner-torch-btn${torch.enabled ? ' scanner-torch-btn--on' : ''}`}
                  onClick={toggleTorch}
                  disabled={torch.pending || isConfirming}
                  aria-pressed={torch.enabled}
                  aria-label={torch.pending
                    ? 'Cambiando linterna'
                    : torch.enabled ? 'Apagar linterna' : 'Encender linterna'}
                  title={torch.enabled ? 'Apagar linterna' : 'Encender linterna'}
                >
                  <TorchIcon />
                  <span>{torch.pending ? 'Cambiando…' : torch.enabled ? 'Encendida' : 'Linterna'}</span>
                </button>
              )}
            </div>
          </div>

          {mode === 'pos' && (
            <div className="scanner-results-container">
              <h3 className="subtitle">Carrito Temporal</h3>
              <UnknownCodesBanner
                issues={scanIssues}
                onClear={() => setScanIssues([])}
              />
              {transferUncertain && (
                <p role="alert" className="scanner-error-banner">
                  No se pudo verificar si los productos llegaron al carrito POS.
                  Cierra el escáner y revisa el carrito antes de volver a transferirlos.
                </p>
              )}
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
              disabled={items.length === 0 || isConfirming || isProcessing || transferUncertain}
            >
              {isConfirming ? 'Confirmando...' : `Confirmar (${itemCount})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
