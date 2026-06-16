// src/components/common/MessageModal.jsx
import { useState } from 'react';
import { useMessageStore } from '../../store/useMessageStore';
import './MessageModal.css';

export default function MessageModal() {
  const { isOpen, message, onConfirm, options = {}, hide } = useMessageStore();
  
  // --- ESTADO LOCAL PARA EL TOAST DE ALERTA Y ANIMACIÓN ---
  const [toastMsg, setToastMsg] = useState(null);
  const [showShake, setShowShake] = useState(false);

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

  const handleCancel = () => {
    hide();
    if (options.onCancel) options.onCancel();
  };

  const handleExtraAction = () => {
    hide();
    if (options.extraButton?.action) options.extraButton.action();
  };

  // --- MANEJO DEL CLIC AFUERA (CON EFECTOS) ---
  const handleBackdropClick = () => {
    if (isDismissible) {
      handleCancel();
    } else {
      // 1. EFECTO VISUAL: Shake animation via React state + CSS
      setShowShake(true);
      setTimeout(() => setShowShake(false), 150);

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
      <div className={`modal-content ${showShake ? 'shake-animation' : ''}`} onClick={(e) => e.stopPropagation()}>
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
                <button className="btn btn-cancel" onClick={handleCancel}>
                  {options.cancelButtonText || 'Cancelar'}
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
          zIndex: 'var(--z-toast)',
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
