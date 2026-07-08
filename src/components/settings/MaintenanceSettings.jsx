import { useState } from 'react';
import {
  Archive,
  BarChart2,
  CheckCircle2,
  Database,
  Download,
  Package,
  ShieldCheck,
  Sparkles,
  Wrench
} from 'lucide-react';
import { useStatsStore } from '../../store/useStatsStore';
import { archiveOldData } from '../../services/database';
import Logger from '../../services/Logger';
import DataTransferModal from '../products/DataTransferModal';
import { useProductStore } from '../../store/useProductStore';
import { maintenanceTools } from '../../services/db';
import { evaluator } from '../../services/BackupRiskEvaluator';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import { showInputPromptModal } from '../common/InputPromptModal';

const DEFAULT_REBUILD_DAYS = 30;

function MaintenanceHero({ isProcessing }) {
  return (
    <header className="maintenance-settings-hero">
      <div className="maintenance-hero-copy">
        <span className="maintenance-kicker">
          <Sparkles size={15} />
          Datos y mantenimiento
        </span>
        <div>
          <h2>Salud operativa del sistema</h2>
          <p>Acciones puntuales para cuidar reportes, inventario, historiales y transferencia de datos.</p>
        </div>
      </div>

      <div className="maintenance-hero-summary" aria-label="Resumen de mantenimiento">
        <div>
          <span>Estado</span>
          <strong>{isProcessing ? 'Procesando' : 'Listo'}</strong>
        </div>
        <div>
          <span>Rutinas</span>
          <strong>4</strong>
        </div>
      </div>
    </header>
  );
}

function MaintenanceToolCard({
  Icon,
  tone = 'neutral',
  eyebrow,
  title,
  description,
  details,
  actionLabel,
  actionIcon,
  buttonClassName = 'btn btn-secondary',
  onClick,
  disabled
}) {
  return (
    <article className={`maintenance-tool-card maintenance-tool-card--${tone}`}>
      <div className="maintenance-tool-main">
        <span className={`maintenance-tool-icon maintenance-tool-icon--${tone}`} aria-hidden="true">
          <Icon size={19} />
        </span>

        <div className="maintenance-tool-copy">
          <span className="maintenance-tool-eyebrow">{eyebrow}</span>
          <h4>{title}</h4>
          <p>{description}</p>

          {details?.length > 0 && (
            <ul className="maintenance-tool-details">
              {details.map((detail) => (
                <li key={detail}>
                  <CheckCircle2 size={14} />
                  <span>{detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <button type="button" className={`maintenance-action ${buttonClassName}`} onClick={onClick} disabled={disabled}>
        {actionIcon}
        <span>{actionLabel}</span>
      </button>
    </article>
  );
}

export default function MaintenanceSettings() {
  const loadStats = useStatsStore((state) => state.loadStats);
  const loadInitialProducts = useProductStore((state) => state.loadInitialProducts);
  const [showDataTransfer, setShowDataTransfer] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleArchive = async () => {
    const confirmed = await showConfirmModal(
      'Esto descargara y BORRARA las ventas de hace mas de 6 meses para acelerar el sistema. Continuar?',
      {
        title: 'Archivar historial',
        confirmButtonText: 'Si, archivar',
        cancelButtonText: 'Cancelar'
      }
    );
    if (!confirmed) return;

    setIsProcessing(true);
    try {
      const oldSales = await archiveOldData(6);
      if (oldSales.length > 0) {
        const blob = new Blob([JSON.stringify(oldSales)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ARCHIVO_HISTORICO_${new Date().toISOString()}.json`;
        a.click();

        const currentLastBackup = parseInt(localStorage.getItem('last_backup_mutation_count') || '0', 10);
        if (currentLastBackup > 0) {
          const newBaseline = Math.max(0, currentLastBackup - oldSales.length);
          localStorage.setItem('last_backup_mutation_count', newBaseline.toString());
        }

        evaluator.ping();
        showMessageModal(`Se han archivado y eliminado ${oldSales.length} ventas antiguas correctamente.`);
      } else {
        showMessageModal('No hay ventas con mas de 6 meses de antiguedad para archivar.', null, { type: 'warning' });
      }
    } catch (error) {
      Logger.error('Error archivando datos:', error);
      showMessageModal('Ocurrio un error al intentar archivar el historial.', null, { type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFixStock = async () => {
    setIsProcessing(true);
    try {
      const result = await maintenanceTools.fixStock();
      if (result.success) {
        showMessageModal(result.message);
        if (result.details.length > 0) {
          Logger.info('Detalles de correccion:', result.details);
        }
        await loadInitialProducts();
      }
    } catch (error) {
      showMessageModal(`Error: ${error?.message || error}`, null, { type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRebuildStats = async () => {
    const confirmation = await showInputPromptModal({
      title: 'Reconstruir reportes',
      message: [
        `Esto reconstruira los reportes de los ultimos ${DEFAULT_REBUILD_DAYS} dias basandose UNICAMENTE en lo que quedo guardado en cada ticket historico.`,
        'NO actualiza a costos de hoy.',
        'Escribe CONFIRMAR para ejecutar.'
      ].join('\n\n'),
      placeholder: 'CONFIRMAR',
      confirmButtonText: 'Reconstruir',
      cancelButtonText: 'Cancelar',
      required: true
    });

    if (confirmation === null) return;

    if (confirmation.trim() !== 'CONFIRMAR') {
      showMessageModal('Confirmacion invalida. Debes escribir exactamente CONFIRMAR para ejecutar esta accion.', null, { type: 'warning' });
      return;
    }

    setIsProcessing(true);
    try {
      const result = await maintenanceTools.rebuildStats({ days: DEFAULT_REBUILD_DAYS });
      showMessageModal(result.message);
      await loadStats(false);
    } catch (error) {
      showMessageModal(`Error: ${error?.message || error}`, null, { type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="maintenance-settings-shell">
      <MaintenanceHero isProcessing={isProcessing} />

      <section className="maintenance-settings-layout">
        <div className="maintenance-routines-panel">
          <div className="maintenance-panel-heading">
            <span className="settings-section-icon" aria-hidden="true">
              <Wrench size={18} />
            </span>
            <div>
              <h3 className="subtitle">Rutinas de correccion</h3>
              <p>Usalas cuando notes diferencias en reportes, stock o rendimiento del historial.</p>
            </div>
          </div>

          <div className="maintenance-tool-list">
            <MaintenanceToolCard
              Icon={BarChart2}
              tone="info"
              eyebrow="Reportes"
              title="Reconstruir desde historial"
              description="Recalcula los reportes usando lo cobrado en cada ticket historico."
              details={[
                `Limita el proceso a los ultimos ${DEFAULT_REBUILD_DAYS} dias.`,
                'No actualiza los tickets a costos actuales.'
              ]}
              actionLabel={isProcessing ? 'Reconstruyendo...' : 'Reconstruir'}
              buttonClassName="btn btn-secondary"
              onClick={handleRebuildStats}
              disabled={isProcessing}
            />

            <MaintenanceToolCard
              Icon={Package}
              tone="success"
              eyebrow="Inventario"
              title="Sincronizar stock"
              description="Corrige diferencias visibles entre lotes disponibles y productos marcados como agotados."
              details={[
                'Revisa productos y lotes locales.',
                'Actualiza la lista al terminar.'
              ]}
              actionLabel={isProcessing ? 'Procesando...' : 'Sincronizar'}
              buttonClassName="btn btn-primary"
              onClick={handleFixStock}
              disabled={isProcessing}
            />

            <MaintenanceToolCard
              Icon={Archive}
              tone="warning"
              eyebrow="Historial"
              title="Archivar ventas antiguas"
              description="Descarga y retira ventas de mas de 6 meses para aligerar la base local."
              details={[
                'Genera un JSON antes de eliminar.',
                'Recomendado como rutina semestral.'
              ]}
              actionLabel={isProcessing ? 'Archivando...' : 'Archivar'}
              actionIcon={<Archive size={16} />}
              buttonClassName="btn btn-secondary maintenance-button--archive"
              onClick={handleArchive}
              disabled={isProcessing}
            />
          </div>
        </div>

        <aside className="maintenance-data-panel">
          <div className="maintenance-data-card">
            <span className="maintenance-data-icon" aria-hidden="true">
              <Database size={20} />
            </span>
            <div>
              <span className="maintenance-tool-eyebrow">Transferencia</span>
              <h3>Respaldo y datos</h3>
              <p>Centraliza exportaciones, importaciones y cargas masivas de productos.</p>
            </div>

            <div className="maintenance-data-actions">
              <div>
                <strong>Base de datos</strong>
                <span>Exporta o importa respaldos operativos.</span>
              </div>
              <div>
                <strong>Productos</strong>
                <span>Carga CSV o JSON sin salir de configuracion.</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowDataTransfer(true)}
              className="btn btn-secondary maintenance-button--data"
              disabled={isProcessing}
            >
              <Download size={16} />
              <span>Gestionar datos</span>
            </button>
          </div>

          <div className="maintenance-safety-note">
            <ShieldCheck size={18} />
            <span>Para acciones destructivas, el sistema pedira confirmacion antes de continuar.</span>
          </div>
        </aside>
      </section>

      <DataTransferModal
        show={showDataTransfer}
        onClose={() => setShowDataTransfer(false)}
        onRefresh={async () => {
          await Promise.all([
            loadInitialProducts(),
            maintenanceTools.rebuildStats({ fullHistory: true })
          ]);
          await loadStats(false);
        }}
      />
    </div>
  );
}
