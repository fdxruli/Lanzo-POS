// src/components/common/QuickAddCustomerModal.jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { saveDataSafe, STORES, DB_ERROR_CODES } from '../../services/database';
import './QuickAddCustomerModal.css';
import { generateID } from '../../services/utils';
import { useDismissibleHistoryLayer } from '../../hooks/useDismissibleHistoryLayer';
import { Money } from '../../utils/moneyMath';
import { isMoneyInputDraft, normalizeMoneyInputDraft, parseMoneyInputDraft } from '../../utils/moneyInputDraft';

const getFriendlyError = (result) => {
  if (!result?.error) {
    return result?.message || 'Error al guardar el cliente.';
  }

  const { code, details } = result.error;
  if (code === DB_ERROR_CODES.CONSTRAINT_VIOLATION && details?.field === 'phone') {
    return result.error.message || 'El telefono ya esta registrado para otro cliente.';
  }

  return result.error.message || result.message || 'Error al guardar el cliente.';
};

export default function QuickAddCustomerModal({ show, onClose, onCustomerSaved, creditMode = false, minimumCreditLimit = 0 }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [creditLimitDraft, setCreditLimitDraft] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const dialogRef = useRef(null);
  const pendingCustomerRef = useRef(null);
  const isLoadingRef = useRef(false);
  const minimumCredit = Money.init(minimumCreditLimit);
  const creditDraft = parseMoneyInputDraft(creditLimitDraft);
  const creditLimit = creditDraft.cents === null ? null : Money.fromCents(creditDraft.cents);
  const hasValidCredit = creditDraft.status !== 'invalid' && creditLimit !== null && creditLimit.gt(0) && creditLimit.gte(minimumCredit);
  const creditError = !creditLimitDraft ? ''
    : creditLimit === null ? 'Escribe un límite de crédito válido con hasta dos decimales.'
      : !creditLimit.gt(0) ? 'El límite de crédito debe ser mayor a $0.00.'
        : creditLimit.lt(minimumCredit) ? `Para este Fiado el límite de crédito debe ser al menos $${minimumCredit.toFixed(2)}.`
          : '';

  const handleClose = useCallback(() => {
    if (isLoadingRef.current) return;
    setName('');
    setPhone('');
    setCreditLimitDraft('');
    pendingCustomerRef.current = null;
    setError('');
    onClose();
  }, [onClose]);

  const dismissModal = useDismissibleHistoryLayer({
    isOpen: show,
    onDismiss: handleClose,
    layerId: 'quick-add-customer-modal'
  });

  useEffect(() => {
    if (!show) return undefined;
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector('input')?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!isLoadingRef.current) dismissModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll('input:not([disabled]), button:not([disabled])') || []);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [show, dismissModal]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoadingRef.current || (creditMode && !hasValidCredit)) return;
    setError('');
    isLoadingRef.current = true;
    setIsLoading(true);

    try {
      const newCustomer = {
        id: pendingCustomerRef.current?.id || generateID('cust'),
        name,
        phone,
        address: '',
        debt: 0,
        creditLimit: creditMode ? Money.toNumber(creditLimit) : 0
      };

      let result;
      if (creditMode) {
        const { customerRepository } = await import('../../services/customers/customerRepository');
        const existingCustomer = pendingCustomerRef.current
          ? await customerRepository.getCustomerById(pendingCustomerRef.current.id) || pendingCustomerRef.current
          : null;
        result = await customerRepository.saveCustomer(newCustomer, { existingCustomer });
      } else {
        result = await saveDataSafe(STORES.CUSTOMERS, newCustomer);
      }
      if (!result.success) {
        setError(getFriendlyError(result));
        return;
      }

      if (creditMode && result.pending) {
        pendingCustomerRef.current = result.data || newCustomer;
        setError('El cliente quedó guardado en este dispositivo y aún necesita sincronizarse. Conéctate y vuelve a guardar para usarlo en Fiado.');
        return;
      }

      onCustomerSaved(result.data || newCustomer);
      isLoadingRef.current = false;
      dismissModal();
    } catch {
      setError('Error al guardar el cliente.');
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  };

  if (!show) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 'var(--z-modal-overlay)' }}>
      <div ref={dialogRef} className="modal-content quick-add-modal" role="dialog" aria-modal="true" aria-labelledby="quick-customer-title">
        <h2 id="quick-customer-title" className="modal-title">Nuevo cliente</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="quick-customer-name">Nombre Completo *</label>
            <input
              className="form-input"
              id="quick-customer-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="quick-customer-phone">Telefono *</label>
            <input
              className={`form-input ${error ? 'invalid' : ''}`}
              id="quick-customer-phone"
              type="tel"
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'quick-customer-error' : undefined}
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (error) setError('');
              }}
            />
            {error && <p id="quick-customer-error" className="form-help-text validation-message error" role="alert">{error}</p>}
          </div>
          {creditMode && <div className="form-group">
            <label className="form-label" htmlFor="quick-customer-credit-limit">Límite de crédito *</label>
            <input
              className={`form-input ${creditError ? 'invalid' : ''}`}
              id="quick-customer-credit-limit"
              type="text"
              inputMode="decimal"
              required
              value={creditLimitDraft}
              aria-invalid={Boolean(creditError)}
              aria-describedby="quick-customer-credit-help quick-customer-credit-error"
              onChange={(event) => {
                if (isMoneyInputDraft(event.target.value)) setCreditLimitDraft(event.target.value);
              }}
              onBlur={() => {
                const normalized = normalizeMoneyInputDraft(creditLimitDraft);
                if (normalized !== null) setCreditLimitDraft(normalized);
              }}
            />
            <p id="quick-customer-credit-help" className="form-help-text">Autoriza un límite para este cliente. Debe ser mayor a cero{minimumCredit.gt(0) ? ` y cubrir el saldo pendiente de $${minimumCredit.toFixed(2)}` : ''}.</p>
            <p id="quick-customer-credit-error" className="form-help-text validation-message error" role={creditError ? 'alert' : undefined}>{creditError}</p>
          </div>}
          <button type="submit" className="btn btn-save" disabled={isLoading || (creditMode && !hasValidCredit)}>
            {isLoading ? 'Guardando...' : 'Guardar Cliente'}
          </button>
          <button type="button" className="btn btn-cancel" onClick={dismissModal} disabled={isLoading}>
            Cancelar
          </button>
        </form>
      </div>
    </div>
  );
}
