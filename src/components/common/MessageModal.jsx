// src/components/common/MessageModal.jsx
import React, { useState } from 'react'; // <--- Agregamos useState
import { useMessageStore } from '../../store/useMessageStore';
import './MessageModal.css';

export default function MessageModal() {
  const { isOpen, message, onConfirm, options = {}, hide } = useMessageStore();
  
  // --- ESTADO LOCAL PARA EL TOAST DE ALERTA ---
  const [toastMsg, setToastMsg] = useState(null);

  if (!isOpen) {
    return null;
  }

  // Lógica de seguridad: Si showCancel es false, isDismissible también es false por defecto
  const showCancel = options.showCancel !== false;     
  const isDismissible = options.isDismissible !== undefined 
      ? options.isDismissible 
      : showCancel; 

  const confirmMode = typeof onConfirm === 'function';

  // Helper para mostrar el mensajito temporal
  const showLocalToast = (text) => {
    setToastMsg(text);
    // Se borra a los 2 segundos
    setTimeout(() => setToastMsg(null), 2000);
  };

  const handleConfirm = () => {
    if (onConfirm) onConfirm();
    hide();
  };

  const handleExtraAction = () => {
    hide();
    if (options.extraButton?.action) options.extraButton.action();
  };

  // --- MANEJO DEL CLIC AFUERA (CON EFECTOS) ---
  const handleBackdropClick = () => {
    if (isDismissible) {
      hide();
    } else {
      // 1. EFECTO VISUAL: Temblor (Shake)
      const modalContent = document.querySelector('.modal-content');
      if (modalContent) {
        // Pequeño zoom y regreso rápido para simular golpe
        modalContent.style.transition = 'transform 0.1s';
        modalContent.style.transform = 'scale(1.02)';
        
        setTimeout(() => {
            modalContent.style.transform = 'scale(1)';
        }, 100);
      }

      // 2. FEEDBACK VISUAL: Mostrar Toast
      showLocalToast('⚠️ Selecciona una opción para continuar');
    }
  };

  return (
    <div 
      id="message-modal" 
      className="modal" 
      style={{ display: 'flex' }}
      onClick={handleBackdropClick} 
    >
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2 className={`modal-title ${options.type || ''}`}>
            {options.title || 'Mensaje'}
        </h2>
        
        <p id="modal-message" className="modal-message" style={{ whiteSpace: 'pre-line' }}>
            {message}
        </p>
        
        <div className="modal-buttons">
          {options.extraButton && (
            <button className="btn btn-secondary" onClick={handleExtraAction}>
              {options.extraButton.text}
            </button>
          )}

          {confirmMode ? (
            <>
              <button className="btn btn-confirm" onClick={handleConfirm}>
                {options.confirmButtonText || 'Sí, continuar'}
              </button>

              {showCancel && (
                <button className="btn btn-cancel" onClick={hide}>
                  Cancelar
                </button>
              )}
            </>
          ) : (
            <button className="btn btn-modal" onClick={hide}>
              Aceptar
            </button>
          )}
        </div>
      </div>

      {/* --- RENDERIZADO DEL TOAST --- */}
      {toastMsg && (
        <div style={{
          position: 'fixed',
          bottom: '15%', // Un poco más arriba para que se note sobre el modal
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          color: 'white',
          padding: '12px 24px',
          borderRadius: '30px',
          zIndex: 999999, // IMPORTANTE: Mayor que el z-index del modal (20000)
          boxShadow: '0 4px 15px rgba(0,0,0,0.4)',
          fontSize: '0.95rem',
          fontWeight: '500',
          animation: 'fadeIn 0.2s ease-out',
          pointerEvents: 'none', // Para que no interfiera con clics
          whiteSpace: 'nowrap'
        }}>
          {toastMsg}
        </div>
      )}
    </div>
  );
}