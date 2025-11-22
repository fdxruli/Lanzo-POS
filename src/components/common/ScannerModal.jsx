// src/components/common/ScannerModal.jsx - VERSIÓN OPTIMIZADA
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
  const scanCountRef = useRef(0); // Para estadísticas

  // ============================================================
  // 🚀 CONFIGURACIÓN OPTIMIZADA DE REACT-ZXING
  // ============================================================
  const { ref } = useZxing({
    paused: !isScanning,
    
    onDecodeResult(result) {
      const code = result.getText();
      const now = Date.now();
      
      // === ANTI-DUPLICADO MEJORADO ===
      // Ventana de 1.5 segundos para el mismo código
      if (
        lastScannedRef.current.code === code && 
        now - lastScannedRef.current.time < 1500
      ) {
        return; // Ignorar silenciosamente
      }

      // === LOCK DE PROCESAMIENTO ===
      if (processingRef.current) {
        return;
      }

      // Actualizar registro
      lastScannedRef.current = { code, time: now };
      processingRef.current = true;
      scanCountRef.current++;

      // === MODO SIMPLE (Formulario de Productos) ===
      if (onScanSuccess) {
        if (navigator.vibrate) navigator.vibrate(50);
        onScanSuccess(code);
        handleClose(true);
        return;
      }

      // === MODO POS ===
      setIsScanning(false); // Pausar durante procesamiento

      // Feedback inmediato
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]); // Patrón de éxito
      setScanFeedback(`✓ ${code}`);

      // Procesar
      processScannedCode(code);

      // Cooldown optimizado: 600ms (balance perfecto)
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
    
    // ============================================================
    // 🎥 CONSTRAINTS OPTIMIZADAS (LA CLAVE DEL ÉXITO)
    // ============================================================
    constraints: {
      video: {
        facingMode: 'environment', // Cámara trasera
        
        // === RESOLUCIÓN ADAPTATIVA ===
        // Alta resolución mejora detección en superficies curvas/reflectantes
        width: { 
          min: 640,
          ideal: 1920,
          max: 1920 
        },
        height: { 
          min: 480,
          ideal: 1080,
          max: 1080 
        },
        
        // === ENFOQUE CONTINUO (CRÍTICO) ===
        // Permite leer códigos en movimiento y diferentes distancias
        focusMode: { ideal: 'continuous' },
        
        // === ASPECT RATIO ===
        aspectRatio: { ideal: 16/9 },
        
        // === FRAME RATE OPTIMIZADO ===
        // 30 FPS es suficiente y consume menos batería que 60
        frameRate: { ideal: 30, max: 30 }
      },
      
      // === CONFIGURACIÓN DE AUDIO ===
      audio: false // Deshabilitamos audio explícitamente
    },
    
    // ============================================================
    // ⚡ HINTS DE DECODIFICACIÓN (PRIORIDAD DE FORMATOS)
    // ============================================================
    hints: new Map([
      // Formatos más comunes en retail (priorizados)
      [2, [
        'EAN_13',      // Más común (productos internacionales)
        'EAN_8',       // Productos pequeños
        'UPC_A',       // Estados Unidos
        'UPC_E',       // UPC compacto
        'CODE_128',    // Logística/almacenes
        'CODE_39',     // Industrial
        'ITF',         // Cajas/pallets
        'CODABAR',     // Farmacias/bibliotecas
        'QR_CODE'      // QR (opcional)
      ]]
    ]),
    
    // ============================================================
    // 🎯 TIMING OPTIMIZADO
    // ============================================================
    timeBetweenDecodingAttempts: 100, // 100ms = 10 intentos/segundo (óptimo)
  });

  // === LIMPIEZA AL DESMONTAR ===
  useEffect(() => {
    return () => {
      lastScannedRef.current = { code: null, time: 0 };
      processingRef.current = false;
      scanCountRef.current = 0;
    };
  }, []);

  // === SOLICITUD DE PERMISOS DE CÁMARA ===
  useEffect(() => {
    if (show) {
      setIsScanning(false);
      setCameraError(null);
      lastScannedRef.current = { code: null, time: 0 };
      processingRef.current = false;

      const timer = setTimeout(async () => {
        try {
          // Solicitar permisos con las mismas constraints optimizadas
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
              facingMode: 'environment',
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            }
          });
          
          // Cerrar stream de prueba
          stream.getTracks().forEach(track => track.stop());
          
          setIsScanning(true);
        } catch (error) {
          console.error('Error accediendo a cámara:', error);
          
          if (error.name === 'NotAllowedError') {
            setCameraError('❌ Permiso de cámara denegado. Ve a Configuración → Permisos.');
          } else if (error.name === 'NotFoundError') {
            setCameraError('❌ No se detectó ninguna cámara en este dispositivo.');
          } else if (error.name === 'OverconstrainedError') {
            setCameraError('⚠️ Cámara no soporta alta resolución. Intentando modo compatible...');
            // Reintentar con resolución más baja
            setTimeout(() => window.location.reload(), 2000);
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
  // 📦 PROCESAMIENTO DE CÓDIGO ESCANEADO (CORRECCIÓN CRÍTICA)
  // ============================================================
  const processScannedCode = async (code) => {
    try {
      const menu = await loadData(STORES.MENU);
      const product = menu.find(p => p.barcode === code && p.isActive !== false);

      if (product) {
        // ✅ CORRECCIÓN: Aseguramos que siempre haya un precio válido
        const safeProduct = {
          ...product,
          // Si price es NaN o undefined, usamos 0 como fallback
          price: (typeof product.price === 'number' && !isNaN(product.price)) 
            ? product.price 
            : 0,
          // También aseguramos que cost sea válido (evita NaN en cálculos posteriores)
          cost: (typeof product.cost === 'number' && !isNaN(product.cost))
            ? product.cost
            : 0,
          // Aseguramos stock válido
          stock: (typeof product.stock === 'number' && !isNaN(product.stock))
            ? product.stock
            : 0
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
        
        setScanFeedback(`✅ ${safeProduct.name}`);
      } else {
        console.warn(`Código ${code} no encontrado en inventario.`);
        setScanFeedback(`⚠️ No encontrado: ${code}`);
        
        // Auto-ocultar mensaje de error
        setTimeout(() => setScanFeedback(''), 2000);
      }
    } catch (error) {
      console.error('Error procesando código:', error);
      setScanFeedback('❌ Error al buscar producto');
      setTimeout(() => setScanFeedback(''), 2000);
    }
  };

  // ============================================================
  // ✅ CONFIRMAR Y AGREGAR AL CARRITO
  // ============================================================
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

  // ============================================================
  // 🚪 CERRAR MODAL
  // ============================================================
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

  // === CÁLCULO DEL TOTAL ===
  const totalScaneado = scannedItems.reduce(
    (sum, item) => sum + (item.price * item.quantity), 
    0
  );

  if (!show) {
    return null;
  }

  // ============================================================
  // 🎨 RENDER
  // ============================================================
  return (
    <div id="scanner-modal" className="modal" style={{ display: 'flex' }}>
      <div className={`modal-content scanner-modal-content ${mode === 'pos' ? 'pos-scan-mode' : 'simple-scan-mode'}`}>
        <h2 className="modal-title">
          Escanear Códigos {scanCountRef.current > 0 && `(${scanCountRef.current})`}
        </h2>

        <div className="scanner-main-container">
          {/* === VISOR DE CÁMARA === */}
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
                  ref={ref} 
                  id="scanner-video"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }}
                />

                {/* === OVERLAY DE FEEDBACK === */}
                {scanFeedback && (
                  <div className="scan-feedback-overlay">
                    <div className="scan-feedback-message">
                      {scanFeedback}
                    </div>
                  </div>
                )}

                {/* === GUÍA VISUAL (RETÍCULA) === */}
                <div className="scanner-reticle" style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '70%',
                  height: '40%',
                  border: '3px solid rgba(0, 255, 0, 0.5)',
                  borderRadius: '12px',
                  pointerEvents: 'none',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.3)'
                }}>
                  <div style={{
                    position: 'absolute',
                    bottom: '-30px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    color: 'white',
                    fontSize: '0.9rem',
                    textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                    whiteSpace: 'nowrap'
                  }}>
                    📷 Centra el código aquí
                  </div>
                </div>
              </>
            )}
          </div>

          {/* === LISTA DE PRODUCTOS ESCANEADOS === */}
          <div className="scanner-results-container">
            <h3 className="subtitle">Carrito Temporal</h3>

            <div className="scanned-items-list">
              {scannedItems.length === 0 ? (
                <p className="empty-message" style={{ padding: '2rem 0' }}>
                  Escanea tu primer producto
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

            {/* === TOTAL === */}
            <div className="scanner-total-container">
              <span>Total:</span>
              <span>${totalScaneado.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* === BOTONES DE ACCIÓN === */}
        <div className="scanner-actions">
          <button
            className="btn btn-process"
            onClick={handleConfirmScan}
            disabled={scannedItems.length === 0}
          >
            ✅ Confirmar ({scannedItems.length})
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

