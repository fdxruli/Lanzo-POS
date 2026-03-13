import { useEffect, useState } from 'react';
import {
  BACKUP_ABORT_REASON,
  BACKUP_WARNING_BLOB_PERF,
  downloadBackupSmart
} from '../../services/dataTransfer';
import { useProductStore } from '../../store/useProductStore';
import { useAppStore } from '../../store/useAppStore';
import Logger from '../../services/Logger';
import { showMessageModal } from '../../services/utils';
import './MessageModal.css';

export default function BackupReminder() {
  const [show, setShow] = useState(false);
  const [daysSince, setDaysSince] = useState(0);

  const products = useProductStore((state) => state.menu);
  const isBackupLoading = useAppStore((state) => state.isBackupLoading);
  const setBackupLoading = useAppStore((state) => state.setBackupLoading);

  useEffect(() => {
    const checkBackupStatus = () => {
      if (!products || products.length < 10) {
        return;
      }

      const postponedUntil = localStorage.getItem('backup_postponed_until');
      if (postponedUntil) {
        const datePostponed = new Date(postponedUntil);
        if (new Date() < datePostponed) {
          return;
        }
      }

      const lastBackup = localStorage.getItem('last_backup_date');
      if (!lastBackup) {
        setShow(true);
        return;
      }

      const diffTime = Math.abs(Date.now() - new Date(lastBackup).getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays > 7) {
        setDaysSince(diffDays);
        setShow(true);
      }
    };

    const timer = setTimeout(checkBackupStatus, 3000);
    return () => clearTimeout(timer);
  }, [products]);

  const handleBackup = async () => {
    if (isBackupLoading) return;

    setBackupLoading(true);
    try {
      const result = await downloadBackupSmart();

      if (result.success === true) {
        if (result.warnings?.includes(BACKUP_WARNING_BLOB_PERF)) {
          showMessageModal(
            'Aviso: Respaldo generado en modo compatible (Blob). En bases grandes puede tardar mas.',
            null,
            { type: 'warning' }
          );
        }
        setShow(false);
        return;
      }

      if (result.reason === BACKUP_ABORT_REASON) {
        return;
      }

      throw new Error('Resultado de respaldo no reconocido.');
    } catch (error) {
      Logger.error(error);
      alert('Error al generar respaldo. Intenta de nuevo.');
    } finally {
      setBackupLoading(false);
    }
  };

  const handlePostpone = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    localStorage.setItem('backup_postponed_until', tomorrow.toISOString());
    window.dispatchEvent(new Event('backup_status_changed'));
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 10000 }}>
      <div className="modal-content" style={{ borderLeft: '6px solid var(--warning-color)' }}>
        <h2 style={{ color: 'var(--text-dark)' }}>Protege tu Trabajo</h2>
        <p>
          {daysSince > 0
            ? `Han pasado ${daysSince} dias desde tu ultimo respaldo.`
            : 'Detectamos informacion valiosa pero aun no tienes una copia de seguridad.'}
        </p>
        <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '20px' }}>
          Recuerda que toda la informacion vive <strong>solo en este dispositivo</strong>.
          Haz una copia ahora para evitar perder tu inventario.
        </p>

        <button
          className="btn btn-save"
          onClick={handleBackup}
          disabled={isBackupLoading}
          style={{ width: '100%', padding: '15px', fontWeight: 'bold' }}
        >
          {isBackupLoading ? 'Generando respaldo...' : 'Descargar Respaldo Ahora'}
        </button>

        <button
          onClick={handlePostpone}
          disabled={isBackupLoading}
          style={{
            background: 'none',
            border: 'none',
            color: '#999',
            marginTop: '15px',
            width: '100%',
            textDecoration: 'underline',
            cursor: isBackupLoading ? 'not-allowed' : 'pointer'
          }}
        >
          Recordarmelo manana
        </button>
      </div>
    </div>
  );
}
