import React, { useState, useEffect } from 'react';
import { tryEnablePersistence } from '../../services/utils';
import './DataSafetyModal.css';

export default function DataSafetyModal() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const checkSafety = async () => {
      // 1. Intentar activar persistencia silenciosamente al cargar
      await tryEnablePersistence();

      // 2. Verificar si el usuario ya vio la advertencia
      const hasAcknowledged = localStorage.getItem('lanzo_data_safety_ack');
      if (!hasAcknowledged) {
        setShow(true);
      }
    };
    checkSafety();
  }, []);

  const handleAcknowledge = () => {
    localStorage.setItem('lanzo_data_safety_ack', 'true');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="ui-modal ui-modal--critical data-safety-modal" role="dialog" aria-modal="true" aria-labelledby="data-safety-title">
      <div className="ui-modal__content ui-modal__content--md data-safety-modal__content">
        <h2 id="data-safety-title" className="ui-modal__title data-safety-modal__title">
          ⚠️ ADVERTENCIA CRÍTICA
        </h2>
        
        <div className="ui-modal__body data-safety-modal__body">
          <p><strong>Tus datos viven SOLAMENTE en este dispositivo.</strong></p>
          <p>Lanzo POS funciona sin internet, pero eso significa que no hay copia automática en la nube.</p>
          
          {/* CORRECCIÓN: Usamos rgba para el fondo (se ve bien en dark/light) y variables para el borde */}
          <ul style={{ 
            backgroundColor: 'rgba(255, 184, 0, 0.15)', /* Amarillo transparente adaptativo */
            border: '1px solid var(--warning-color)',    /* Borde del color de alerta */
            padding: '15px 25px', 
            borderRadius: '8px', 
            margin: '15px 0',
            color: 'var(--text-dark)' /* Texto legible en ambos modos */
          }}>
            <li style={{ marginBottom: '8px' }}>❌ <strong>NO borres</strong> el historial o datos de navegación.</li>
            <li style={{ marginBottom: '8px' }}>❌ <strong>NO uses</strong> &quot;Modo Incognito&quot; o Privado.</li>
            <li>✅ <strong>HAZ COPIAS DE SEGURIDAD</strong> semanales.</li>
          </ul>
          
          {/* CORRECCIÓN: Usamos variable de texto en lugar de #666 */}
          <p className="data-safety-modal__help">
            Si pierdes tu dispositivo o limpias el navegador, perderás tu inventario y ventas para siempre si no tienes respaldo manual.
          </p>
        </div>

        <button 
          type="button"
          className="ui-button ui-button--danger ui-button--block data-safety-modal__action" 
          onClick={handleAcknowledge}
        >
          Entendido, soy responsable de mis datos
        </button>
      </div>
    </div>
  );
}
