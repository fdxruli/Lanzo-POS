import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Keyboard,
  LockKeyhole,
  Scale,
  ShieldCheck,
  UserRound,
  Wallet
} from 'lucide-react';

const CajaActionsCard = ({
  cajaActual,
  estadoCaja,
  isBackupLoading,
  isCloudCash = false,
  isReadOnly = false,
  cashActor = null,
  readOnlyMessage = '',
  onCorte,
  onEntrada,
  onSalida,
  onAjuste
}) => {
  const disabled = isBackupLoading || isReadOnly;
  const actorLabel = cashActor?.isStaff ? 'Caja de staff' : 'Caja admin';
  const responsibleName = cajaActual?.responsable_apertura || cajaActual?.responsibleName || cashActor?.responsibleName || cashActor?.displayName;

  return (
    <section className="ui-card ui-card--compact caja-card actions-card" aria-labelledby="cash-actions-title">
      <div className="actions-heading">
        <span className="actions-heading-icon" aria-hidden="true">
          <Wallet size={20} />
        </span>
        <div>
          <p className="section-eyebrow">Operación del turno</p>
          <h3 id="cash-actions-title" className="actions-title">Control de efectivo</h3>
        </div>
      </div>

      <div className="cash-action-context">
        <span>
          <ShieldCheck size={15} aria-hidden="true" />
          {isCloudCash ? 'Cloud PRO' : 'Caja local'}
        </span>
        <span>
          <UserRound size={15} aria-hidden="true" />
          {actorLabel}{responsibleName ? ` - ${responsibleName}` : ''}
        </span>
        {estadoCaja && <span>Estado: {estadoCaja}</span>}
      </div>

      {isReadOnly && (
        <div className="ui-alert ui-alert--warning cash-opening-notice cash-opening-notice--warning">
          <LockKeyhole size={18} aria-hidden="true" />
          <p>{readOnlyMessage || 'Caja cloud está en modo consulta. Revisa la conexión para registrar movimientos.'}</p>
        </div>
      )}

      {isCloudCash && cashActor?.isStaff && !isReadOnly && (
        <div className="ui-alert ui-alert--info cash-opening-notice">
          <ShieldCheck size={18} aria-hidden="true" />
          <p>Los movimientos se registran en la caja propia de este staff.</p>
        </div>
      )}

      <div className="actions-grid">
        <button type="button" className="ui-button ui-button--primary btn btn-audit" onClick={onCorte} disabled={disabled}>
          <span className="action-button-icon" aria-hidden="true">
            <LockKeyhole size={21} />
          </span>
          <span className="action-button-copy">
            <strong>Corte de caja</strong>
            <small>Auditar y cerrar turno</small>
          </span>
        </button>

        <div className="actions-row">
          <button type="button" className="ui-button ui-button--success btn btn-entry" onClick={onEntrada} disabled={disabled}>
            <ArrowDownToLine size={20} aria-hidden="true" />
            <span>Entrada</span>
          </button>
          <button type="button" className="ui-button ui-button--danger btn btn-exit" onClick={onSalida} disabled={disabled}>
            <ArrowUpFromLine size={20} aria-hidden="true" />
            <span>Salida</span>
          </button>
        </div>

        <button type="button"
          className="ui-button ui-button--neutral btn btn-adjust"
          onClick={onAjuste}
          disabled={disabled}
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
