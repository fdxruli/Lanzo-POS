// src/components/common/ScannerModal.jsx
import React, { useState } from 'react';
import { BarcodeScanner } from 'react-zxing'; // ¡CORRECCIÓN #1!
import { useOrderStore } from '../../store/useOrderStore';
import { loadData, STORES } from '../../services/database';
import './ScannerModal.css';

// props:
// - show: un booleano para mostrar/ocultar el modal
// - onClose: una función para cerrar el modal
export default function ScannerModal({ show, onClose }) {
  const [scannedItems, setScannedItems] = useState([]);
  const [lastCode, setLastCode] = useState('');

  // 1. Conectamos al store de Zustand
  const addMultipleItemsToOrder = useOrderStore((state) => state.setOrder);
  const currentOrder = useOrderStore((state) => state.order);

  // 2. Esta es la función que se llama CADA VEZ que se detecta un código
  const handleScanResult = (result) => {
    if (!result) return;

    const code = result.getText();

    // 3. Lógica de "enfriamiento" (Cooldown) de tu scanner.js
    if (code === lastCode) return; // Mismo código, lo ignoramos
    setLastCode(code);

    // (Opcional) Vibrar al escanear
    if (navigator.vibrate) {
      navigator.vibrate(100);
    }

    // 4. Buscar el producto en la DB
    processScannedCode(code);
  };

  const processScannedCode = async (code) => {
    const menu = await loadData(STORES.MENU); // Carga desde IndexedDB
    const product = menu.find(p => p.barcode === code);

    if (product) {
      setScannedItems(prevItems => {
        const existing = prevItems.find(i => i.id === product.id);
        if (existing) {
          // Aumenta la cantidad si ya está en la lista del modal
          return prevItems.map(i =>
            i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
          );
        }
        // Añade el producto a la lista del modal
        return [...prevItems, { ...product, quantity: 1 }];
      });
    } else {
      // (Aquí usamos tu showMessageModal)
      console.warn(`Producto con código ${code} no encontrado.`);
    }
  };

  // 5. Confirmar y añadir al pedido principal
  const handleConfirmScan = () => {
    // Lógica de 'addMultipleItemsToOrder'
    // Fusionamos la orden actual con los items escaneados
    const newOrder = [...currentOrder];

    scannedItems.forEach(scannedItem => {
      const existingInOrder = newOrder.find(item => item.id === scannedItem.id);
      if (existingInOrder) {
        existingInOrder.quantity += scannedItem.quantity;
      } else {
        newOrder.push(scannedItem);
      }
    });

    // 6. Usamos la acción 'setOrder' del store
    addMultipleItemsToOrder(newOrder);

    // 7. Cerramos y limpiamos
    handleClose();
  };

  const handleClose = () => {
    setScannedItems([]); // Limpia la lista
    setLastCode(''); // Resetea el cooldown
    onClose(); // Llama a la función del padre para cerrar
  };

  // Lógica de UI para el modal (de scanner.js)
  const totalScaneado = scannedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  // Si no se debe mostrar, no renderiza nada
  if (!show) {
    return null;
  }

  // 8. Renderizamos el JSX
  return (
    <div id="scanner-modal" className="modal">
      <div className="modal-content scanner-modal-content pos-scan-mode">
        <h2 className="modal-title">Escanear Productos</h2>
        <div className="scanner-main-container">
          <div className="scanner-video-container">
            <div id="scanner-container">

              {/* ¡AQUÍ ESTÁ LA NUEVA LIBRERÍA! */}
              {/* ¡CORRECCIÓN #2! */}
              <BarcodeScanner
                onResult={handleScanResult}
                onError={(error) => console.log('Error de scanner:', error?.message)}
              />
              {/* No más <video> ni overlay manual */}

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
                    <span className-="quantity-value">{item.quantity}</span>
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