import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Keyboard,
  LockKeyhole,
  Scale,
  Wallet
} from 'lucide-react';

const CajaActionsCard = ({
  isBackupLoading,
  onCorte,
  onEntrada,
  onSalida,
  onAjuste
}) => {
  return (
    <section className="caja-card actions-card" aria-labelledby="cash-actions-title">
      <div className="actions-heading">
        <span className="actions-heading-icon" aria-hidden="true">
          <Wallet size={20} />
        </span>
        <div>
          <p className="section-eyebrow">Operación del turno</p>
          <h3 id="cash-actions-title" className="actions-title">Control de efectivo</h3>
        </div>
      </div>

      <div className="actions-grid">
        <button className="btn btn-audit" onClick={onCorte}>
          <span className="action-button-icon" aria-hidden="true">
            <LockKeyhole size={21} />
          </span>
          <span className="action-button-copy">
            <strong>Corte de caja</strong>
            <small>Auditar y cerrar turno</small>
          </span>
        </button>

        <div className="actions-row">
          <button
            className="btn btn-entry"
            onClick={onEntrada}
            disabled={isBackupLoading}
          >
            <ArrowDownToLine size={20} aria-hidden="true" />
            <span>Entrada</span>
          </button>
          <button
            className="btn btn-exit"
            onClick={onSalida}
            disabled={isBackupLoading}
          >
            <ArrowUpFromLine size={20} aria-hidden="true" />
            <span>Salida</span>
          </button>
        </div>

        <button
          className="btn btn-adjust"
          onClick={onAjuste}
          disabled={isBackupLoading}
          title="Registrar ajuste auditable por diferencia física"
        >
          <Scale size={19} aria-hidden="true" />
          <span>Ajuste de caja</span>
        </button>
      </div>

      <div className="shortcuts-help">
        <p>
          <Keyboard size={15} aria-hidden="true" />
          Atajos de teclado
        </p>
        <div className="shortcuts-grid">
          <span><kbd>Alt+R</kbd><span>Refrescar</span></span>
          <span><kbd>Ctrl+Shift+E</kbd><span>Entrada</span></span>
          <span><kbd>Ctrl+Shift+S</kbd><span>Salida</span></span>
          <span><kbd>ESC</kbd><span>Cerrar modal</span></span>
        </div>
      </div>
    </section>
  );
};

export default CajaActionsCard;
