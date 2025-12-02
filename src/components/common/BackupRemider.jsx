import React, { useState, useEffect } from 'react';
import { downloadBackupSmart } from '../../services/dataTransfer';
import { useProductStore } from '../../store/useProductStore'; // <-- Importamos para verificar volumen de datos
import './MessageModal.css';

export default function BackupReminder() {
  const [show, setShow] = useState(false);
  const [daysSince, setDaysSince] = useState(0);

  // Leemos cuántos productos hay en el sistema
  const products = useProductStore((state) => state.menu);

  useEffect(() => {
    const checkBackupStatus = () => {
      // 1. REGLA DE "INTELIGENCIA": 
      // Si el usuario tiene menos de 10 productos, no lo molestamos con modales.
      if (!products || products.length < 10) {
        return;
      }

      const lastBackup = localStorage.getItem('last_backup_date');

      // Caso A: Nunca ha hecho respaldo, pero ya tiene datos (>10 productos)
      if (!lastBackup) {
        // Le damos un pequeño margen de "gracia" simulado o mostramos aviso inicial
        // Aquí asumimos que si ya trabajó tanto, debe respaldar.
        setShow(true);
        return;
      }

      // Caso B: Ya ha hecho respaldo, verificamos el tiempo
      const diffTime = Math.abs(Date.now() - new Date(lastBackup).getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays > 7) { // 7 días de límite
        setDaysSince(diffDays);
        setShow(true);
      }
    };

    // Verificamos SOLO al montar el componente (al recargar la página o entrar a la app).
    // Quitamos el setInterval para no interrumpir el flujo de trabajo cada hora.
    const timer = setTimeout(checkBackupStatus, 2000); // Esperamos 2s para no chocar con la carga inicial

    return () => clearTimeout(timer);
  }, [products]); // Se vuelve a verificar si la lista de productos cambia drásticamente, pero el flag 'show' lo controla.

  const handleBackup = async () => {
    try {
      // CAMBIO AQUÍ: Usamos la función optimizada
      await downloadBackupSmart();

      // Guardar fecha actual
      localStorage.setItem('last_backup_date', new Date().toISOString());
      setShow(false);
    } catch (error) {
      console.error(error); // Es bueno loguear el error
      alert("Error al generar respaldo. Intenta de nuevo.");
    }
  };

  if (!show) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 10000 }}>
      <div className="modal-content" style={{ borderLeft: '6px solid var(--warning-color)' }}>
        <h2 style={{ color: 'var(--text-dark)' }}>⚠️ Protege tu Trabajo</h2>
        <p>
          {daysSince > 0
            ? `Han pasado ${daysSince} días desde tu último respaldo.`
            : "Detectamos que has agregado información valiosa pero aún no tienes una copia de seguridad."}
        </p>
        <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '20px' }}>
          Recuerda que toda la información vive <strong>solo en este dispositivo</strong>.
          Haz una copia ahora para evitar perder tu inventario.
        </p>

        <button
          className="btn btn-save"
          onClick={handleBackup}
          style={{ width: '100%', padding: '15px', fontWeight: 'bold' }}
        >
          ⬇️ Descargar Respaldo Ahora
        </button>

        {/* Opción de posponer */}
        <button
          onClick={() => setShow(false)}
          style={{
            background: 'none', border: 'none', color: '#999',
            marginTop: '15px', width: '100%', textDecoration: 'underline', cursor: 'pointer'
          }}
        >
          Recordármelo mañana
        </button>
      </div>
    </div>
  );
}