import React, { useState, useEffect } from 'react';
import { downloadBackupSmart } from '../../services/dataTransfer';
import { useProductStore } from '../../store/useProductStore';
import './MessageModal.css';

export default function BackupReminder() {
  const [show, setShow] = useState(false);
  const [daysSince, setDaysSince] = useState(0);

  // Leemos cuántos productos hay en el sistema
  const products = useProductStore((state) => state.menu);

  useEffect(() => {
    const checkBackupStatus = () => {
      // 1. REGLA: Si tiene pocos productos, no molestar.
      if (!products || products.length < 10) {
        return;
      }

      // --- CORRECCIÓN 1: Verificar si el usuario lo pospuso ---
      const postponedUntil = localStorage.getItem('backup_postponed_until');
      if (postponedUntil) {
        const datePostponed = new Date(postponedUntil);
        // Si la fecha actual es MENOR a la fecha de posposición, no mostramos nada
        if (new Date() < datePostponed) {
          return; 
        }
      }
      // --------------------------------------------------------

      const lastBackup = localStorage.getItem('last_backup_date');

      // Caso A: Nunca ha hecho respaldo
      if (!lastBackup) {
        setShow(true);
        return;
      }

      // Caso B: Ya ha hecho respaldo, verificamos el tiempo
      const diffTime = Math.abs(Date.now() - new Date(lastBackup).getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays > 7) { 
        setDaysSince(diffDays);
        setShow(true);
      }
    };

    // Verificamos con un pequeño delay para no bloquear el render inicial
    const timer = setTimeout(checkBackupStatus, 3000);

    return () => clearTimeout(timer);
  }, [products]); 

  const handleBackup = async () => {
    try {
      await downloadBackupSmart();
      // Guardar fecha actual del respaldo
      localStorage.setItem('last_backup_date', new Date().toISOString());
      // Limpiamos la posposición porque ya cumplió
      localStorage.removeItem('backup_postponed_until');
      setShow(false);
    } catch (error) {
      console.error(error);
      alert("Error al generar respaldo. Intenta de nuevo.");
    }
  };

  // --- CORRECCIÓN 2: Función para guardar la posposición ---
  const handlePostpone = () => {
    // Calculamos la fecha de mañana
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1); // Sumar 1 día
    
    // Guardamos en LocalStorage
    localStorage.setItem('backup_postponed_until', tomorrow.toISOString());
    
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 10000 }}>
      <div className="modal-content" style={{ borderLeft: '6px solid var(--warning-color)' }}>
        <h2 style={{ color: 'var(--text-dark)' }}>⚠️ Protege tu Trabajo</h2>
        <p>
          {daysSince > 0
            ? `Han pasado ${daysSince} días desde tu último respaldo.`
            : "Detectamos información valiosa pero aún no tienes una copia de seguridad."}
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

        {/* Usamos la nueva función handlePostpone */}
        <button
          onClick={handlePostpone}
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