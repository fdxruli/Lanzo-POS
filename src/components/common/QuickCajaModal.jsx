import { WalletCards, X } from 'lucide-react';
import CashOpeningForm from '../caja/CashOpeningForm';
import '../caja/modals/CajaModals.css';

export default function QuickCajaModal({
  show,
  onClose,
  onConfirm,
  suggestedAmount = '0'
}) {
  if (!show) return null;

  return (
    <div className="modal caja-modal" role="dialog" aria-modal="true" aria-labelledby="quick-caja-title">
      <div className="modal-content caja-modal__content caja-modal__content--medium">
        <header className="caja-modal__header">
          <span className="caja-modal__header-icon" aria-hidden="true">
            <WalletCards size={22} />
          </span>
          <div className="caja-modal__heading">
            <p>Apertura requerida</p>
            <h2 id="quick-caja-title">Abrir caja antes de cobrar</h2>
          </div>
          <button type="button" className="caja-modal__close" onClick={onClose} aria-label="Cerrar apertura de caja">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="caja-modal__body">
          <p className="caja-modal__intro">
            Confirma quién recibe el turno y que el efectivo físico coincide con el fondo inicial.
          </p>
          <CashOpeningForm
            suggestedAmount={suggestedAmount}
            onConfirm={onConfirm}
            onCancel={onClose}
            submitLabel="Abrir caja y continuar"
            cancelLabel="Volver al carrito"
            origin="pos_checkout"
          />
        </div>
      </div>
    </div>
  );
}