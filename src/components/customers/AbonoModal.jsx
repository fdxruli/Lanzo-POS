// src/components/customers/AbonoModal.jsx
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Wallet,
  X,
  CheckCircle,
  MessageCircle,
  AlertTriangle,
  List,
  ChevronDown,
  LoaderCircle
} from 'lucide-react';
import { db } from '../../services/db/dexie';
import { Money } from '../../utils/moneyMath';
import { useDismissibleHistoryLayer } from '../../hooks/useDismissibleHistoryLayer';
import { formatMoneyValue, isCreditPaymentMethod, normalizeMoney } from '../../services/customerMessaging';
import './AbonoModal.css';

// Input feedback only. The existing repository/server still validates and applies money.
const inputError = (value, maximum, allowZero = false) => {
  if (value === '') return '';
  const amount = normalizeMoney(value);
  if (!amount.ok || amount.amount.lt(0) || (!allowZero && amount.amount.eq(0)))
    return 'Ingresa un importe mayor a cero.';
  if (!amount.amount.eq(amount.amount.round(2))) return 'Usa un importe con hasta dos decimales.';
  if (amount.amount.gt(Money.init(maximum)))
    return `El importe supera el disponible de ${formatMoneyValue(Money.toExactString(maximum))}.`;
  return '';
};
const noteDate = (value) => {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime())
    ? 'Fecha no disponible'
    : date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function AbonoModal({
  show,
  onClose,
  onConfirmAbono,
  customer,
  isCloudCredit = false,
  isBlocked = false,
  blockedReason = '',
  cashSession = null,
  cashActor = null,
  authoritativePendingSales = null,
  cloudAllocationStatus = 'unavailable',
  onReloadPendingSales = null
}) {
  const [monto, setMonto] = useState('');
  const [error, setError] = useState('');
  const [sendReceipt, setSendReceipt] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mode, setMode] = useState('general');
  const [allocations, setAllocations] = useState({});
  const [localSales, setLocalSales] = useState([]);
  const [localNotesStatus, setLocalNotesStatus] = useState('loading');
  const isSubmittingRef = useRef(false);
  const isMountedRef = useRef(false);
  const dialogRef = useRef(null);
  const amountRef = useRef(null);
  const id = useId();
  const specific = mode === 'specific';
  const debt = normalizeMoney(customer?.debt ?? 0);
  const debtExact = debt.ok ? debt.exact : '0';

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!show) {
      setMonto('');
      setError('');
      setMode('general');
      setAllocations({});
      setLocalSales([]);
      // A parent-driven close must not release an operation that is still pending.
      if (!isSubmittingRef.current) setIsSubmitting(false);
    }
  }, [show]);

  useEffect(() => {
    if (isCloudCredit && cloudAllocationStatus !== 'reconciled') setAllocations({});
  }, [isCloudCredit, cloudAllocationStatus]);

  useEffect(() => {
    if (!show || !specific || isCloudCredit || Array.isArray(authoritativePendingSales) || !customer?.id)
      return;
    let active = true;
    setLocalNotesStatus('loading');
    db.sales
      .where('customerId')
      .equals(customer.id)
      .and(
        (sale) =>
          isCreditPaymentMethod(sale.paymentMethod ?? sale.payment_method) &&
          !sale.cancelledAt &&
          !sale.cancelled_at &&
          sale.status !== 'cancelled'
      )
      .sortBy('timestamp')
      .then((sales) => {
        if (active) {
          setLocalSales(sales);
          setLocalNotesStatus('ready');
        }
      })
      .catch(() => {
        if (active) setLocalNotesStatus('error');
      });
    return () => {
      active = false;
    };
  }, [show, specific, isCloudCredit, authoritativePendingSales, customer?.id]);

  const sourceSales = useMemo(
    () =>
      Array.isArray(authoritativePendingSales) ? authoritativePendingSales : isCloudCredit ? [] : localSales,
    [authoritativePendingSales, isCloudCredit, localSales]
  );
  const notes = useMemo(() => {
    const seen = new Set();
    return sourceSales.filter((sale) => {
      if (
        !sale?.id ||
        seen.has(sale.id) ||
        (isCloudCredit && sale.status !== 'closed') ||
        sale.status === 'cancelled' ||
        sale.deleted_at ||
        sale.cancelled_at ||
        sale.cancelledAt
      )
        return false;
      const owner = sale.customer_id ?? sale.customerId;
      if (owner && owner !== customer?.id) return false;
      // Never substitute a cached/original balance for a Cloud live balance.
      const value = isCloudCredit ? sale.current_balance_due : sale.saldoPendiente;
      const balance = normalizeMoney(value);
      if (
        (isCloudCredit &&
          (sale.credit_allocation_status !== 'reconciled' || value === null || value === undefined)) ||
        !balance.ok ||
        balance.amount.lte(0)
      )
        return false;
      seen.add(sale.id);
      return true;
    });
  }, [sourceSales, isCloudCredit, customer?.id]);
  const notesStatus = isCloudCredit
    ? cloudAllocationStatus === 'reconciled'
      ? Array.isArray(authoritativePendingSales) && notes.length === sourceSales.length
        ? 'ready'
        : 'unavailable'
      : cloudAllocationStatus
    : Array.isArray(authoritativePendingSales)
      ? 'ready'
      : localNotesStatus;
  const canAssign = notesStatus === 'ready';
  const balanceOf = (sale) => (isCloudCredit ? sale.current_balance_due : sale.saldoPendiente);
  const allocationTotal = Object.values(allocations).reduce((sum, value) => {
    const parsed = normalizeMoney(value);
    return parsed.ok && parsed.amount.gt(0) ? Money.add(sum, parsed.amount) : sum;
  }, Money.init(0));
  const selectedCount = Object.values(allocations).filter((value) => {
    const parsed = normalizeMoney(value);
    return parsed.ok && parsed.amount.gt(0);
  }).length;
  const invalidAllocation = Object.entries(allocations).some(([saleId, value]) => {
    const sale = notes.find((note) => note.id === saleId);
    return !sale || Boolean(inputError(value, balanceOf(sale), true));
  });
  const amount = specific ? normalizeMoney(Money.toExactString(allocationTotal)) : normalizeMoney(monto);
  const validation = specific
    ? allocationTotal.gt(Money.init(debtExact))
      ? `El total asignado supera la deuda disponible de ${formatMoneyValue(debtExact)}.`
      : ''
    : inputError(monto, debtExact);
  const confirmDisabled =
    isBlocked ||
    isSubmitting ||
    !debt.ok ||
    !amount.ok ||
    amount.amount.lte(0) ||
    Boolean(validation) ||
    (specific && (!canAssign || invalidAllocation || !selectedCount));

  const handleClose = useCallback(() => {
    if (!isSubmittingRef.current) onClose();
  }, [onClose]);
  const dismissModal = useDismissibleHistoryLayer({
    isOpen: Boolean(show && customer),
    onDismiss: handleClose,
    layerId: 'customer-abono-modal'
  });

  useEffect(() => {
    if (!show || !customer?.id) return;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const initial =
      amountRef.current && !amountRef.current.disabled
        ? amountRef.current
        : dialog?.querySelector('button:not(:disabled)');
    (initial || dialog)?.focus({ preventScroll: true });
    return () => {
      if (
        previous?.isConnected &&
        (document.activeElement === document.body || dialog?.contains(document.activeElement))
      )
        previous.focus({ preventScroll: true });
    };
  }, [show, customer?.id]);

  useEffect(() => {
    // Disabled controls lose focus. Keep keyboard events inside the pending dialog.
    if (isSubmitting) dialogRef.current?.focus({ preventScroll: true });
  }, [isSubmitting]);

  const handleKeyboard = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!isSubmittingRef.current) dismissModal();
    }
    if (event.key !== 'Tab') return;
    const focusable = [
      ...dialogRef.current.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), summary:not([tabindex="-1"]), [tabindex="0"]'
      )
    ].filter((element) => element.getClientRects().length > 0);
    const first = focusable[0],
      last = focusable.at(-1);
    if (!first) {
      event.preventDefault();
      dialogRef.current.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialogRef.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const chooseMode = (value) => {
    if (isSubmittingRef.current) return;
    setMode(value);
    setError('');
    if (value === 'general') setAllocations({});
  };
  const changeAllocation = (saleId, value) => {
    setError('');
    setAllocations((previous) => ({ ...previous, [saleId]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    if (confirmDisabled) {
      setError(
        validation ||
          (specific && !canAssign
            ? 'Cloud todavía no confirma los saldos para asignar este abono.'
            : 'Revisa los importes antes de confirmar.')
      );
      return;
    }
    const finalAllocations = specific
      ? Object.entries(allocations)
          .filter(([, value]) => {
            const parsed = normalizeMoney(value);
            return parsed.ok && parsed.amount.gt(0);
          })
          .map(([saleId, value]) => ({ saleId, amountApplied: normalizeMoney(value).exact }))
      : null;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError('');
    try {
      await onConfirmAbono(customer, amount.exact, sendReceipt, finalAllocations);
    } catch (submitError) {
      if (isMountedRef.current)
        setError(
          submitError?.message || 'No se pudo confirmar el abono. Revisa el estado antes de reintentar.'
        );
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) setIsSubmitting(false);
    }
  };

  if (!show || !customer) return null;
  const modeHelp = specific
    ? 'Abre una o varias notas e indica cuánto deseas abonar a cada una.'
    : isCloudCredit && notesStatus === 'historical_unallocated'
      ? 'Reduce la deuda general. En esta cuenta el pago no se asignará a una venta porque existen abonos sin conciliar.'
      : 'En cuentas conciliadas, el abono se aplica a las notas pendientes empezando por la más antigua.';

  return (
    <div
      className="ui-modal ui-modal--high abono-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      onKeyDown={handleKeyboard}
    >
      <div className="ui-modal__content abono-modal-content" ref={dialogRef} tabIndex={-1}>
        <header className="ui-modal__header abono-header">
          <h2 className="ui-modal__title" id={`${id}-title`}>
            <Wallet size={23} aria-hidden="true" /> Registrar abono
          </h2>
          <button
            type="button"
            className="ui-button ui-button--ghost abono-close"
            onClick={() => dismissModal()}
            aria-label="Cerrar abono"
            disabled={isSubmitting}
          >
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        <form onSubmit={handleSubmit} className="abono-form" aria-busy={isSubmitting} noValidate>
          <div className="ui-modal__body abono-scroll-body">
            <div className="abono-summary-card">
              <div>
                <span className="abono-eyebrow">Cliente</span>
                <strong className="abono-customer-name">{customer.name}</strong>
              </div>
              <div className="abono-debt">
                <span>Deuda disponible</span>
                <strong>{formatMoneyValue(debt.ok ? debtExact : null)}</strong>
              </div>
              {isCloudCredit && (
                <p className="abono-cash">
                  Caja Cloud ·{' '}
                  {cashSession?.id
                    ? cashActor?.displayName ||
                      cashActor?.responsibleName ||
                      cashSession.responsable_apertura ||
                      'Responsable'
                    : 'Sin caja abierta'}
                </p>
              )}
            </div>
            {isBlocked && (
              <p className="ui-alert ui-alert--danger abono-alert" role="alert">
                <AlertTriangle size={18} aria-hidden="true" />
                {blockedReason || 'Debes tener una caja abierta y conexión para registrar el abono.'}
              </p>
            )}
            <fieldset className="abono-modes" disabled={isSubmitting}>
              <legend className="abono-sr-only">Modalidad del abono</legend>
              {[
                ['general', 'Abono general', Wallet],
                ['specific', 'Abonar por venta / nota', List]
              ].map(([value, label, Icon]) => (
                <label className={`abono-mode ${mode === value ? 'is-selected' : ''}`} key={value}>
                  <input
                    type="radio"
                    name={`${id}-mode`}
                    value={value}
                    checked={mode === value}
                    onChange={() => chooseMode(value)}
                    aria-controls={`${id}-panel`}
                  />
                  <Icon size={19} aria-hidden="true" />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <section
              id={`${id}-panel`}
              className="abono-mode-panel"
              aria-label={specific ? 'Abonar por venta / nota' : 'Abono general'}
            >
              <p className="abono-mode-help" id={`${id}-help`}>
                {modeHelp}
              </p>
              {!specific ? (
                <div className="abono-amount-group">
                  <div className="abono-input-heading">
                    <label htmlFor={`${id}-amount`}>Monto del abono</label>
                    <button
                      type="button"
                      className="ui-button ui-button--ghost abono-pay-all"
                      disabled={isBlocked || isSubmitting || !debt.ok}
                      onClick={() => {
                        setMonto(debtExact);
                        setError('');
                      }}
                    >
                      Saldar {formatMoneyValue(debtExact)}
                    </button>
                  </div>
                  <div className="abono-currency-input">
                    <span aria-hidden="true">$</span>
                    <input
                      ref={amountRef}
                      id={`${id}-amount`}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      max={debtExact}
                      value={monto}
                      onChange={(event) => {
                        setMonto(event.target.value);
                        setError('');
                      }}
                      placeholder="0.00"
                      disabled={isBlocked || isSubmitting}
                      aria-invalid={Boolean(validation)}
                      aria-describedby={validation ? `${id}-validation` : `${id}-help`}
                    />
                  </div>
                  {isCloudCredit && (
                    <p className="abono-field-help">Cloud validará la deuda disponible al confirmar.</p>
                  )}
                </div>
              ) : notesStatus === 'loading' ? (
                <div className="abono-note-state" role="status">
                  <LoaderCircle size={24} className="abono-spinner" aria-hidden="true" />
                  <strong>
                    {isCloudCredit ? 'Consultando notas en Cloud…' : 'Cargando notas pendientes…'}
                  </strong>
                  <p>Espera a que se confirmen los saldos. También puedes elegir abono general.</p>
                </div>
              ) : !canAssign ? (
                <div className="abono-note-state abono-note-state--warning" role="status">
                  <AlertTriangle size={25} aria-hidden="true" />
                  <strong>
                    {notesStatus === 'historical_unallocated'
                      ? 'Estas notas aún no están conciliadas'
                      : notesStatus === 'error'
                        ? 'No pudimos cargar las notas'
                        : 'No hay saldos por nota verificados'}
                  </strong>
                  <p>
                    {notesStatus === 'historical_unallocated'
                      ? 'Los abonos generales anteriores redujeron la deuda del cliente, pero no tienen una asignación verificable por venta. Cloud no puede confirmar el saldo de cada nota.'
                      : notesStatus === 'error'
                        ? 'La consulta no se completó. Para proteger tu cuenta, la asignación por nota está bloqueada hasta obtener saldos verificados.'
                        : 'La asignación específica requiere saldos confirmados por Cloud. No se usarán saldos locales ni importes estimados.'}
                  </p>
                  <p>Puedes continuar con un abono general.</p>
                  {onReloadPendingSales && (
                    <button
                      type="button"
                      className="ui-button ui-button--ghost"
                      disabled={isSubmitting || isBlocked}
                      onClick={onReloadPendingSales}
                    >
                      Volver a consultar notas
                    </button>
                  )}
                </div>
              ) : notes.length === 0 ? (
                <div className="abono-note-state" role="status">
                  <CheckCircle size={24} aria-hidden="true" />
                  <strong>No hay notas pendientes</strong>
                  <p>
                    {isCloudCredit
                      ? 'Cloud no reporta notas con saldo vigente disponible.'
                      : 'No hay ventas fiadas pendientes para este cliente.'}{' '}
                    Puedes registrar un abono general si todavía hay deuda disponible.
                  </p>
                </div>
              ) : (
                <div className="abono-notes">
                  <p className="abono-notes-caption">
                    <CheckCircle size={15} aria-hidden="true" />
                    {isCloudCredit ? 'Saldos verificados por Cloud' : 'Notas pendientes locales'}
                  </p>
                  {notes.map((sale, index) => {
                    const folio =
                      sale.folio || sale.pos_folio || sale.cloud_folio || String(sale.id).slice(-6);
                    const value = allocations[sale.id] || '';
                    const issue = inputError(value, balanceOf(sale), true);
                    const selected = normalizeMoney(value);
                    const assigned = selected.ok && selected.amount.gt(0);
                    const otherTotal = Money.subtract(allocationTotal, assigned ? selected.amount : 0);
                    const remaining = Money.subtract(debtExact, otherTotal);
                    const maximum = remaining.lt(0)
                      ? Money.init(0)
                      : remaining.lt(Money.init(balanceOf(sale)))
                        ? remaining
                        : Money.init(balanceOf(sale));
                    return (
                      <details key={sale.id} className={`abono-note-card ${assigned ? 'is-selected' : ''}`}>
                        <summary
                          tabIndex={isSubmitting ? -1 : 0}
                          onClick={(event) => {
                            if (isSubmitting) event.preventDefault();
                          }}
                        >
                          <span className="abono-note-identity">
                            <strong>Nota {folio}</strong>
                            <span>{noteDate(sale.timestamp || sale.sold_at)}</span>
                          </span>
                          <span className="abono-note-summary">
                            <span>
                              Saldo vigente <strong>{formatMoneyValue(balanceOf(sale))}</strong>
                            </span>
                            <span className={assigned ? 'abono-assigned-badge' : 'abono-expand-label'}>
                              {assigned ? `Abono ${formatMoneyValue(value)}` : 'Elegir nota'}
                            </span>
                          </span>
                          <ChevronDown size={18} aria-hidden="true" />
                        </summary>
                        <div className="abono-note-body">
                          <dl className="abono-note-values">
                            <div>
                              <dt>Importe original</dt>
                              <dd>{formatMoneyValue(sale.total)}</dd>
                            </div>
                            <div>
                              <dt>Saldo vigente</dt>
                              <dd>{formatMoneyValue(balanceOf(sale))}</dd>
                            </div>
                          </dl>
                          <label htmlFor={`${id}-note-${index}`}>Abono a la nota {folio}</label>
                          <div className="abono-note-input-row">
                            <div className="abono-currency-input">
                              <span aria-hidden="true">$</span>
                              <input
                                id={`${id}-note-${index}`}
                                className="allocation-input"
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                min="0"
                                max={balanceOf(sale)}
                                placeholder="0.00"
                                value={value}
                                onChange={(event) => changeAllocation(sale.id, event.target.value)}
                                disabled={isBlocked || isSubmitting}
                                aria-invalid={Boolean(issue)}
                                aria-describedby={`${id}-note-help-${index}`}
                              />
                            </div>
                            <button
                              type="button"
                              className="ui-button ui-button--ghost"
                              disabled={isBlocked || isSubmitting || maximum.lte(0)}
                              onClick={() => changeAllocation(sale.id, Money.toExactString(maximum))}
                            >
                              Usar {formatMoneyValue(Money.toExactString(maximum))}
                            </button>
                          </div>
                          <p
                            className={`abono-field-help ${issue ? 'abono-field-error' : ''}`}
                            id={`${id}-note-help-${index}`}
                          >
                            {issue ||
                              `Hasta ${formatMoneyValue(balanceOf(sale))} en esta nota, sujeto a la deuda del cliente.`}
                          </p>
                          {assigned && (
                            <button
                              type="button"
                              className="ui-button ui-button--ghost abono-remove"
                              disabled={isSubmitting || isBlocked}
                              onClick={() => changeAllocation(sale.id, '')}
                            >
                              Quitar abono de esta nota
                            </button>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}
            </section>
            {(validation || error) && (
              <p className="ui-alert ui-alert--danger abono-alert" role="alert" id={`${id}-validation`}>
                <AlertTriangle size={18} aria-hidden="true" />
                {validation || error}
              </p>
            )}
          </div>
          <footer className="abono-footer">
            <div className="abono-totals" aria-live="polite">
              {specific && (
                <div>
                  <span>
                    Total asignado · {selectedCount} {selectedCount === 1 ? 'nota' : 'notas'}
                  </span>
                  <strong>{formatMoneyValue(Money.toExactString(allocationTotal))}</strong>
                </div>
              )}
              <div className="abono-confirm-total">
                <span>Total a confirmar</span>
                <output aria-label="Total a confirmar">
                  {formatMoneyValue(specific && !canAssign ? '0' : amount.ok ? amount.exact : '0')}
                </output>
              </div>
            </div>
            <label className="abono-receipt">
              <MessageCircle size={18} aria-hidden="true" />
              <span>Ofrecer comprobante como imagen al terminar</span>
              <input
                type="checkbox"
                checked={sendReceipt}
                onChange={(event) => setSendReceipt(event.target.checked)}
                disabled={isBlocked || isSubmitting}
              />
            </label>
            {isSubmitting && (
              <p className="abono-pending" role="status">
                <LoaderCircle size={17} className="abono-spinner" aria-hidden="true" />
                Confirmando el abono. Espera antes de realizar otra operación.
              </p>
            )}
            <div className="ui-modal__actions abono-actions">
              <button type="submit" className="ui-button ui-button--primary" disabled={confirmDisabled}>
                <CheckCircle size={18} aria-hidden="true" />
                {isSubmitting ? 'Registrando abono…' : 'Confirmar abono'}
              </button>
              <button
                type="button"
                className="ui-button ui-button--ghost"
                onClick={() => dismissModal()}
                disabled={isSubmitting}
              >
                Cancelar
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
