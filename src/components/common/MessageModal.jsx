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
      className="ui-modal ui-modal--critical" 
      style={{ display: 'flex' }}
      onClick={handleBackdropClick} 
    >
      <div className={`ui-modal__content ui-modal__content--sm ${showShake ? 'shake-animation' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h2 className={`ui-modal__title ${options.type || ''}`}>
            {options.title || 'Mensaje'}
        </h2>
        
        <p id="modal-message" className="modal-message" style={{ whiteSpace: 'pre-line' }}>
            {message}
        </p>
        
        <div className="ui-modal__actions modal-buttons">
          {options.extraButton && (
            <button type="button" className="ui-button ui-button--secondary btn-secondary" onClick={handleExtraAction}>
              {options.extraButton.text}
            </button>
          )}

          {confirmMode ? (
            <>
              <button type="button" className="ui-button ui-button--primary btn-confirm" onClick={handleConfirm}>
                {options.confirmButtonText || 'Sí, continuar'}
              </button>

              {showCancel && (
                <button type="button" className="ui-button ui-button--ghost btn-cancel" onClick={handleCancel}>
                  {options.cancelButtonText || 'Cancelar'}
                </button>
              )}
            </>
          ) : (
            <button type="button" className="ui-button ui-button--primary btn-modal" onClick={hide}>
              Aceptar
            </button>
          )}
        </div>
      </div>

      {/* --- RENDERIZADO DEL TOAST --- */}
      {toastMsg && (
        <div className="message-modal-local-toast">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
