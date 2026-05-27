/**
 * BackupReminder - Recordatorio de Respaldo Refactorizado (Fase 4)
 *
 * Se basa estrictamente en volumen (mutaciones en Dexie) a través de BackupRiskEvaluator.
 * 
 * Niveles de UI:
 * - Nivel 1: Delegado al Navbar (null).
 * - Nivel 2: Banner de advertencia superior.
 * - Nivel 3: Modal bloqueante en el centro de la pantalla.
 * 
 * Controles de Jerarquía:
 * - Si isStorageCritical === true -> return null (El banner de disco lleno bloquea la app).
 * - Si isTransactionInProgress === true && Nivel 3 -> Degrada a Nivel 2 temporalmente.
 */

import { useCallback, useState } from 'react';
import { AlertTriangle, Loader, Download, AlertOctagon } from 'lucide-react';
import {
  BACKUP_ABORT_REASON,
  BACKUP_WARNING_BLOB_PERF,
  downloadBackupSmart,
} from '../../services/dataTransfer';
import { useAppStore } from '../../store/useAppStore';
import { useBackupRiskStore, evaluator } from '../../services/BackupRiskEvaluator';
import Logger from '../../services/Logger';
import './MessageModal.css';

export default function BackupReminder() {
  const isStorageCritical = useAppStore((state) => state.isStorageCritical);
  const isTransactionInProgress = useAppStore((state) => state.isTransactionInProgress);
  
  const isBackupLoading = useAppStore((state) => state.isBackupLoading);
  const setBackupLoading = useAppStore((state) => state.setBackupLoading);

  const riskLevel = useBackupRiskStore((state) => state.riskLevel);
  const totalMutations = useBackupRiskStore((state) => state.totalMutations);

  const [localLoading, setLocalLoading] = useState(false);

  const handleBackup = useCallback(async () => {
    if (isBackupLoading || localLoading) return;

    setBackupLoading(true);
    setLocalLoading(true);
    try {
      const result = await downloadBackupSmart();

      if (result.success === true) {
        if (result.warnings?.includes(BACKUP_WARNING_BLOB_PERF)) {
          Logger.warn('Respaldo generado en modo compatible (Blob). Puede tardar más en bases grandes.');
        }
        Logger.info('✅ Respaldo completado correctamente desde BackupReminder');
        await evaluator.markBackupCompleted();
        return;
      }

      if (result.reason === BACKUP_ABORT_REASON) {
        // El usuario canceló el diálogo de guardado
        return;
      }

      throw new Error('Resultado de respaldo no reconocido.');
    } catch (error) {
      Logger.error('Error generando respaldo:', error);
      alert('Error al generar el respaldo. Intenta de nuevo o ve a Configuración → Respaldo.');
    } finally {
      setBackupLoading(false);
      setLocalLoading(false);
    }
  }, [isBackupLoading, localLoading, setBackupLoading]);

  const handlePostpone = useCallback(async () => {
    await evaluator.postpone();
  }, []);

  // 1. Jerarquía Estricta: Si el disco está lleno, no hacemos estorbo.
  if (isStorageCritical) return null;

  // 2. Nivel 0 o 1: Sin UI directa aquí (Nivel 1 lo maneja Navbar).
  if (riskLevel < 2) return null;

  // 3. Evaluar degradación táctica
  let effectiveLevel = riskLevel;
  if (riskLevel === 3 && isTransactionInProgress) {
    // Degradamos forzosamente a Nivel 2 temporalmente para no tapar el teclado o la cámara
    effectiveLevel = 2;
  }

  // --- Renderizado según Nivel Efectivo ---

  // Nivel 2: Banner superior no bloqueante
  if (effectiveLevel === 2) {
    return (
      <div style={{
        backgroundColor: '#fffbeb',
        color: '#b45309',
        padding: '0.75rem 1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #fde68a',
        zIndex: 50 // Por debajo de modales
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertTriangle size={20} />
          <span>Tienes un volumen considerable de ventas ({totalMutations} regs) sin respaldar. Se recomienda descargar una copia.</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            onClick={handlePostpone}
            disabled={isBackupLoading}
            style={{ padding: '0.5rem 1rem', background: 'transparent', border: '1px solid #b45309', borderRadius: '4px', color: '#b45309', cursor: 'pointer' }}
          >
            Cerrar por ahora
          </button>
          <button 
            onClick={handleBackup}
            disabled={isBackupLoading}
            style={{ padding: '0.5rem 1rem', background: '#b45309', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            {isBackupLoading ? <><Loader size={16} className="animate-spin" />...</> : 'Descargar Respaldo'}
          </button>
        </div>
      </div>
    );
  }

  // Nivel 3: Modal opaco central bloqueante
  if (effectiveLevel === 3) {
    return (
      <div className="modal" style={{ display: 'flex', zIndex: 9999 }}>
        <div className="modal-content" style={{ borderLeft: '6px solid #dc2626' }}>
          <h2 style={{ color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertOctagon size={24} color="#dc2626" /> Riesgo de Pérdida de Datos
          </h2>

          <p>
            Has acumulado un volumen alto de operaciones no respaldadas ({totalMutations} registros). 
            Tu base de datos es local y vulnerable a fallos de hardware o limpieza de navegador.
          </p>

          <p style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            padding: '0.75rem',
            fontSize: '0.9rem',
            color: '#991b1b',
            marginTop: '0.5rem',
          }}>
            <AlertTriangle size={16} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} /> <strong>Acción Obligatoria:</strong> Por tu seguridad, debes descargar una copia de seguridad ahora para continuar operando con tranquilidad.
          </p>

          <p style={{ fontSize: '0.88rem', color: '#666', margin: '0.75rem 0 1.25rem' }}>
            Toda la información vive <strong>solo en este dispositivo</strong>. Un respaldo es tu única red de seguridad.
          </p>

          <button
            onClick={handleBackup}
            disabled={isBackupLoading}
            style={{ width: '100%', padding: '14px', fontWeight: 'bold', fontSize: '1rem', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            {isBackupLoading ? <><Loader size={20} className="animate-spin" /> Generando respaldo...</> : <><Download size={20} /> Descargar respaldo ahora</>}
          </button>

          <button
            onClick={handlePostpone}
            disabled={isBackupLoading}
            style={{
              background: 'none', border: 'none', color: '#9ca3af',
              marginTop: '12px', width: '100%', textDecoration: 'underline',
              cursor: isBackupLoading ? 'not-allowed' : 'pointer', fontSize: '0.85rem',
            }}
          >
            Asumir el riesgo y posponer
          </button>
        </div>
      </div>
    );
  }

  return null;
}
