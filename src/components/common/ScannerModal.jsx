// src/components/common/ScannerModal.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useZxing } from 'react-zxing';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { useOrderStore } from '../../store/useOrderStore';
import { productsRepository } from '../../services/db/products';
import { db, STORES } from '../../services/db/dexie';
import { getAvailableStock } from '../../services/db/utils';
import './ScannerModal.css';
import Logger from '../../services/Logger';

// ---------------------------------------------------------------------------
// Constantes de configuración
// ---------------------------------------------------------------------------

const CAMERA_CONSTRAINTS = {
  video: {
    facingMode: 'environment',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
};

// FIX #3: Usar BarcodeFormat enum en lugar de strings, y DecodeHintType como clave
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

const DEBOUNCE_MS = 1500;
const FEEDBACK_RESET_MS = 1000;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Genera un beep ultraligero con la Web Audio API.
 * No lanza error si el contexto no está disponible.
 */
const playBeep = (freq = 1200, type = 'sine') => {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch (e) {
    Logger.warn('Audio no disponible', e);
  }
};

/**
 * Devuelve un precio parseado y saneado (nunca NaN ni negativo).
 */
const safePrice = (value) => {
  const parsed = parseFloat(value);
  return !isNaN(parsed) && parsed >= 0 ? parsed : 0;
};

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function ScannerModal({ show, onClose, onScanSuccess }) {
  const currentOrder = useOrderStore((state) => state.order);
  const setOrder = useOrderStore((state) => state.setOrder);

  const [scannedItems, setScannedItems] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [scanFeedback, setScanFeedback] = useState('');

  // FIX #4: scanCount como estado para que actualice la UI
  const [scanCount, setScanCount] = useState(0);

  const mode = onScanSuccess ? 'single' : 'pos';

  // Referencias de control
  const lastScannedRef = useRef({ code: null, time: 0 });
  const processingRef = useRef(false);

  // FIX #2: Referencia para cancelar el setTimeout pendiente
  const feedbackTimeoutRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Helpers internos
  // ---------------------------------------------------------------------------

  /**
   * Cancela cualquier timeout de feedback pendiente.
   * Llamado antes de iniciar uno nuevo y en el cleanup.
   */
  const clearFeedbackTimeout = useCallback(() => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }
  }, []);

  /**
   * Reactiva el escáner tras procesar un código,
   * mostrando el feedback durante FEEDBACK_RESET_MS.
   */
  const reactivateScanner = useCallback(() => {
    clearFeedbackTimeout();
    feedbackTimeoutRef.current = setTimeout(() => {
      setIsScanning(true);
      processingRef.current = false;
      setScanFeedback('');
      feedbackTimeoutRef.current = null;
    }, FEEDBACK_RESET_MS);
  }, [clearFeedbackTimeout]);

  // ---------------------------------------------------------------------------
  // Procesamiento del código escaneado (FIX #5: useCallback con deps estables)
  // ---------------------------------------------------------------------------

  const processScannedCode = useCallback(async (code) => {
    try {
      setScanFeedback(`Buscando: ${code}...`);

      // 1. Buscar por código de barras (producto padre)
      let product = await productsRepository.searchByBarcode(code);

      // 2. Fallback: buscar por SKU (lote / variante)
      if (!product) {
        product = await productsRepository.searchProductBySKU(code);
      }

      if (product) {
        let finalPrice = safePrice(product.price);
        let finalCost = safePrice(product.cost);
        let displayName = product.name;
        let batchId = product.batchId ?? null;

        if (product.isVariant) {
          // Variante específica identificada por SKU
          displayName = `${product.name} (${product.variantName})`;
        } else if (product.batchManagement?.enabled) {
          // Producto con gestión de lotes: aplicar FIFO desde Dexie
          try {
            const activeBatches = await db
              .table(STORES.PRODUCT_BATCHES)
              .where('productId')
              .equals(product.id)
              .filter((b) => b.isActive && getAvailableStock(b) > 0)
              .sortBy('createdAt');

            if (activeBatches?.length > 0) {
              const [currentBatch] = activeBatches; // FIFO: primer elemento
              finalPrice = safePrice(currentBatch.price) || finalPrice;
              finalCost = safePrice(currentBatch.cost) || finalCost;
              batchId = currentBatch.id;
            }
          } catch (batchError) {
            Logger.warn('Error cargando lotes FIFO en escáner:', batchError);
          }
        }

        const safeProduct = {
          ...product,
          name: displayName,
          price: finalPrice,
          cost: finalCost,
          originalPrice: finalPrice,
          batchId,
          stock: 0,
        };

        if (product.isVariant && batchId) {
          const currentBatch = await db.table(STORES.PRODUCT_BATCHES).get(batchId);
          safeProduct.stock = currentBatch ? getAvailableStock(currentBatch) : getAvailableStock(product);
        } else {
          safeProduct.stock = getAvailableStock(product);
        }

        setScannedItems((prev) => {
          // Agrupar por id + batchId para no mezclar variantes del mismo producto
          const existingIndex = prev.findIndex(
            (i) => i.id === safeProduct.id && i.batchId === safeProduct.batchId
          );
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              quantity: updated[existingIndex].quantity + 1,
            };
            return updated;
          }
          return [...prev, { ...safeProduct, quantity: 1 }];
        });

        setScanFeedback(`✅ ${safeProduct.name} — $${finalPrice.toFixed(2)}`);
      } else {
        playBeep(200, 'sawtooth'); // Tono grave de error
        setScanFeedback(`⚠️ No encontrado: ${code}`);
      }
    } catch (error) {
      Logger.error('Error procesando código escaneado:', error);
      setScanFeedback('❌ Error de base de datos');
    } finally {
      reactivateScanner();
    }
  }, [reactivateScanner]);

  // ---------------------------------------------------------------------------
  // ZXing: gestiona el stream de cámara internamente (no usar getUserMedia aparte)
  // ---------------------------------------------------------------------------

  const { ref: videoRef } = useZxing({
    paused: !show || !isScanning,
    onDecodeResult(result) {
      const code = result.getText();
      const now = Date.now();

      // Debounce: ignorar el mismo código dentro de DEBOUNCE_MS
      if (
        lastScannedRef.current.code === code &&
        now - lastScannedRef.current.time < DEBOUNCE_MS
      ) {
        return;
      }

      if (processingRef.current) return;

      lastScannedRef.current = { code, time: now };
      processingRef.current = true;
      setScanCount((c) => c + 1); // FIX #4: actualiza UI

      // MODO SIMPLE: devuelve el código y cierra
      if (onScanSuccess) {
        playBeep(1200, 'sine');
        if (navigator.vibrate) navigator.vibrate(50);
        onScanSuccess(code);
        handleClose(true);
        return;
      }

      // MODO POS: agregar al carrito temporal
      setIsScanning(false);
      playBeep(1000, 'sine');
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
      processScannedCode(code);
    },
    onError(error) {
      // NotFoundException se dispara constantemente cuando no hay código visible; se ignora
      if (error.name === 'NotFoundException') return;

      if (error.name === 'NotAllowedError') {
        setCameraError('❌ Permiso de cámara denegado.');
      } else if (error.name === 'NotFoundError') {
        setCameraError('❌ No se encontró cámara en este dispositivo.');
      } else {
        Logger.warn('Advertencia ZXing:', error.message);
      }
    },
    constraints: CAMERA_CONSTRAINTS,
    hints: SCAN_HINTS,
    timeBetweenDecodingAttempts: 250,
  });

  // ---------------------------------------------------------------------------
  // Ciclo de vida: inicialización / limpieza al abrir y cerrar el modal
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (show) {
      // Resetear estado al abrir
      setIsScanning(true);
      setCameraError(null);
      setScanFeedback('');
      setScanCount(0);
      lastScannedRef.current = { code: null, time: 0 };
      processingRef.current = false;
    } else {
      // Detener escaneo y cancelar timeouts pendientes al cerrar
      setIsScanning(false);
      setScanFeedback('');
      clearFeedbackTimeout(); // FIX #2
    }

    return () => {
      // FIX #2: garantizar limpieza también en desmontaje del componente
      clearFeedbackTimeout();
    };
  }, [show, clearFeedbackTimeout]);

  // ---------------------------------------------------------------------------
  // Acciones del usuario
  // ---------------------------------------------------------------------------

  const handleConfirmScan = useCallback(() => {
    const newOrder = [...currentOrder];

    scannedItems.forEach((scannedItem) => {
      const existingInOrder = newOrder.find(
        (item) =>
          item.id === scannedItem.id && item.batchId === scannedItem.batchId
      );
      if (existingInOrder) {
        if (existingInOrder.saleType === 'unit') {
          existingInOrder.quantity += scannedItem.quantity;
        }
      } else {
        newOrder.push(scannedItem);
      }
    });

    setOrder(newOrder);
    handleClose(true);
  }, [scannedItems, currentOrder, setOrder]);

  const handleClose = useCallback(
    (force = false) => {
      if (!force && scannedItems.length > 0) {
        if (!window.confirm('¿Cerrar sin agregar los productos escaneados?')) {
          return;
        }
      }
      clearFeedbackTimeout(); // FIX #2: cancelar timeout al cerrar manualmente
      setScannedItems([]);
      setIsScanning(false);
      setCameraError(null);
      setScanFeedback('');
      setScanCount(0);
      lastScannedRef.current = { code: null, time: 0 };
      processingRef.current = false;
      onClose();
    },
    [scannedItems, onClose, clearFeedbackTimeout]
  );

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const totalScaneado = scannedItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!show) return null;

  return (
    <div id="scanner-modal" className="modal" style={{ display: 'flex' }}>
      <div
        className={`modal-content scanner-modal-content ${
          mode === 'pos' ? 'pos-scan-mode' : 'simple-scan-mode'
        }`}
      >
        {/* Título con conteo de escaneos (FIX #4: ahora sí actualiza la UI) */}
        <h2 className="modal-title">
          Escanear Códigos{scanCount > 0 ? ` (${scanCount})` : ''}
        </h2>

        <div className="scanner-main-container">
          {/* ── Área de video ── */}
          <div className="scanner-video-container">
            {cameraError ? (
              <div className="camera-error-feedback">
                <p>{cameraError}</p>
                <button
                  onClick={() => {
                    setCameraError(null);
                    setIsScanning(true);
                  }}
                  className="btn btn-secondary"
                >
                  🔄 Reintentar
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
                    {isScanning ? '📷 Centra el código aquí' : '⏳ Procesando...'}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Carrito temporal (solo en modo POS) ── */}
          {mode === 'pos' && (
            <div className="scanner-results-container">
              <h3 className="subtitle">Carrito Temporal</h3>
              <div className="scanned-items-list">
                {scannedItems.length === 0 ? (
                  <p className="empty-message" style={{ padding: '2rem 0' }}>
                    Escanea tu primer producto
                  </p>
                ) : (
                  scannedItems.map((item, index) => (
                    <div
                      key={`${item.id}-${item.batchId ?? index}`}
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

        {/* ── Acciones ── */}
        <div className="scanner-actions">
          {mode === 'pos' && (
            <button
              className="btn btn-process"
              onClick={handleConfirmScan}
              disabled={scannedItems.length === 0}
            >
              Confirmar ({scannedItems.length})
            </button>
          )}
          <button
            className="btn btn-cancel"
            onClick={() => handleClose(false)}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
