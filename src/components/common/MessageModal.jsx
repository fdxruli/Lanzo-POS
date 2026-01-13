// src/components/common/MessageModal.jsx
import React from 'react';
import { useMessageStore } from '../../store/useMessageStore'; //
import './MessageModal.css';

export default function MessageModal() {
  // Obtenemos estado y acciones del store
  const { isOpen, message, onConfirm, options = {}, hide } = useMessageStore();

  if (!isOpen) {
    return null;
  }

  // --- LÓGICA DE SEGURIDAD ---
  // Por defecto (si no se especifica), el modal se puede cancelar y cerrar.
  // Pero si options.showCancel es false, ocultamos el botón.
  // Si options.isDismissible es false, bloqueamos el clic fuera.
  const showCancel = options.showCancel !== false;     
  const isDismissible = options.isDismissible !== false; 

  const confirmMode = typeof onConfirm === 'function';

  // Manejar confirmación
  const handleConfirm = () => {
    // Primero ejecutamos la acción (ej. logout)
    if (onConfirm) onConfirm();
    // Luego ocultamos (aunque si es logout, la app se desmontará antes)
    hide();
  };

  // Manejar acción extra (botón secundario opcional)
  const handleExtraAction = () => {
    hide();
    if (options.extraButton?.action) options.extraButton.action();
  };

  // Manejar clic en el fondo oscuro
  const handleBackdropClick = () => {
    if (isDismissible) {
      hide();
    }
  };

  return (
    <div 
      id="message-modal" 
      className="modal" 
      style={{ display: 'flex' }}
      onClick={handleBackdropClick} // Interceptamos clic fuera
    >
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2 className={`modal-title ${options.type || ''}`}>
            {options.title || 'Mensaje'}
        </h2>
        
        <p id="modal-message" className="modal-message" style={{ whiteSpace: 'pre-line' }}>
            {message}
        </p>
        
        <div className="modal-buttons">
          {/* Botón Extra Opcional */}
          {options.extraButton && (
            <button className="btn btn-secondary" onClick={handleExtraAction}>
              {options.extraButton.text}
            </button>
          )}

          {confirmMode ? (
            <>
              {/* BOTÓN CONFIRMAR (Siempre visible, ej: "Cerrar Sesión Ahora") */}
              <button className="btn btn-confirm" onClick={handleConfirm}>
                {options.confirmButtonText || 'Sí, continuar'}
              </button>

              {/* BOTÓN CANCELAR (Solo si showCancel es true) */}
              {showCancel && (
                <button className="btn btn-cancel" onClick={hide}>
                  Cancelar
                </button>
              )}
            </>
          ) : (
            // Modo alerta simple
            <button className="btn btn-modal" onClick={hide}>
              Aceptar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}