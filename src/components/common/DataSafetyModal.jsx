import React, { useState, useEffect } from 'react';
import { tryEnablePersistence } from '../../services/utils';
import './MessageModal.css'; // Reusamos estilos existentes

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
    <div className="modal" style={{ display: 'flex', zIndex: 9999 }}>
      <div className="modal-content" style={{ borderLeft: '6px solid var(--error-color)', maxWidth: '550px' }}>
        <h2 style={{ color: 'var(--error-color)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          ⚠️ ADVERTENCIA CRÍTICA
        </h2>
        
        <div style={{ margin: '20px 0', fontSize: '1rem', lineHeight: '1.5' }}>
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
            <li style={{ marginBottom: '8px' }}>❌ <strong>NO uses</strong> "Modo Incógnito" o Privado.</li>
            <li>✅ <strong>HAZ COPIAS DE SEGURIDAD</strong> semanales.</li>
          </ul>
          
          {/* CORRECCIÓN: Usamos variable de texto en lugar de #666 */}
          <p style={{ fontSize: '0.9rem', color: 'var(--text-light)' }}>
            Si pierdes tu dispositivo o limpias el navegador, perderás tu inventario y ventas para siempre si no tienes respaldo manual.
          </p>
        </div>

        <button 
          className="btn btn-save" 
          onClick={handleAcknowledge}
          style={{ width: '100%', padding: '15px', fontWeight: 'bold', fontSize: '1.1rem', backgroundColor: 'var(--error-color)' }}
        >
          Entendido, soy responsable de mis datos
        </button>
      </div>
    </div>
  );
}