/**
 * BackupReminder - Modal de recordatorio de respaldo
 *
 * Se activa automáticamente cuando:
 * - Han pasado 3+ días sin respaldo (en modo volátil, sin persistencia garantizada)
 * - Han pasado 7+ días sin respaldo (en modo persistente/seguro)
 * - No existe ningún respaldo previo y hay datos relevantes
 *
 * El usuario puede confirmar el respaldo o posponerlo 1 día.
 * El respaldo siempre pide confirmación antes de descargar.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  BACKUP_ABORT_REASON,
  BACKUP_WARNING_BLOB_PERF,
  downloadBackupSmart,
} from '../../services/dataTransfer';
import { useProductStore } from '../../store/useProductStore';
import { useAppStore } from '../../store/useAppStore';
import usePersistentStorage from '../../hooks/usePersistentStorage';
import Logger from '../../services/Logger';
import { showMessageModal } from '../../services/utils';
import './MessageModal.css';

// Días de gracia según el nivel de riesgo
const DAYS_VOLATILE  = 3; // Modo sin persistencia garantizada → más urgente
const DAYS_SAFE      = 7; // Modo persistente → más tolerante

export default function BackupReminder() {
  const [show, setShow]           = useState(false);
  const [daysSince, setDaysSince] = useState(0);
  const [urgencyLevel, setUrgencyLevel] = useState('normal'); // 'normal' | 'urgent'

  const products         = useProductStore((state) => state.menu);
  const isBackupLoading  = useAppStore((state) => state.isBackupLoading);
  const setBackupLoading = useAppStore((state) => state.setBackupLoading);

  // Conocer el estado real de persistencia para ajustar el umbral
  const { isVolatile, persistenceState } = usePersistentStorage();

  const checkBackupStatus = useCallback(() => {
    // No molestar si la base de datos está prácticamente vacía
    if (!products || products.length < 5) return;

    // Verificar si hay un posponer activo
    const postponedUntil = localStorage.getItem('backup_postponed_until');
    if (postponedUntil && new Date() < new Date(postponedUntil)) return;

    const lastBackup = localStorage.getItem('last_backup_date');

    // Sin ningún respaldo previo → urgente en cualquier modo
    if (!lastBackup) {
      setUrgencyLevel(isVolatile ? 'urgent' : 'normal');
      setShow(true);
      return;
    }

    const diffMs   = Date.now() - new Date(lastBackup).getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    // Umbral según modo de persistencia
    const threshold = isVolatile ? DAYS_VOLATILE : DAYS_SAFE;

    if (diffDays >= threshold) {
      setDaysSince(diffDays);
      setUrgencyLevel(isVolatile ? 'urgent' : 'normal');
      setShow(true);
    }
  }, [products, isVolatile]);

  useEffect(() => {
    // Pequeño delay para no interferir con el arranque de la app
    const timer = setTimeout(checkBackupStatus, 4000);
    return () => clearTimeout(timer);
  }, [checkBackupStatus]);

  // Re-evaluar si cambia el estado de persistencia (ej: se concede tras arrancar)
  useEffect(() => {
    if (show) checkBackupStatus();
  }, [persistenceState]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBackup = useCallback(async () => {
    if (isBackupLoading) return;

    setBackupLoading(true);
    try {
      const result = await downloadBackupSmart();

      if (result.success === true) {
        if (result.warnings?.includes(BACKUP_WARNING_BLOB_PERF)) {
          Logger.warn('Respaldo generado en modo compatible (Blob). Puede tardar más en bases grandes.');
        }
        Logger.info('✅ Respaldo completado correctamente desde BackupReminder');
        setShow(false);
        return;
      }

      if (result.reason === BACKUP_ABORT_REASON) {
        // El usuario canceló el diálogo de guardado — no hacer nada
        return;
      }

      throw new Error('Resultado de respaldo no reconocido.');
    } catch (error) {
      Logger.error('Error generando respaldo:', error);
      showMessageModal('Error al generar el respaldo. Intenta de nuevo o ve a Configuración → Respaldo.', null, { type: 'error' });
    } finally {
      setBackupLoading(false);
    }
  }, [isBackupLoading, setBackupLoading]);

  const handlePostpone = useCallback(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    localStorage.setItem('backup_postponed_until', tomorrow.toISOString());
    window.dispatchEvent(new Event('backup_status_changed'));
    setShow(false);
  }, []);

  if (!show) return null;

  const isUrgent = urgencyLevel === 'urgent';

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 10000 }}>
      <div
        className="modal-content"
        style={{ borderLeft: `6px solid ${isUrgent ? '#dc2626' : '#f59e0b'}` }}
      >
        <h2 style={{ color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isUrgent ? '🚨' : '💾'} Protege tu Trabajo
        </h2>

        <p>
          {daysSince > 0
            ? `Han pasado ${daysSince} días desde tu último respaldo.`
            : 'No tienes ninguna copia de seguridad. Tus datos aún no están protegidos.'}
        </p>

        {isUrgent && (
          <p style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            padding: '0.75rem',
            fontSize: '0.9rem',
            color: '#991b1b',
            marginTop: '0.5rem',
          }}>
            ⚠️ <strong>Modo de riesgo activo:</strong> Tus datos no tienen persistencia garantizada.
            Si el navegador libera espacio, podrías perder todo sin posibilidad de recuperación.
            Haz un respaldo ahora.
          </p>
        )}

        <p style={{ fontSize: '0.88rem', color: '#666', margin: '0.75rem 0 1.25rem' }}>
          Toda la información vive <strong>solo en este dispositivo</strong>.
          Un respaldo es tu única red de seguridad.
        </p>

        <button type="button"
          id="backup-reminder-download-btn"
          className="btn btn-save"
          onClick={handleBackup}
          disabled={isBackupLoading}
          style={{ width: '100%', padding: '14px', fontWeight: 'bold', fontSize: '1rem' }}
        >
          {isBackupLoading ? '⏳ Generando respaldo...' : '📥 Descargar respaldo ahora'}
        </button>

        {/* Solo se puede posponer si no está en modo urgente o si ya tiene algún respaldo */}
        {(!isUrgent || daysSince > 0) && (
          <button type="button"
            id="backup-reminder-postpone-btn"
            onClick={handlePostpone}
            disabled={isBackupLoading}
            style={{
              background: 'none',
              border: 'none',
              color: '#9ca3af',
              marginTop: '12px',
              width: '100%',
              textDecoration: 'underline',
              cursor: isBackupLoading ? 'not-allowed' : 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Recordármelo mañana
          </button>
        )}
      </div>
    </div>
  );
}
