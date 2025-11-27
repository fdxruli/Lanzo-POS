// src/components/common/ScannerModal.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useZxing } from 'react-zxing';
import { useOrderStore } from '../../store/useOrderStore';
import { loadData, STORES, queryBatchesByProductIdAndActive } from '../../services/database';
import styles from './ScannerModal.module.css';

export default function ScannerModal({ show, onClose, onScanSuccess }) {
  const currentOrder = useOrderStore((state) => state.order);
  const setOrder = useOrderStore((state) => state.setOrder);

  const [scannedItems, setScannedItems] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [cameraError, setCameraError] = useState(null);

  const isPosMode = !onScanSuccess;

  const lastScannedRef = useRef({ code: null, time: 0 });
  const processingRef = useRef(false);

  const { ref } = useZxing({
    paused: !isScanning,
    onDecodeResult(result) {
      const code = result.getText();
      const now = Date.now();

      // Debounce de 1.5s
      if (code === lastScannedRef.current.code && now - lastScannedRef.current.time < 1500) return;
      if (processingRef.current) return;

      lastScannedRef.current = { code, time: now };
      processingRef.current = true;

      if (navigator.vibrate) navigator.vibrate(50);

      if (!isPosMode) {
        onScanSuccess(code);
        handleClose();
        return;
      }

      setFeedback(`🔎 Buscando...`);
      processScannedCode(code);

      setTimeout(() => { processingRef.current = false; setFeedback(''); }, 800);
    },
    onError(err) {
      if (err.name === 'NotAllowedError') setCameraError('Sin permiso de cámara');
    }
  });

  useEffect(() => {
    if (show) {
      setScannedItems([]);
      setCameraError(null);
      setFeedback('');
      setIsScanning(true);
    } else {
      setIsScanning(false);
    }
  }, [show]);

  const processScannedCode = async (code) => {
    try {
      const menu = await loadData(STORES.MENU);
      const product = menu.find(p => p.barcode === code && p.isActive !== false);

      if (!product) {
        setFeedback('❌ No encontrado');
        return;
      }

      let price = product.price;
      if (product.batchManagement?.enabled) {
        const batches = await queryBatchesByProductIdAndActive(product.id, true);
        if (batches.length > 0) {
          batches.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          price = batches[0].price;
        }
      }

      const newItem = { ...product, price, quantity: 1 };

      setScannedItems(prev => {
        const exists = prev.find(i => i.id === newItem.id);
        if (exists) {
          return prev.map(i => i.id === newItem.id ? { ...i, quantity: i.quantity + 1 } : i);
        }
        return [...prev, newItem];
      });

      setFeedback(`✅ ${product.name} ($${price})`);

    } catch (error) {
      console.error(error);
      setFeedback('❌ Error');
    }
  };

  const handleConfirm = () => {
    const newOrder = [...currentOrder];
    scannedItems.forEach(item => {
      const existing = newOrder.find(o => o.id === item.id);
      if (existing) existing.quantity += item.quantity;
      else newOrder.push(item);
    });
    setOrder(newOrder);
    handleClose();
  };

  const handleClose = () => {
    setIsScanning(false);
    onClose();
  };

  const total = scannedItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);

  if (!show) return null;

  return (
    // zIndex alto para estar sobre otros modales
    <div className="modal" style={{ display: 'flex', zIndex: 2100 }}>
      <div className={styles.modalContent}>

        <h2 className={styles.header}>Escanear Producto</h2>

        <div className={styles.mainContainer}>

          {/* --- 1. VIDEO --- */}
          <div className={styles.videoContainer}>
            {cameraError ? (
              <div style={{ color: 'white', textAlign: 'center', padding: '20px' }}>
                <p>🚫 {cameraError}</p>
                <small>Verifique los permisos del navegador.</small>
              </div>
            ) : (
              <video ref={ref} className={styles.video} />
            )}

            {feedback && (
              <div className={styles.overlay}>
                <span className={styles.overlayMessage}>{feedback}</span>
              </div>
            )}
          </div>

          {/* --- 2. RESULTADOS (Modo POS) --- */}
          {isPosMode && (
            <div className={styles.resultsContainer}>
              <div className={styles.list}>
                {scannedItems.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-light)', marginTop: '40px' }}>
                    <p style={{ fontSize: '2rem', marginBottom: '10px' }}>📷</p>
                    <p>Apunta al código de barras</p>
                  </div>
                ) : (
                  scannedItems.map(item => (
                    <div key={item.id} className={styles.item}>
                      <strong>{item.name}</strong>
                      <span>x{item.quantity}</span>
                      <strong>${(item.price * item.quantity).toFixed(2)}</strong>
                    </div>
                  ))
                )}
              </div>
              <div className={styles.total}>
                <span>Total:</span>
                <span>${total.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        {/* --- 3. ACCIONES --- */}
        <div className={styles.actions}>
          {isPosMode && (
            <button
              className="btn btn-save"
              onClick={handleConfirm}
              disabled={scannedItems.length === 0}
            >
              Confirmar ({scannedItems.length})
            </button>
          )}
          <button className="btn btn-cancel" onClick={handleClose}>
            Cancelar
          </button>
        </div>

      </div>
    </div>
  );
}