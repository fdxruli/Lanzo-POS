import { ClipboardCheck, ShieldCheck } from 'lucide-react';
import CashOpeningForm from '../CashOpeningForm';

export default function CajaOpeningPanel({ aperturaPendiente, onOpen, cashActor = null, isCloudCash = false, isReadOnly = false }) {
  const isStaff = cashActor?.isStaff;
  const responsibleName = cashActor?.responsibleName || cashActor?.displayName || '';

  return (
    <section className="caja-card caja-opening-panel" aria-labelledby="cash-opening-title">
      <div className="caja-opening-heading">
        <span className="caja-opening-icon" aria-hidden="true">
          <ClipboardCheck size={24} />
        </span>
        <div>
          <p className="section-eyebrow">Apertura requerida</p>
          <h2 id="cash-opening-title">Confirma el inicio del turno</h2>
        </div>
      </div>

      <div className="cash-opening-notice">
        <ShieldCheck size={19} aria-hidden="true" />
        <p>
          {isCloudCash
            ? 'Caja PRO se abre en cloud por usuario/dispositivo para auditoría segura.'
            : 'No se crearán movimientos ni ventas en efectivo hasta identificar al responsable y validar el conteo inicial.'}
        </p>
      </div>

      {isStaff && responsibleName && (
        <div className="cash-opening-notice">
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
        lockResponsible={Boolean(isStaff)}
        readOnly={isReadOnly}
      />
    </section>
  );
}
