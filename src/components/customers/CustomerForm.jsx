import { useState, useEffect, useRef } from 'react';
import { Info } from 'lucide-react';
import { getCustomerPhoneValidationError } from '../../services/db/customerPhoneUtils';
import { validateDirectoryCreditLimit } from '../../services/customers/customerCreditLimit';
import './CustomerForm.css';

// Recibimos 'globalCreditLimit' para sugerirlo por defecto
export default function CustomerForm({ onSave, onCancel, customerToEdit, globalCreditLimit = 0 }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [creditLimit, setCreditLimit] = useState('0');
  const [nameError, setNameError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [creditLimitError, setCreditLimitError] = useState('');
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const phoneInputRef = useRef(null);
  const creditLimitInputRef = useRef(null);

  useEffect(() => {
    if (customerToEdit) {
      setName(customerToEdit.name);
      setPhone(customerToEdit.phone || '');
      setAddress(customerToEdit.address || '');
      // Si ya tiene limite lo usamos, si no, asumimos 0 (sin credito) o el que tenga guardado
      setCreditLimit(String(customerToEdit.creditLimit ?? 0));
    } else {
      // NUEVO CLIENTE: Sugerimos el limite global configurado
      setName('');
      setPhone('');
      setAddress('');
      setCreditLimit(String(globalCreditLimit ?? 0));
    }

    isSavingRef.current = false;
    setNameError('');
    setPhoneError('');
    setCreditLimitError('');
    setFormError('');
    setIsSaving(false);
  }, [customerToEdit, globalCreditLimit]);

  const handlePhoneChange = (e) => {
    setPhone(e.target.value);
    if (phoneError) {
      setPhoneError('');
    }
  };

  const handleCreditLimitChange = (event) => {
    setCreditLimit(event.target.value);
    setCreditLimitError('');
    setFormError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isSavingRef.current) return;

    if (name.trim().length === 0) {
      setNameError('El nombre del cliente no puede estar vacío.');
      return;
    }
    setNameError('');

    const phoneValidationError = getCustomerPhoneValidationError(phone);
    if (phoneValidationError) {
      setPhoneError(phoneValidationError);
      phoneInputRef.current?.focus();
      return;
    }

    const validatedCreditLimit = validateDirectoryCreditLimit(creditLimit);
    if (!validatedCreditLimit.valid) {
      setCreditLimitError(validatedCreditLimit.error);
      creditLimitInputRef.current?.focus();
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setPhoneError('');
    setCreditLimitError('');
    setFormError('');

    try {
      const result = await onSave({
        name,
        phone,
        address,
        creditLimit: validatedCreditLimit.value
      });

      if (result?.success === false && result?.fieldErrors?.phone) {
        setPhoneError(result.fieldErrors.phone);
        phoneInputRef.current?.focus();
      } else if (result?.success === false && result?.fieldErrors?.creditLimit) {
        setCreditLimitError(result.fieldErrors.creditLimit);
        creditLimitInputRef.current?.focus();
      } else if (result?.success === false) {
        setFormError(result.message || 'No se pudo guardar el cliente. Intenta de nuevo.');
      }
    } catch {
      setFormError('No se pudo guardar el cliente. Intenta de nuevo.');
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <div className="customer-form-container">
      <h3 className="subtitle" id="customer-form-title">
        {customerToEdit ? `Editar: ${customerToEdit.name}` : 'Anadir Nuevo Cliente'}
      </h3>
      <form id="customer-form" onSubmit={handleSubmit} noValidate>

        {/* --- Seccion de Datos Basicos --- */}
        <div className="form-group">
          <label className="form-label" htmlFor="customer-name">Nombre Completo *</label>
          <input
            className="form-input"
            id="customer-name"
            type="text"
            required
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? 'customer-name-error' : undefined}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError('');
            }}
            placeholder="Ej. Juan Perez"
          />
          {nameError && <p id="customer-name-error" className="form-help-text validation-message error" role="alert">{nameError}</p>}
        </div>

        <div className="form-row customer-form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="customer-phone">Teléfono *</label>
            <input
              className={`form-input ${phoneError ? 'invalid' : ''}`}
              id="customer-phone"
              type="tel"
              required
              ref={phoneInputRef}
              aria-invalid={Boolean(phoneError)}
              aria-describedby={phoneError ? 'customer-phone-error' : undefined}
              value={phone}
              onChange={handlePhoneChange}
              placeholder="Ej. 555 123 4567"
            />
            {phoneError && <p id="customer-phone-error" className="form-help-text validation-message error" role="alert">{phoneError}</p>}
          </div>

          {/* --- NUEVO CAMPO: Limite de Credito --- */}
          <div className="form-group">
            <label className="form-label customer-credit-label" htmlFor="credit-limit">
              Limite de Credito ($)
              <span title="Monto maximo que se le puede fiar a este cliente. Ponga 0 para desactivar fiado.">
                <Info size={14} className="customer-credit-info-icon" />
              </span>
            </label>
            <input
              className={`form-input ${creditLimitError ? 'invalid' : ''}`}
              id="credit-limit"
              type="text"
              inputMode="decimal"
              ref={creditLimitInputRef}
              aria-invalid={Boolean(creditLimitError)}
              aria-describedby={creditLimitError ? 'customer-credit-limit-help customer-credit-limit-error' : 'customer-credit-limit-help'}
              value={creditLimit}
              onChange={handleCreditLimitChange}
            />
            <p id="customer-credit-limit-help" className="form-help-text customer-credit-help">
              $0 desactiva Fiado; los límites de Clientes deben ser múltiplos de $50.
              {' '}
              {customerToEdit ? `Deuda actual: $${customerToEdit.debt || 0}` : `Global sugerido: $${globalCreditLimit}`}
            </p>
            {creditLimitError && <p id="customer-credit-limit-error" className="form-help-text validation-message error" role="alert">{creditLimitError}</p>}
          </div>
        </div>

        {formError && <p className="form-help-text validation-message error" role="alert">{formError}</p>}

        <div className="form-group">
          <label className="form-label" htmlFor="customer-address">Direccion</label>
          <textarea
            className="form-textarea"
            id="customer-address"
            rows="2"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Direccion de entrega..."
          ></textarea>
        </div>

        <div className="form-actions customer-form-actions">
          <button type="submit" className="ui-button ui-button--primary btn btn-save" disabled={isSaving}>
            {isSaving ? 'Guardando...' : 'Guardar Cliente'}
          </button>
          <button type="button" className="ui-button ui-button--ghost btn btn-cancel" onClick={onCancel} disabled={isSaving}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
