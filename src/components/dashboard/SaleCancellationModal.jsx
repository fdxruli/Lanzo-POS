import { useEffect, useMemo, useState } from 'react';
import { Ban, PackagePlus, Trash2, X } from 'lucide-react';
import { CANCELLATION_ACTIONS } from '../../services/sales/cancelSaleCore';
import './SaleCancellationModal.css';

const getLineId = (item, index) =>
  item?.lineId || item?.cartItemId || item?.orderItemId || `${item?.id || 'item'}:${index}`;

export default function SaleCancellationModal({
  show,
  sale,
  allowWaste,
  isSubmitting,
  onClose,
  onConfirm
}) {
  const [actions, setActions] = useState({});
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!show || !sale) return;
    const initialActions = {};
    (sale.items || []).forEach((item, index) => {
      initialActions[getLineId(item, index)] = CANCELLATION_ACTIONS.RESTOCK;
    });
    setActions(initialActions);
    setReason('');
  }, [show, sale]);

  const items = useMemo(() => sale?.items || [], [sale]);
  if (!show || !sale) return null;

  const setItemAction = (lineId, action) => {
    setActions((current) => ({ ...current, [lineId]: action }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const dispositionPlan = items.map((item, index) => {
      const lineId = getLineId(item, index);
      return {
        lineId,
        action: actions[lineId] || CANCELLATION_ACTIONS.RESTOCK,
        reason: actions[lineId] === CANCELLATION_ACTIONS.WASTE
          ? 'venta_cancelada'
          : reason.trim(),
        notes: reason.trim()
      };
    });
    onConfirm({ dispositionPlan, reason: reason.trim() });
  };

  return (
    <div className="sale-cancellation-overlay" role="presentation">
      <form
        className="sale-cancellation-modal"
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-cancellation-title"
      >
        <header className="sale-cancellation-header">
          <div>
            <h2 id="sale-cancellation-title">Cancelar venta</h2>
            <p>Folio {sale.folio || sale.id || 'sin folio'}</p>
          </div>
          <button type="button" className="sale-cancellation-close" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <div className="sale-cancellation-notice">
          Selecciona el destino de cada producto. La venta quedara en el historial como cancelada.
        </div>

        <div className="sale-cancellation-items">
          {items.map((item, index) => {
            const lineId = getLineId(item, index);
            const selected = actions[lineId];
            const usesBatches = Array.isArray(item.batchesUsed) && item.batchesUsed.length > 0;

            return (
              <section className="sale-cancellation-item" key={lineId}>
                <div className="sale-cancellation-item-title">
                  <strong>{item.quantity || 0} x {item.name || 'Producto'}</strong>
                  <span>{usesBatches ? 'Inventario por lote' : 'Inventario directo'}</span>
                </div>

                <div className="sale-cancellation-options">
                  <button
                    type="button"
                    className={selected === CANCELLATION_ACTIONS.RESTOCK ? 'selected restock' : ''}
                    onClick={() => setItemAction(lineId, CANCELLATION_ACTIONS.RESTOCK)}
                  >
                    <PackagePlus size={19} />
                    <span>
                      <strong>{usesBatches ? 'Regresar al lote' : 'Regresar a inventario'}</strong>
                      <small>El producto vuelve a estar disponible.</small>
                    </span>
                  </button>

                  <button
                    type="button"
                    className={selected === CANCELLATION_ACTIONS.NO_RETURN ? 'selected no-return' : ''}
                    onClick={() => setItemAction(lineId, CANCELLATION_ACTIONS.NO_RETURN)}
                  >
                    <Ban size={19} />
                    <span>
                      <strong>No regresar</strong>
                      <small>Conserva la salida original de inventario.</small>
                    </span>
                  </button>

                  {allowWaste && (
                    <button
                      type="button"
                      className={selected === CANCELLATION_ACTIONS.WASTE ? 'selected waste' : ''}
                      onClick={() => setItemAction(lineId, CANCELLATION_ACTIONS.WASTE)}
                    >
                      <Trash2 size={19} />
                      <span>
                        <strong>Registrar como merma</strong>
                        <small>Reclasifica la salida sin descontar otra vez.</small>
                      </span>
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <label className="sale-cancellation-reason">
          Motivo de cancelacion
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ej. cobro duplicado, error de captura o rechazo del cliente"
            maxLength={300}
          />
        </label>

        <footer className="sale-cancellation-actions">
          <button type="button" className="btn btn-cancel" onClick={onClose} disabled={isSubmitting}>
            Volver
          </button>
          <button type="submit" className="btn btn-confirm" disabled={isSubmitting || items.length === 0}>
            {isSubmitting ? 'Cancelando...' : 'Confirmar cancelacion'}
          </button>
        </footer>
      </form>
    </div>
  );
}
