// src/components/common/QuickAddCustomerModal.jsx
import { useState } from 'react';
import { saveDataSafe, STORES, DB_ERROR_CODES } from '../../services/database';
import './QuickAddCustomerModal.css';
import { generateID } from '../../services/utils';

const getFriendlyError = (result) => {
  if (!result?.error) {
    return 'Error al guardar el cliente.';
  }

  const { code, details } = result.error;
  if (code === DB_ERROR_CODES.CONSTRAINT_VIOLATION && details?.field === 'phone') {
    return result.error.message || 'El telefono ya esta registrado para otro cliente.';
  }

  return result.error.message || result.message || 'Error al guardar el cliente.';
};

export default function QuickAddCustomerModal({ show, onClose, onCustomerSaved }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const newCustomer = {
        id: generateID('cust'),
        name,
        phone,
        address: '',
        debt: 0,
        creditLimit: 0
      };

      const result = await saveDataSafe(STORES.CUSTOMERS, newCustomer);
      if (!result.success) {
        setError(getFriendlyError(result));
        return;
      }

      onCustomerSaved(newCustomer);
      handleClose();
    } catch {
      setError('Error al guardar el cliente.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setPhone('');
    setError('');
    onClose();
  };

  if (!show) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 11001 }}>
      <div className="modal-content quick-add-modal">
        <h2 className="modal-title">Anadir Cliente Rapido</h2>
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
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="quick-customer-phone">Telefono *</label>
            <input
              className={`form-input ${error ? 'invalid' : ''}`}
              id="quick-customer-phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (error) setError('');
              }}
            />
            {error && <p className="form-help-text validation-message error">{error}</p>}
          </div>
          <button type="submit" className="btn btn-save" disabled={isLoading}>
            {isLoading ? 'Guardando...' : 'Guardar Cliente'}
          </button>
          <button type="button" className="btn btn-cancel" onClick={handleClose} disabled={isLoading}>
            Cancelar
          </button>
        </form>
      </div>
    </div>
  );
}
