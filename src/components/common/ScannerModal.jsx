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

  // Referencias para control de escaneo
  const lastScannedRef = useRef({ code: null, time: 0 });
  const processingRef = useRef(false);
  const scanCountRef = useRef(0); 

  // ... (Toda la configuración de useZxing se mantiene IGUAL hasta processScannedCode) ...
  
  const { ref } = useZxing({
    paused: !isScanning,
    onDecodeResult(result) {
      const code = result.getText();
      const now = Date.now();

      if (
        lastScannedRef.current.code === code &&
        now - lastScannedRef.current.time < 1500
      ) {
        return; 
      }

      if (processingRef.current) return;

      lastScannedRef.current = { code, time: now };
      processingRef.current = true;
      scanCountRef.current++;

      if (onScanSuccess) {
        if (navigator.vibrate) navigator.vibrate(50);
        onScanSuccess(code);
        handleClose(true);
        return;
      }

      setIsScanning(false); 

      if (navigator.vibrate) navigator.vibrate([50, 30, 50]); 
      setScanFeedback(`✓ ${code}`);

      processScannedCode(code);

      setTimeout(() => {
        setIsScanning(true);
        processingRef.current = false;
        setScanFeedback('');
      }, 600);
    },
    onError(error) {
      console.error('Error ZXing:', error);
      setCameraError('Error al leer códigos. Verifica permisos de cámara.');
      processingRef.current = false;
    },
    constraints: {
      video: {
        facingMode: 'environment',
        width: { min: 640, ideal: 1920, max: 1920 },
        height: { min: 480, ideal: 1080, max: 1080 },
        focusMode: { ideal: 'continuous' },
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false 
    },
    hints: new Map([
      [2, ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'ITF', 'CODABAR', 'QR_CODE']]
    ]),
    timeBetweenDecodingAttempts: 100,
  });

  useEffect(() => {
    return () => {
      lastScannedRef.current = { code: null, time: 0 };
      processingRef.current = false;
      scanCountRef.current = 0;
    };
  }, []);

  useEffect(() => {
    if (show) {
      setIsScanning(false);
      setCameraError(null);
      lastScannedRef.current = { code: null, time: 0 };
      processingRef.current = false;

      const timer = setTimeout(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'environment',
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            }
          });
          stream.getTracks().forEach(track => track.stop());
          setIsScanning(true);
        } catch (error) {
          console.error('Error accediendo a cámara:', error);
          if (error.name === 'NotAllowedError') {
            setCameraError('❌ Permiso de cámara denegado.');
          } else {
            setCameraError(`❌ Error: ${error.message}`);
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

  // ============================================================
  // 📦 AQUÍ ESTÁ LA CORRECCIÓN PRINCIPAL
  // ============================================================
  const processScannedCode = async (code) => {
    try {
      const menu = await loadData(STORES.MENU);
      const product = menu.find(p => p.barcode === code && p.isActive !== false);

      if (product) {
        
        // 1. Aseguramos que el precio sea un número válido (parseando strings)
        const rawPrice = parseFloat(product.price);
        const finalPrice = (!isNaN(rawPrice) && rawPrice >= 0) ? rawPrice : 0;

        // 2. Aseguramos que el costo sea un número válido
        const rawCost = parseFloat(product.cost);
        const finalCost = (!isNaN(rawCost) && rawCost >= 0) ? rawCost : 0;

        const safeProduct = {
          ...product,
          price: finalPrice,
          cost: finalCost,
          // 3. ¡IMPORTANTE! Agregamos originalPrice. 
          // El useOrderStore lo necesita para calcular descuentos si cambias la cantidad luego.
          originalPrice: finalPrice, 
          stock: (typeof product.stock === 'number' && !isNaN(product.stock)) ? product.stock : 0
        };

        setScannedItems(prevItems => {
          const existing = prevItems.find(i => i.id === safeProduct.id);
          if (existing) {
            return prevItems.map(i =>
              i.id === safeProduct.id ? { ...i, quantity: i.quantity + 1 } : i
            );
          }
          return [...prevItems, { ...safeProduct, quantity: 1 }];
        });

        setScanFeedback(`✅ ${safeProduct.name} - $${finalPrice.toFixed(2)}`);
      } else {
        console.warn(`Código ${code} no encontrado.`);
        setScanFeedback(`⚠️ No encontrado: ${code}`);
        setTimeout(() => setScanFeedback(''), 2000);
      }
    } catch (error) {
      console.error('Error procesando código:', error);
      setScanFeedback('❌ Error al buscar producto');
      setTimeout(() => setScanFeedback(''), 2000);
    }
  };

  const handleConfirmScan = useCallback(() => {
    const newOrder = [...currentOrder];

    scannedItems.forEach(scannedItem => {
      const existingInOrder = newOrder.find(item => item.id === scannedItem.id);
      if (existingInOrder) {
        if (existingInOrder.saleType === 'unit') {
          existingInOrder.quantity += scannedItem.quantity;
        }
      } else {
        // Al confirmar, ya llevamos el objeto corregido con precio y originalPrice
        newOrder.push(scannedItem);
      }
    });

    setOrder(newOrder);
    handleClose(true);
  }, [scannedItems, currentOrder, setOrder]);

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
    lastScannedRef.current = { code: null, time: 0 };
    processingRef.current = false;
    onClose();
  }, [scannedItems, onClose]);

  const totalScaneado = scannedItems.reduce(
    (sum, item) => sum + (item.price * item.quantity),
    0
  );

  if (!show) return null;

  return (
    <div id="scanner-modal" className="modal" style={{ display: 'flex' }}>
      <div className={`modal-content scanner-modal-content ${mode === 'pos' ? 'pos-scan-mode' : 'simple-scan-mode'}`}>
        <h2 className="modal-title">
          Escanear Códigos {scanCountRef.current > 0 && `(${scanCountRef.current})`}
        </h2>

        <div className="scanner-main-container">
          <div className="scanner-video-container">
            {cameraError ? (
              <div className="camera-error-feedback">
                <p>{cameraError}</p>
                <button onClick={() => { setCameraError(null); setIsScanning(true); }} className="btn btn-secondary">
                  🔄 Reintentar
                </button>
              </div>
            ) : (
              <>
                <video ref={ref} id="scanner-video" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {scanFeedback && (
                  <div className="scan-feedback-overlay">
                    <div className="scan-feedback-message">{scanFeedback}</div>
                  </div>
                )}
                <div className="scanner-reticle" style={{
                  position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                  width: '70%', height: '40%', border: '3px solid rgba(0, 255, 0, 0.5)',
                  borderRadius: '12px', pointerEvents: 'none', boxShadow: '0 0 0 9999px rgba(0,0,0,0.3)'
                }}>
                  <div style={{ position: 'absolute', bottom: '-30px', left: '50%', transform: 'translateX(-50%)', color: 'white', fontSize: '0.9rem', textShadow: '0 2px 4px rgba(0,0,0,0.8)', whiteSpace: 'nowrap' }}>
                    📷 Centra el código aquí
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="scanner-results-container">
            <h3 className="subtitle">Carrito Temporal</h3>
            <div className="scanned-items-list">
              {scannedItems.length === 0 ? (
                <p className="empty-message" style={{ padding: '2rem 0' }}>Escanea tu primer producto</p>
              ) : (
                scannedItems.map(item => (
                  <div key={item.id} className="scanned-item">
                    <span className="scanned-item-name">{item.name}</span>
                    <span className="scanned-item-controls">x{item.quantity}</span>
                    <span className="scanned-item-price">${(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="scanner-total-container">
              <span>Total:</span>
              <span>${totalScaneado.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="scanner-actions">
          <button className="btn btn-process" onClick={handleConfirmScan} disabled={scannedItems.length === 0}>
            ✅ Confirmar ({scannedItems.length})
          </button>
          <button className="btn btn-cancel" onClick={() => handleClose(false)}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
