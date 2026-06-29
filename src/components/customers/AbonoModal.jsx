// src/components/customers/AbonoModal.jsx
import { useState, useEffect, useRef } from 'react';
import { Wallet, X, CheckCircle, MessageCircle, AlertTriangle, List } from 'lucide-react';
import { db } from '../../services/db/dexie';
import { Money } from '../../utils/moneyMath';
import { getSafeCustomerDebt } from '../../utils/customerUtils';
import './AbonoModal.css';

export default function AbonoModal({
  show,
  onClose,
  onConfirmAbono,
  customer,
  isCloudCredit = false,
  isBlocked = false,
  blockedReason = '',
  cashSession = null,
  cashActor = null
}) {
  const [monto, setMonto] = useState('');
  const [error, setError] = useState('');
  const [sendReceipt, setSendReceipt] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Nuevos estados para asignación manual
  const [advancedMode, setAdvancedMode] = useState(false);
  const [pendingSales, setPendingSales] = useState([]);
  const [allocations, setAllocations] = useState({});

  const isSubmittingRef = useRef(false);
  const isMountedRef = useRef(false);
  const isModalOpenRef = useRef(false);

  const deudaActual = getSafeCustomerDebt(customer?.debt);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    isModalOpenRef.current = Boolean(show);

    if (!show) {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setMonto('');
      setError('');
      setAdvancedMode(false);
      setAllocations({});
      setPendingSales([]);
    }
  }, [show]);

  // Cargar notas pendientes si se activa el modo avanzado
  useEffect(() => {
    if (show && advancedMode && customer) {
      const fetchSales = async () => {
        try {
          const sales = await db.sales
            .where('customerId').equals(customer.id)
            .and(s => s.paymentMethod === 'fiado' && s.saldoPendiente > 0)
            .sortBy('timestamp');

          // Directamente establecer las notas pendientes. El saneamiento global se encarga de las discrepancias.
          setPendingSales(sales);

        } catch (err) {
          console.error("Error al cargar ventas pendientes:", err);
        }
      };
      fetchSales();
    }
  }, [show, advancedMode, customer]);

  // Recalcular el monto total cuando cambian las asignaciones en modo avanzado
  useEffect(() => {
    if (advancedMode) {
      let sum = Money.init(0);
      Object.values(allocations).forEach(val => {
        const numVal = parseFloat(val) || 0;
        if (numVal > 0) {
          sum = Money.add(sum, numVal);
        }
      });
      const totalStr = Money.toNumber(sum) > 0 ? Money.toNumber(sum).toString() : '';
      setMonto(totalStr);

      if (Money.toNumber(sum) > deudaActual) {
        setError('El abono no puede ser mayor que la deuda actual.');
      } else {
        setError('');
      }
    }
  }, [allocations, advancedMode, deudaActual]);

  const handleMontoChange = (e) => {
    if (advancedMode || isSubmitting) return; // Bloquear edición manual en modo avanzado o durante envío
    const value = e.target.value;
    setError('');
    if (parseFloat(value) > deudaActual) {
      setError('El abono no puede ser mayor que la deuda actual.');
    }
    setMonto(value);
  };

  const handleSaldarCuenta = () => {
    if (advancedMode || isSubmitting) return;
    setMonto(deudaActual.toFixed(2));
    setError('');
  };

  const handleAllocationChange = (saleId, value, maxSaldo) => {
    if (isSubmitting) return;

    let valStr = value;
    const numVal = parseFloat(value);

    if (numVal > maxSaldo) {
      valStr = maxSaldo.toString();
    } else if (numVal < 0) {
      valStr = '0';
    }

    setAllocations(prev => ({
      ...prev,
      [saleId]: valStr
    }));
  };

  const handleToggleFullAllocation = (sale) => {
    if (isSubmitting) return;

    const currentAlloc = parseFloat(allocations[sale.id]) || 0;
    const isFullyAllocated = currentAlloc === sale.saldoPendiente;

    setAllocations(prev => ({
      ...prev,
      [sale.id]: isFullyAllocated ? '' : sale.saldoPendiente.toString()
    }));
  };

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isSubmittingRef.current || isSubmitting) return;

    if (isBlocked) {
      setError(blockedReason || 'No se puede registrar el abono en este momento.');
      return;
    }

    const montoAbono = parseFloat(monto);

    if (isNaN(montoAbono) || montoAbono <= 0) {
      setError('Ingresa un monto válido.');
      return;
    }
    if (montoAbono > deudaActual) {
      setError('El abono no puede ser mayor que la deuda actual.');
      return;
    }

    let finalAllocations = null;
    if (advancedMode) {
      finalAllocations = Object.entries(allocations)
        .map(([saleId, amount]) => ({
          saleId,
          amountApplied: parseFloat(amount)
        }))
        .filter(a => !isNaN(a.amountApplied) && a.amountApplied > 0);

      if (finalAllocations.length === 0) {
        setError('No has asignado ningún monto a las notas.');
        return;
      }
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError('');

    try {
      // El Modal pasa la información al componente PADRE y espera a que termine.
      await onConfirmAbono(customer, montoAbono, sendReceipt, finalAllocations);
    } catch (submitError) {
      console.error('Error al confirmar abono:', submitError);

      if (isMountedRef.current && isModalOpenRef.current) {
        setError(submitError?.message || 'No se pudo registrar el abono. Intenta de nuevo.');
      }
    } finally {
      isSubmittingRef.current = false;

      // Si el padre cerró el modal por éxito, no forzamos estado visual sobre un modal cerrado.
      if (isMountedRef.current && isModalOpenRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  if (!show || !customer) return null;

  return (
    <div className="ui-modal ui-modal--high abono-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="abono-modal-title">
      <div className={`ui-modal__content abono-modal-content ${advancedMode ? 'abono-modal-content--wide' : ''}`}>
        <header className="ui-modal__header abono-header">
          <h2 className="ui-modal__title modal-title" id="abono-modal-title">
            <Wallet size={24} className="text-primary" />
            Abonar a Deuda
          </h2>
          <button type="button" className="ui-button ui-button--ghost ui-button--sm btn-icon-close" onClick={handleClose} aria-label="Cerrar" disabled={isSubmitting}>
            <X size={24} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="ui-modal__body abono-form" aria-busy={isSubmitting}>
          <div className="abono-desktop-split">

            {/* COLUMNA IZQUIERDA */}
            <div className="abono-left-col">
              <div className="ui-card abono-summary-card">
                <div className="cliente-info">
                  <span className="cliente-label">Cliente:</span>
                  <span className="cliente-name">{customer.name}</span>
                </div>
                <div className="deuda-row">
                  <span className="deuda-label">Deuda Actual:</span>
                  <span className="deuda-total">${deudaActual.toFixed(2)}</span>
                </div>
                {isCloudCredit && (
                  <div className="deuda-row">
                    <span className="deuda-label">Caja PRO:</span>
                    <span className="cliente-name">
                      {cashSession?.id
                        ? (cashActor?.displayName || cashActor?.responsibleName || cashSession.responsable_apertura || 'Responsable')
                        : 'Sin caja abierta'}
                    </span>
                  </div>
                )}
              </div>

              {isCloudCredit && isBlocked && (
                <p className="ui-alert ui-alert--danger abono-alert">
                  <AlertTriangle size={14} /> {blockedReason || 'Abonos cloud requieren caja abierta y conexion.'}
                </p>
              )}

              <div className="abono-mode-toggle">
                <label className={`abono-mode-label ${isSubmitting ? 'is-disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={advancedMode}
                    disabled={isBlocked || isSubmitting}
                    onChange={(e) => {
                      setAdvancedMode(e.target.checked);
                      if (!e.target.checked) setAllocations({});
                    }}
                  />
                  <List size={16} />
                  Asignar a notas específicas
                </label>
              </div>

              <div className="form-group abono-input-group">
                <div className="abono-input-header">
                  <label className="form-label" htmlFor="abono-monto">Monto a Abonar ($):</label>
                  {!advancedMode && (
                    <button
                      type="button"
                      className="btn-saldar-quick"
                      onClick={handleSaldarCuenta}
                      title="Liquidar toda la deuda"
                      disabled={isBlocked || isSubmitting}
                    >
                      Saldar $ {deudaActual.toFixed(2)}
                    </button>
                  )}
                </div>

                <div className="input-with-currency">
                  <span className="currency-symbol">$</span>
                  <input
                    className={`form-input abono-monto-input ${error ? 'invalid' : ''}`}
                    id="abono-monto"
                    type="number"
                    step="0.01"
                    min="0"
                    max={deudaActual.toFixed(2)}
                    value={monto}
                    onChange={handleMontoChange}
                    placeholder="0.00"
                    required
                    autoFocus
                    readOnly={advancedMode}
                    disabled={isBlocked || isSubmitting}
                  />
                </div>
                {error && (
                  <p className="ui-alert ui-alert--danger abono-alert">
                    <AlertTriangle size={14} /> {error}
                  </p>
                )}
              </div>
            </div>

            {/* COLUMNA DERECHA (Solo en modo avanzado) */}
            {advancedMode && (
              <div className="abono-right-col">
                <div className="ui-card allocations-container">
                  {pendingSales.length === 0 ? (
                    <p className="allocations-empty">No hay notas pendientes.</p>
                  ) : (
                    pendingSales.map(sale => (
                      <div key={sale.id} className="allocation-row">
                        <div className="sale-info">
                          <span className="sale-folio">Folio: {sale.folio || sale.id.substring(0, 6)}</span>
                          <span className="sale-date">
                            Fecha: {new Date(sale.timestamp).toLocaleDateString()}
                          </span>
                          <span className="sale-pending">
                            Pendiente: ${Number(sale.saldoPendiente).toFixed(2)}
                          </span>
                        </div>
                        <div className="sale-actions">
                          <div className="input-with-currency allocation-input-wrap">
                            <span className="currency-symbol allocation-currency-symbol">$</span>
                            <input
                              type="number"
                              className="form-input allocation-input"
                              placeholder="0.00"
                              step="0.01"
                              min="0"
                              max={sale.saldoPendiente}
                              value={allocations[sale.id] || ''}
                              onChange={(e) => handleAllocationChange(sale.id, e.target.value, sale.saldoPendiente)}
                              disabled={isBlocked || isSubmitting}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleToggleFullAllocation(sale)}
                            className="ui-button ui-button--ghost ui-icon-button ui-icon-button--sm btn btn-icon allocation-full-button"
                            title="Asignar total de esta nota"
                            disabled={isBlocked || isSubmitting}
                          >
                            <CheckCircle size={16} className={(parseFloat(allocations[sale.id]) === sale.saldoPendiente) ? 'allocation-check-icon allocation-check-icon--active' : 'allocation-check-icon'} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* FOOTER */}
          <div className="abono-footer">
            <label className={`abono-whatsapp-toggle ${isSubmitting ? 'is-disabled' : ''}`}>
              <div className="toggle-info">
                <MessageCircle size={20} className="icon-whatsapp" />
                <span>Enviar recibo por WhatsApp</span>
              </div>
              <input
                id="send-receipt-abono"
                type="checkbox"
                checked={sendReceipt}
                onChange={(e) => setSendReceipt(e.target.checked)}
                disabled={isBlocked || isSubmitting}
              />
            </label>

            {isSubmitting && (
              <p className="form-help-text abono-submit-help">
                Registrando abono, por favor espera...
              </p>
            )}

            <footer className="ui-modal__actions abono-actions">
              <button type="submit" className="ui-button ui-button--success btn btn-save" disabled={isBlocked || isSubmitting || !!error || !monto}>
                <CheckCircle size={18} />
                {isSubmitting ? 'Registrando abono...' : 'Confirmar Abono'}
              </button>
              <button type="button" className="ui-button ui-button--ghost btn btn-cancel" onClick={handleClose} disabled={isSubmitting}>
                Cancelar
              </button>
            </footer>
          </div>
        </form>
      </div>
    </div>
  );
}
