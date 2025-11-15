// src/components/common/ScannerModal.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useZxing } from 'react-zxing';
import { useOrderStore } from '../../store/useOrderStore';
import { loadData, STORES } from '../../services/database';
import './ScannerModal.css';

export default function ScannerModal({ show, onClose, onScanSuccess }) {
  const currentOrder = useOrderStore((state) => state.order);
  const setOrder = useOrderStore((state) => state.setOrder);

  const [scannedItems, setScannedItems] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [scanFeedback, setScanFeedback] = useState('');
  const mode = onScanSuccess ? 'single' : 'pos';
  
  // ¡NUEVO! Guardamos el último código escaneado y su timestamp
  const lastScannedRef = useRef({ code: null, time: 0 });
  const processingRef = useRef(false);

  const { ref } = useZxing({
    paused: !isScanning,
    onDecodeResult(result) {
      const code = result.getText();
      const now = Date.now();
      
      // ¡MEJORA 1! Evitar procesar el mismo código múltiples veces
      // Si es el mismo código que hace menos de 2 segundos, ignorarlo
      if (
        lastScannedRef.current.code === code && 
        now - lastScannedRef.current.time < 2000
      ) {
        console.log('⏭️ Código duplicado ignorado:', code);
        return;
      }

      // ¡MEJORA 2! Lock de procesamiento para evitar race conditions
      if (processingRef.current) {
        console.log('⏳ Ya hay un código siendo procesado...');
        return;
      }

      // Actualizar el último código escaneado
      lastScannedRef.current = { code, time: now };
      processingRef.current = true;

      // --- Modo Simple (Formulario de Productos) ---
      if (onScanSuccess) {
        if (navigator.vibrate) navigator.vibrate(50);
        onScanSuccess(code);
        handleClose(true);
        return;
      }

      // --- Modo POS ---
      // Pausar el escáner durante el procesamiento
      setIsScanning(false);

      // Feedback visual y táctil
      if (navigator.vibrate) navigator.vibrate(100);
      setScanFeedback(`✓ Escaneado: ${code}`);

      // Procesar el código
      processScannedCode(code);

      // ¡MEJORA 3! Cooldown más corto pero efectivo
      setTimeout(() => {
        setIsScanning(true);
        processingRef.current = false;
        setScanFeedback('');
      }, 800); // Reducido de 1500ms a 800ms
    },
    onError(error) {
      console.error('Error de ZXing:', error);
      setCameraError('Error al leer códigos. Verifica tu cámara.');
      processingRef.current = false;
    },
    constraints: {
      video: {
        facingMode: 'environment',
        // ¡MEJORA 4! Optimización de resolución
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        focusMode: 'continuous',
        // ¡NUEVO! Mejoras para velocidad de escaneo
        aspectRatio: { ideal: 16/9 },
        frameRate: { ideal: 30, max: 60 }
      }
    },
    // ¡MEJORA 5! Tiempo entre intentos más agresivo
    timeBetweenDecodingAttempts: 150 // Reducido de 300ms a 150ms
  });

  // ¡MEJORA 6! Limpiar referencias al desmontar
  useEffect(() => {
    return () => {
      lastScannedRef.current = { code: null, time: 0 };
      processingRef.current = false;
    };
  }, []);

  // Efecto para solicitar permisos de cámara
  useEffect(() => {
    if (show) {
      setIsScanning(false);
      setCameraError(null);
      // ¡MEJORA 7! Resetear el historial de escaneo al abrir
      lastScannedRef.current = { code: null, time: 0 };
      processingRef.current = false;

      const timer = setTimeout(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
          });
          stream.getTracks().forEach(track => track.stop());
          setIsScanning(true);
        } catch (error) {
          console.error('Error al acceder a la cámara:', error);
          if (error.name === 'NotAllowedError') {
            setCameraError('❌ Permiso de cámara denegado. Habilita el acceso en tu navegador.');
          } else if (error.name === 'NotFoundError') {
            setCameraError('❌ No se encontró ninguna cámara.');
          } else {
            setCameraError('❌ Error al acceder a la cámara: ' + error.message);
          }
        }
      }, 300);

      return () => {
        clearTimeout(timer);
        setIsScanning(false);
      };
    } else {
      setIsScanning(false);
    }
  }, [show]);

  /**
   * Procesa el código usando la base de datos
   */
  const processScannedCode = async (code) => {
    try {
      const menu = await loadData(STORES.MENU);
      const product = menu.find(p => p.barcode === code && p.isActive !== false);

      if (product) {
        setScannedItems(prevItems => {
          const existing = prevItems.find(i => i.id === product.id);
          if (existing) {
            return prevItems.map(i =>
              i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
            );
          }
          return [...prevItems, { ...product, quantity: 1 }];
        });
        
        // Feedback de éxito
        setScanFeedback(`✅ ${product.name} añadido`);
      } else {
        console.warn(`Producto con código ${code} no encontrado.`);
        setScanFeedback(`⚠️ Producto no encontrado: ${code}`);
        setTimeout(() => setScanFeedback(''), 2000);
      }
    } catch (error) {
      console.error('Error al procesar código:', error);
      setScanFeedback('❌ Error al buscar producto');
      setTimeout(() => setScanFeedback(''), 2000);
    }
  };

  /**
   * Confirma y añade los items al store
   */
  const handleConfirmScan = useCallback(() => {
    const newOrder = [...currentOrder];

    scannedItems.forEach(scannedItem => {
      const existingInOrder = newOrder.find(item => item.id === scannedItem.id);
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

  /**
   * Cierra el modal
   */
  const handleClose = useCallback((force = false) => {
    if (!force && scannedItems.length > 0) {
      if (!window.confirm('¿Cerrar sin agregar los productos escaneados?')) {
        return;
      }
    }

    setScannedItems([]);
    setIsScanning(false);
    setCameraError(null);
    setScanFeedback('');
    // ¡MEJORA 8! Resetear referencias
    lastScannedRef.current = { code: null, time: 0 };
    processingRef.current = false;
    onClose();
  }, [scannedItems, onClose]);

  const totalScaneado = scannedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  if (!show) {
    return null;
  }

  return (
    <div id="scanner-modal" className="modal" style={{ display: 'flex' }}>
      <div className={`modal-content scanner-modal-content ${mode === 'pos' ? 'pos-scan-mode' : 'simple-scan-mode'}`}>
        <h2 className="modal-title">Escanear Productos</h2>

        <div className="scanner-main-container">
          {/* Contenedor del Video */}
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
                  Reintentar
                </button>
              </div>
            ) : (
              <>
                <video ref={ref} id="scanner-video" />

                {scanFeedback && (
                  <div className="scan-feedback-overlay">
                    {scanFeedback}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Lista de productos escaneados */}
          <div className="scanner-results-container">
            <h3 className="subtitle">Productos Escaneados</h3>

            <div className="scanned-items-list">
              {scannedItems.length === 0 ? (
                <p className="empty-message" style={{ padding: '2rem 0' }}>
                  Aún no hay productos escaneados.
                </p>
              ) : (
                scannedItems.map(item => (
                  <div key={item.id} className="scanned-item">
                    <span className="scanned-item-name">{item.name}</span>
                    <span className="scanned-item-controls">
                      x{item.quantity}
                    </span>
                    <span className="scanned-item-price">
                      ${(item.price * item.quantity).toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Total */}
            <div className="scanner-total-container">
              <span>Total:</span>
              <span>${totalScaneado.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Botones */}
        <div className="scanner-actions">
          <button
            className="btn btn-process"
            onClick={handleConfirmScan}
            disabled={scannedItems.length === 0}
          >
            Confirmar y Agregar ({scannedItems.length})
          </button>
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