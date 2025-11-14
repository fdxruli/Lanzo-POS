// src/components/common/ScannerModal.jsx
import React, { useState, useRef } from 'react';
import { useZxing } from 'react-zxing';
import { useOrderStore } from '../../store/useOrderStore';
import { loadData, STORES } from '../../services/database';
import './ScannerModal.css';

export default function ScannerModal({ show, onClose }) {
  const [scannedItems, setScannedItems] = useState([]);
  const [lastCode, setLastCode] = useState('');

  const addMultipleItemsToOrder = useOrderStore((state) => state.setOrder);
  const currentOrder = useOrderStore((state) => state.order);

  // Hook de react-zxing
  const { ref } = useZxing({
    onDecodeResult(result) {
      const code = result.getText();
      
      // Cooldown
      if (code === lastCode) return;
      setLastCode(code);
      
      // Vibrar
      if (navigator.vibrate) {
        navigator.vibrate(100);
      }
      
      // Procesar código
      processScannedCode(code);
    },
  });

  const processScannedCode = async (code) => {
    const menu = await loadData(STORES.MENU);
    const product = menu.find(p => p.barcode === code);

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
    } else {
      console.warn(`Producto con código ${code} no encontrado.`);
    }
  };

  const handleConfirmScan = () => {
    const newOrder = [...currentOrder];

    scannedItems.forEach(scannedItem => {
      const existingInOrder = newOrder.find(item => item.id === scannedItem.id);
      if (existingInOrder) {
        existingInOrder.quantity += scannedItem.quantity;
      } else {
        newOrder.push(scannedItem);
      }
    });

    addMultipleItemsToOrder(newOrder);
    handleClose();
  };

  const handleClose = () => {
    setScannedItems([]);
    setLastCode('');
    onClose();
  };

  const totalScaneado = scannedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  if (!show) {
    return null;
  }

  return (
    <div id="scanner-modal" className="modal">
      <div className="modal-content scanner-modal-content pos-scan-mode">
        <h2 className="modal-title">Escanear Productos</h2>
        <div className="scanner-main-container">
          <div className="scanner-video-container">
            <div id="scanner-container">
              {/* Video element controlado por useZxing */}
              <video ref={ref} style={{ width: '100%', height: '100%' }} />
            </div>
          </div>
          <div className="scanner-results-container">
            <h3 className="subtitle">Productos Escaneados</h3>
            <div id="scanned-items-list" className="scanned-items-list">
              {scannedItems.length === 0 ? (
                <p className="empty-message">Aún no hay productos escaneados.</p>
              ) : (
                scannedItems.map(item => (
                  <div key={item.id} className="scanned-item">
                    <span className="scanned-item-name">{item.name}</span>
                    <span className="quantity-value">{item.quantity}</span>
                    <span className="scanned-item-price">${(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="scanner-total-container">
              <span className="total-label">Total Escaneado:</span>
              <span id="scanner-total" className="total-amount">${totalScaneado.toFixed(2)}</span>
            </div>
          </div>
        </div>
        <div className="scanner-actions">
          <button id="confirm-scan-btn" className="btn btn-process" onClick={handleConfirmScan}>
            Confirmar y Agregar
          </button>
          <button id="close-scanner-btn" className="btn btn-cancel" onClick={handleClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
