// src/components/common/ScannerModal.jsx
import React, { useState, useEffect } from 'react';
import { useZxing } from 'react-zxing';
// 1. Importa el store REAL desde la ruta correcta
import { useOrderStore } from '../../store/useOrderStore';
// 2. Importa la base de datos REAL
import { loadData, STORES } from '../../services/database';
// 3. Importa los estilos REALES
import './ScannerModal.css';

// 4. (Se eliminaron las funciones simuladas de 'useOrderStore' y 'loadData')

export default function ScannerModal({ show, onClose }) {
  // 5. Conectamos al store REAL
  const currentOrder = useOrderStore((state) => state.order);
  const setOrder = useOrderStore((state) => state.setOrder);

  const [scannedItems, setScannedItems] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [scanFeedback, setScanFeedback] = useState('');

  const { ref } = useZxing({
    paused: !isScanning || !!isProcessing,
    onDecodeResult(result) {

      if (isProcessing) return; // Evitar múltiples procesos simultáneos

      setProcessing(true);
      setIsScanning(false); // Pausar el escáner durante el procesamiento

      const code = result.getText();
      
      // ¡Nueva lógica!
      
      // 1. Pausar el escáner inmediatamente
      setIsScanning(false);
      
      // 2. Dar feedback visual y físico
      if (navigator.vibrate) navigator.vibrate(100);
      setScanFeedback(`✓ Escaneado: ${code}`);

      // 3. Procesar el código (añadirlo a la lista)
      processScannedCode(code);

      // 4. Establecer un "cooldown" antes de reactivar el escáner
      setTimeout(() => {
        setIsScanning(true); // Reactivar el escáner
        setIsProcessing(false);
        setScanFeedback(''); // Limpiar el mensaje de feedback
      }, 1000); // <-- ¡Cooldown de 1.5 segundos! Puedes ajustar este valor
    },
    onError(error) {
      console.error('Error de ZXing:', error);
      setCameraError('Error al leer códigos. Verifica tu cámara.');
    },
    constraints: {
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        focusMode: 'continuous'
      }
    },
    timeBetweenDecodingAttempts: 300 // Tiempo entre intentos de escaneo
  });

  // Efecto para solicitar permisos de cámara
  useEffect(() => {
    if (show) {
      setIsScanning(false);
      setCameraError(null);
      
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
   * Procesa el código usando la base de datos REAL
   */
  const processScannedCode = async (code) => {
    // 6. Usa la función 'loadData' REAL
    const menu = await loadData(STORES.MENU);
    const product = menu.find(p => p.barcode === code && p.isActive !== false);

    if (product) {
      // Actualiza la lista local 'scannedItems'
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
      setScanFeedback(`⚠️ Producto no encontrado: ${code}`);
      setTimeout(() => setScanFeedback(''), 3000);
    }
  };

  /**
   * Confirma y añade los items al store REAL
   */
  const handleConfirmScan = () => {
    const newOrder = [...currentOrder]; // Pedido actual REAL

    scannedItems.forEach(scannedItem => {
      const existingInOrder = newOrder.find(item => item.id === scannedItem.id);
      if (existingInOrder) {
        // Asumimos que si es por unidad, sumamos. Si es a granel, lo reemplazamos
        if (existingInOrder.saleType === 'unit') {
          existingInOrder.quantity += scannedItem.quantity;
        } else {
          // Si ya existe un item a granel, el escáner no debería sumarlo,
          // pero por seguridad, no hacemos nada.
        }
      } else {
        newOrder.push(scannedItem);
      }
    });

    // 7. Llama a la acción 'setOrder' REAL
    setOrder(newOrder);
    handleClose(true); // Cierra sin preguntar
  };

  /**
   * Cierra el modal
   */
  const handleClose = (force = false) => {
    if (!force && scannedItems.length > 0) {
      if (!window.confirm('¿Cerrar sin agregar los productos escaneados?')) {
        return;
      }
    }
    
    setScannedItems([]);
    setIsScanning(false);
    setCameraError(null);
    setScanFeedback('');
    onClose();
  };

  const totalScaneado = scannedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  if (!show) {
    return null;
  }

  // 8. RENDER (JSX)
  // Reemplazamos todos los 'style' por 'className' de tu archivo .css
  return (
    <div id="scanner-modal" className="modal" style={{ display: 'flex' }}>
      <div className="modal-content scanner-modal-content pos-scan-mode">
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
                
                {/* --- ¡AQUÍ ESTABA EL ERROR! --- 
                  La línea <div id="scanner-overlay" /> se ha eliminado.
                  react-zxing maneja sus propios visuales.
                */}
                
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