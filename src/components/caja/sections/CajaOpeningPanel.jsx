import { ClipboardCheck, ShieldCheck } from 'lucide-react';
import CashOpeningForm from '../CashOpeningForm';
import { getCashMode } from '../../../services/cash/cashActor';

export default function CajaOpeningPanel({ aperturaPendiente, onOpen, cashActor = null, isCloudCash = null, isReadOnly = null }) {
  const mode = getCashMode();
  const actor = cashActor || mode.actor;
  const cloudEnabled = isCloudCash ?? mode.cloudEnabled;
  const readOnly = isReadOnly ?? mode.readOnly;
  const responsibleName = actor?.responsibleName || actor?.displayName || '';

  return (
    <section className="ui-card ui-card--compact caja-card caja-opening-panel" aria-labelledby="cash-opening-title">
      <div className="caja-opening-heading">
        <span className="caja-opening-icon" aria-hidden="true"><ClipboardCheck size={24} /></span>
        <div>
          <p className="section-eyebrow">Apertura requerida</p>
          <h2 id="cash-opening-title">Confirma el inicio del turno</h2>
        </div>
      </div>

      <div className="ui-alert ui-alert--info cash-opening-notice">
        <ShieldCheck size={19} aria-hidden="true" />
        <p>{cloudEnabled ? 'Caja Lanzo Nube separada por usuario para auditoría.' : 'Valida el fondo inicial antes de operar efectivo.'}</p>
      </div>

      {actor?.isStaff && responsibleName && (
        <div className="ui-alert ui-alert--info cash-opening-notice">
          <ShieldCheck size={19} aria-hidden="true" />
          <p>Responsable automático: <strong>{responsibleName}</strong></p>
        </div>
      )}

      <CashOpeningForm
        suggestedAmount={aperturaPendiente?.montoSugerido || '0'}
        onConfirm={onOpen}
        submitLabel="Confirmar y abrir turno"
        origin="cash_page"
        responsibleName={responsibleName}
        lockResponsible={Boolean(actor?.isStaff)}
        readOnly={readOnly}
      />
    </section>
  );
}
