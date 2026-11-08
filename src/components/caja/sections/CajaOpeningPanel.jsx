import { ClipboardCheck, ShieldCheck } from 'lucide-react';
import CashOpeningForm from '../CashOpeningForm';
import { getCashMode } from '../../../services/cash/cashActor';
import { getCashSessionStationLabel } from '../../../services/cash/businessCashSummary';
import { Money } from '../../../utils/moneyMath';

const previousResponsibleName = (session = {}) => (
  session.responsable_apertura
  || session.responsibleName
  || session.responsible_name
  || session.staff_display_name
  || 'Responsable no disponible'
);

export default function CajaOpeningPanel({ aperturaPendiente, onOpen, cashActor = null, isCloudCash = null, isReadOnly = null }) {
  const mode = getCashMode();
  const actor = cashActor || mode.actor;
  const cloudEnabled = isCloudCash ?? mode.cloudEnabled;
  const readOnly = isReadOnly ?? mode.readOnly;
  const responsibleName = actor?.responsibleName || actor?.displayName || '';
  const previousShiftClose = aperturaPendiente?.previousShiftClose || null;
  const referenceAvailable = Boolean(aperturaPendiente?.referenceAvailable);
  const hasPriorHistoryReference = Boolean(!cloudEnabled && aperturaPendiente?.ultimaCajaId);
  const previousCloseCounted = previousShiftClose?.monto_cierre ?? previousShiftClose?.closing_counted_amount;
  const previousCloseFund = previousShiftClose?.monto_fondo_siguiente_turno ?? previousShiftClose?.next_shift_fund;

  const referenceNotice = () => {
    if (!cloudEnabled) return null;
    if (referenceAvailable && previousShiftClose) {
      return (
        <div className="ui-alert ui-alert--info cash-opening-notice" role="note">
          <ShieldCheck size={19} aria-hidden="true" />
          <p>
            Referencia del turno anterior en <strong>{getCashSessionStationLabel(previousShiftClose)}</strong>.
            {' '}Responsable: <strong>{previousResponsibleName(previousShiftClose)}</strong>.
            {' '}El fondo declarado fue <strong>${Money.toNumber(previousCloseFund || 0).toFixed(2)}</strong>;
            {' '}cuenta el efectivo físico recibido. Esta referencia no confirma una entrega física.
          </p>
        </div>
      );
    }

    let message = aperturaPendiente?.previousShiftCloseStatus === 'search_limit_reached'
      ? 'No se encontró un cierre de esta estación en el historial reciente consultado. Cuenta el efectivo físico que recibes.'
      : 'No hay un cierre confirmado anterior para esta estación. Cuenta el efectivo físico que recibes.';
    if (previousShiftClose && (previousCloseCounted === null || previousCloseCounted === undefined)) {
      message = 'El cierre anterior no tuvo conteo físico verificable. Cuenta el efectivo recibido antes de abrir.';
    } else if (previousShiftClose && (previousCloseFund === null || previousCloseFund === undefined)) {
      message = 'El cierre anterior no guardó un fondo para el siguiente turno. Cuenta el efectivo que recibes.';
    } else if (aperturaPendiente?.previousShiftCloseStatus === 'not_authorized') {
      message = 'No tienes permiso para consultar el historial de otra persona. Cuenta y confirma el efectivo físico recibido.';
    } else if (aperturaPendiente?.previousShiftCloseStatus === 'unavailable') {
      message = 'No se pudo consultar la referencia del turno anterior. Cuenta y confirma el efectivo físico recibido.';
    }

    return (
      <div className="ui-alert ui-alert--warning cash-opening-notice cash-opening-notice--warning" role="note">
        <ShieldCheck size={19} aria-hidden="true" />
        <p>{message}</p>
      </div>
    );
  };

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

      {referenceNotice()}

      <CashOpeningForm
        suggestedAmount={aperturaPendiente?.montoSugerido || '0'}
        hasSuggestedAmount={referenceAvailable || hasPriorHistoryReference}
        referenceLabel={cloudEnabled ? 'Fondo declarado en el cierre anterior' : 'Fondo sugerido por el cierre anterior'}
        onConfirm={onOpen}
        submitLabel="Confirmar y abrir turno"
        origin="cash_page"
        responsibleName={responsibleName}
        lockResponsible={Boolean(actor?.isStaff)}
        readOnly={readOnly}
        requirePhysicalCount={cloudEnabled}
      />
    </section>
  );
}
