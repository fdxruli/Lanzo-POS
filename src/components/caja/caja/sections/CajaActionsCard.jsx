import { Lock, TrendingUp, TrendingDown } from 'lucide-react';
import './CajaActionsCard.css';

/**
 * Tarjeta de acciones de control de efectivo
 *
 * @param {Object} props
 * @param {boolean} props.isBackupLoading - Estado de carga del backup
 * @param {Function} props.onCorte - Callback al hacer corte de caja
 * @param {Function} props.onEntrada - Callback al registrar entrada
 * @param {Function} props.onSalida - Callback al registrar salida
 * @param {Function} props.onAjuste - Callback al registrar ajuste
 */
const CajaActionsCard = ({
  isBackupLoading,
  onCorte,
  onEntrada,
  onSalida,
  onAjuste
}) => {
  return (
    <div className="caja-card actions-card">
      <h3 className="actions-title">Control de Efectivo</h3>
      <div className="actions-grid">
        {/* Botón Corte - destacado, ocupa todo el ancho */}
        <button type="button"
          className="btn btn-audit"
          onClick={onCorte}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          <Lock size={20} /> <span>Corte de Caja (Cerrar Turno)</span>
        </button>

        {/* Fila de Entrada y Salida - lado a lado */}
        <div className="actions-row">
          <button type="button"
            className="btn btn-entry"
            onClick={onEntrada}
            style={{ gap: '6px' }}
          >
            <TrendingUp size={18} /> <span>Entrada</span>
          </button>
          <button type="button"
            className="btn btn-exit"
            onClick={onSalida}
            style={{ gap: '6px' }}
          >
            <TrendingDown size={18} /> <span>Salida</span>
          </button>
        </div>

        {/* Botón Ajuste - secundario */}
        <button type="button"
          className="btn btn-adjust"
          onClick={onAjuste}
          disabled={isBackupLoading}
          title="Registrar ajuste auditable por diferencia fisica"
        >
          Ajuste de Caja
        </button>
      </div>

      {/* Ayuda de Keyboard Shortcuts */}
      <div className="shortcuts-help">
        <p>⌨️ Atajos de Teclado:</p>
        <div className="shortcuts-grid">
          <span>
            <kbd>Ctrl+R</kbd> <span>Refrescar</span>
          </span>
          <span>
            <kbd>Ctrl+Shift+E</kbd> <span>Entrada</span>
          </span>
          <span>
            <kbd>Ctrl+Shift+S</kbd> <span>Salida</span>
          </span>
          <span>
            <kbd>ESC</kbd> <span>Cerrar modal</span>
          </span>
        </div>
      </div>
    </div>
  );
};

export default CajaActionsCard;
