import { useState, useEffect } from 'react';
import { Info } from 'lucide-react';
import './CustomerForm.css';

// Recibimos 'globalCreditLimit' para sugerirlo por defecto
export default function CustomerForm({ onSave, onCancel, customerToEdit, globalCreditLimit = 0 }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [creditLimit, setCreditLimit] = useState(0);
  const [phoneError, setPhoneError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (customerToEdit) {
      setName(customerToEdit.name);
      setPhone(customerToEdit.phone || '');
      setAddress(customerToEdit.address || '');
      // Si ya tiene limite lo usamos, si no, asumimos 0 (sin credito) o el que tenga guardado
      setCreditLimit(customerToEdit.creditLimit !== undefined ? customerToEdit.creditLimit : 0);
    } else {
      // NUEVO CLIENTE: Sugerimos el limite global configurado
      setName('');
      setPhone('');
      setAddress('');
      setCreditLimit(globalCreditLimit);
    }

    setPhoneError('');
    setIsSaving(false);
  }, [customerToEdit, globalCreditLimit]);

  const handlePhoneChange = (e) => {
    setPhone(e.target.value);
    if (phoneError) {
      setPhoneError('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isSaving) return;

    if (name.trim().length === 0) {
      alert('El nombre del cliente no puede estar vacio.');
      return;
    }

    setIsSaving(true);
    setPhoneError('');

    try {
      const result = await onSave({
        name,
        phone,
        address,
        creditLimit: parseFloat(creditLimit) || 0
      });

      if (result?.success === false && result?.fieldErrors?.phone) {
        setPhoneError(result.fieldErrors.phone);
      }
    } catch {
      setPhoneError('No se pudo validar el telefono. Intenta de nuevo.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="customer-form-container">
      <h3 className="subtitle" id="customer-form-title">
        {customerToEdit ? `Editar: ${customerToEdit.name}` : 'Anadir Nuevo Cliente'}
      </h3>
      <form id="customer-form" onSubmit={handleSubmit}>

        {/* --- Seccion de Datos Basicos --- */}
        <div className="form-group">
          <label className="form-label" htmlFor="customer-name">Nombre Completo *</label>
          <input
            className="form-input"
            id="customer-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Juan Perez"
          />
        </div>

        <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="customer-phone">Telefono</label>
            <input
              className={`form-input ${phoneError ? 'invalid' : ''}`}
              id="customer-phone"
              type="tel"
              value={phone}
              onChange={handlePhoneChange}
              placeholder="Opcional"
            />
            {phoneError && <p className="form-help-text validation-message error">{phoneError}</p>}
          </div>

          {/* --- NUEVO CAMPO: Limite de Credito --- */}
          <div className="form-group">
            <label className="form-label" htmlFor="credit-limit" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              Limite de Credito ($)
              <span title="Monto maximo que se le puede fiar a este cliente. Ponga 0 para desactivar fiado.">
                <Info size={14} color="#718096" />
              </span>
            </label>
            <input
              className="form-input"
              id="credit-limit"
              type="number"
              min="0"
              step="50"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
            />
            <p className="form-help-text" style={{ fontSize: '0.75rem', marginTop: '4px', color: '#718096' }}>
              {customerToEdit ? `Deuda actual: $${customerToEdit.debt || 0}` : `Global sugerido: $${globalCreditLimit}`}
            </p>
          </div>
        </div>

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

        <div className="form-actions" style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
          <button type="submit" className="btn btn-save" style={{ flex: 1 }} disabled={isSaving}>
            {isSaving ? 'Guardando...' : 'Guardar Cliente'}
          </button>
          {customerToEdit && (
            <button type="button" className="btn btn-cancel" onClick={onCancel} disabled={isSaving}>
              Cancelar
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
