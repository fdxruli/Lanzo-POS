// src/components/common/MessageModal.jsx
import React from 'react';
import { useMessageStore } from '../../store/useMessageStore';
import './MessageModal.css';

export default function MessageModal() {
  // 1. Conectamos al store
  const { isOpen, message, onConfirm, options, hide } = useMessageStore();

  if (!isOpen) {
    return null;
  }

  const confirmMode = typeof onConfirm === 'function';

  // 2. Manejadores de botones que llaman a 'hide'
  const handleConfirm = () => {
    hide();
    onConfirm();
  };

  const handleExtraAction = () => {
    hide();
    options.extraButton.action();
  };

  // 3. HTML de tu 'message-modal' original
  return (
    <div id="message-modal" className="modal" style={{ display: 'flex' }}>
      <div className="modal-content">
        <h2 className="modal-title">Mensaje</h2>
        <p id="modal-message" className="modal-message">{message}</p>
        
        <div className="modal-buttons">
          {options.extraButton && (
            <button className="btn btn-secondary" onClick={handleExtraAction}>
              {options.extraButton.text}
            </button>
          )}

          {confirmMode ? (
            <>
              <button className="btn btn-confirm" onClick={handleConfirm}>
                {/* --- ¡AQUÍ ESTÁ LA CORRECCIÓN! --- */}
                {options.confirmButtonText || 'Sí, continuar'}
              </button>
              <button className="btn btn-cancel" onClick={hide}>
                Cancelar
              </button>
            </>
          ) : (
            <button className="btn btn-modal" onClick={hide}>
              {/* (Opcional) Corregir aquí también para consistencia */}
              {options.confirmButtonText || 'Aceptar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}