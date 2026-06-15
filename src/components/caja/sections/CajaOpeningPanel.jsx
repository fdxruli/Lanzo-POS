import { ClipboardCheck, ShieldCheck } from 'lucide-react';
import CashOpeningForm from '../CashOpeningForm';

export default function CajaOpeningPanel({ aperturaPendiente, onOpen }) {
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
          No se crearán movimientos ni ventas en efectivo hasta identificar al
          responsable y validar el conteo inicial.
        </p>
      </div>

      <CashOpeningForm
        suggestedAmount={aperturaPendiente?.montoSugerido || '0'}
        onConfirm={onOpen}
        submitLabel="Confirmar y abrir turno"
        origin="cash_page"
      />
    </section>
  );
}
