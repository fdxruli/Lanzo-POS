import React, { useState, useEffect } from 'react';
import { useZxing } from 'react-zxing';
import { useOrderStore } from '../../stores/orderStore';

// Simulamos el store y servicios para el ejemplo
const useOrderStore = (selector) => {
  const [order, setOrder] = useState([]);
  
  if (selector) {
    const state = {
      order,
      setOrder: (newOrder) => setOrder(newOrder)
    };
    return selector(state);
  }
  return { order, setOrder };
};

// Simulación de base de datos
const STORES = { MENU: 'menu' };
const loadData = async (store) => {
  // Productos de ejemplo con códigos de barras
  return [
    { id: '1', name: 'Coca Cola 600ml', price: 15, barcode: '7501055309146' },
    { id: '2', name: 'Sabritas Original', price: 18, barcode: '7501110501107' },
    { id: '3', name: 'Gansito', price: 12, barcode: '7501000125012' },
  ];
};

export default function ScannerModal({ show, onClose }) {
  const addItemToOrder = useOrderStore((state) => state.addItem);
  const currentOrder = useOrderStore((state) => state.order);
  const [scannedItems, setScannedItems] = useState([]);
  const [lastCode, setLastCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [scanFeedback, setScanFeedback] = useState(''); // Para mostrar qué se escaneó

  const addMultipleItemsToOrder = useOrderStore((state) => state.setOrder);

  // ✅ Configuración correcta de react-zxing
  const { ref } = useZxing({
    paused: !isScanning, // Solo escanea cuando isScanning es true
    onDecodeResult(result) {
      const code = result.getText();
      
      // Cooldown mejorado (1 segundo)
      if (code === lastCode) return;
      setLastCode(code);
      setTimeout(() => setLastCode(''), 1000); // Reset después de 1 seg
      
      // Feedback visual y sonoro
      setScanFeedback(`✓ Código: ${code}`);
      setTimeout(() => setScanFeedback(''), 2000);
      
      if (navigator.vibrate) {
        navigator.vibrate(100);
      }
      
      // Procesar código
      processScannedCode(code);
    },
    onError(error) {
      console.error('Error de ZXing:', error);
      setCameraError('Error al leer códigos. Verifica tu cámara.');
    },
    // ✅ Constraints de la cámara
    constraints: {
      video: {
        facingMode: 'environment', // Cámara trasera en móviles
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    }
  });

  // ✅ Solicitar permisos cuando se abre el modal
  useEffect(() => {
    if (show) {
      setIsScanning(false);
      setCameraError(null);
      
      // Pequeño delay para que el DOM se renderice
      const timer = setTimeout(async () => {
        try {
          // Solicitar permisos explícitamente
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
          });
          
          // Si se obtienen permisos, cerrar el stream de prueba
          stream.getTracks().forEach(track => track.stop());
          
          // Activar el scanner
          setIsScanning(true);
        } catch (error) {
          console.error('Error al acceder a la cámara:', error);
          
          // Mensajes de error específicos
          if (error.name === 'NotAllowedError') {
            setCameraError('❌ Permiso de cámara denegado. Por favor, habilita el acceso en la configuración de tu navegador.');
          } else if (error.name === 'NotFoundError') {
            setCameraError('❌ No se encontró ninguna cámara en tu dispositivo.');
          } else if (error.name === 'NotReadableError') {
            setCameraError('❌ La cámara está siendo usada por otra aplicación.');
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
      setScanFeedback(`⚠️ Producto no encontrado: ${code}`);
      setTimeout(() => setScanFeedback(''), 3000);
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
    // ✅ Confirmación si hay items
    if (scannedItems.length > 0) {
      const confirm = window.confirm('¿Cerrar sin agregar los productos escaneados?');
      if (!confirm) return;
    }
    
    setScannedItems([]);
    setLastCode('');
    setIsScanning(false);
    setCameraError(null);
    setScanFeedback('');
    onClose();
  };

  const totalScaneado = scannedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  if (!show) {
    return null;
  }

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2100,
        padding: '1rem'
      }}
    >
      <div 
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          maxWidth: '900px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: '1.5rem'
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: '1rem', color: '#6366f1' }}>
          Escanear Productos
        </h2>

        <div style={{ 
          display: 'flex', 
          gap: '1.5rem',
          flexWrap: 'wrap'
        }}>
          {/* Contenedor del Video */}
          <div style={{ flex: '1 1 400px', minWidth: 0 }}>
            <div style={{
              position: 'relative',
              width: '100%',
              backgroundColor: '#000',
              borderRadius: '8px',
              overflow: 'hidden',
              aspectRatio: '4/3'
            }}>
              {cameraError ? (
                // ✅ Mensaje de error amigable
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  padding: '2rem',
                  textAlign: 'center',
                  fontSize: '0.9rem'
                }}>
                  <p style={{ marginBottom: '1rem' }}>{cameraError}</p>
                  <button
                    onClick={() => {
                      setCameraError(null);
                      setIsScanning(true);
                    }}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: '#6366f1',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    Reintentar
                  </button>
                </div>
              ) : (
                <>
                  {/* ✅ Video con ref correcto */}
                  <video
                    ref={ref}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                  />
                  
                  {/* Overlay con guía de escaneo */}
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none'
                  }}>
                    <div style={{
                      width: '80%',
                      height: '40%',
                      border: '3px solid #10b981',
                      borderRadius: '12px',
                      boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)'
                    }} />
                  </div>

                  {/* Texto de ayuda */}
                  <div style={{
                    position: 'absolute',
                    top: '10%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    color: 'white',
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    fontSize: '0.9rem'
                  }}>
                    Coloca el código aquí
                  </div>

                  {/* ✅ Feedback de escaneo */}
                  {scanFeedback && (
                    <div style={{
                      position: 'absolute',
                      bottom: '10%',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      backgroundColor: 'rgba(16, 185, 129, 0.9)',
                      color: 'white',
                      padding: '0.5rem 1rem',
                      borderRadius: '6px',
                      fontSize: '0.9rem',
                      fontWeight: 'bold',
                      animation: 'fadeIn 0.3s'
                    }}>
                      {scanFeedback}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Indicador de estado */}
            <div style={{
              marginTop: '0.5rem',
              padding: '0.5rem',
              backgroundColor: isScanning ? '#d1fae5' : '#fee2e2',
              color: isScanning ? '#065f46' : '#991b1b',
              borderRadius: '6px',
              textAlign: 'center',
              fontSize: '0.85rem'
            }}>
              {isScanning ? '🟢 Escaneando...' : '🔴 Cámara detenida'}
            </div>
          </div>

          {/* Lista de productos escaneados */}
          <div style={{ flex: '1 1 300px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem' }}>
              Productos Escaneados
            </h3>
            
            <div style={{
              maxHeight: '300px',
              overflowY: 'auto',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              marginBottom: '1rem'
            }}>
              {scannedItems.length === 0 ? (
                <p style={{ 
                  textAlign: 'center', 
                  color: '#9ca3af',
                  padding: '2rem',
                  fontStyle: 'italic' 
                }}>
                  Aún no hay productos escaneados.
                </p>
              ) : (
                scannedItems.map(item => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.75rem',
                      borderBottom: '1px solid #f3f4f6'
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '500', marginBottom: '0.25rem' }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                        ${item.price.toFixed(2)} c/u
                      </div>
                    </div>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center',
                      gap: '0.5rem' 
                    }}>
                      <span style={{ fontWeight: '600' }}>x{item.quantity}</span>
                      <span style={{ 
                        color: '#6366f1', 
                        fontWeight: '600',
                        minWidth: '60px',
                        textAlign: 'right'
                      }}>
                        ${(item.price * item.quantity).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Total */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1rem',
              backgroundColor: '#f9fafb',
              borderRadius: '6px',
              marginBottom: '1rem'
            }}>
              <span style={{ fontWeight: '600', fontSize: '1.1rem' }}>
                Total:
              </span>
              <span style={{ 
                fontSize: '1.5rem', 
                fontWeight: '700',
                color: '#6366f1'
              }}>
                ${totalScaneado.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Botones */}
        <div style={{ 
          display: 'flex', 
          gap: '1rem',
          marginTop: '1.5rem',
          flexWrap: 'wrap'
        }}>
          <button
            onClick={handleConfirmScan}
            disabled={scannedItems.length === 0}
            style={{
              flex: '1 1 200px',
              padding: '0.75rem 1.5rem',
              backgroundColor: scannedItems.length > 0 ? '#10b981' : '#9ca3af',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontWeight: '600',
              cursor: scannedItems.length > 0 ? 'pointer' : 'not-allowed',
              fontSize: '1rem'
            }}
          >
            Confirmar y Agregar ({scannedItems.length})
          </button>
          <button
            onClick={handleClose}
            style={{
              flex: '1 1 150px',
              padding: '0.75rem 1.5rem',
              backgroundColor: 'transparent',
              color: '#6b7280',
              border: '2px solid #e5e7eb',
              borderRadius: '8px',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '1rem'
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
