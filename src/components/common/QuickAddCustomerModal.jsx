// src/components/common/QuickAddCustomerModal.jsx
import React, { useState } from 'react';
import { loadData, saveDataSafe, STORES } from '../../services/database';
import './QuickAddCustomerModal.css';
import { generateID } from '../../services/utils';

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
      // Validar si el teléfono ya existe (lógica de CustomerForm)
      const allCustomers = await loadData(STORES.CUSTOMERS);
      const existing = allCustomers.find(c => c.phone === phone);
      if (existing) {
        setError(`El teléfono ya está registrado para: ${existing.name}`);
        setIsLoading(false);
        return;
      }

      // Guardar
      const newCustomer = {
        id: generateID('cust'),
        name,
        phone,
        address: '', // Lo dejamos vacío por rapidez
        debt: 0
      };
      
      const result = await saveDataSafe(STORES.CUSTOMERS, newCustomer);
      if (!result.success){
        setError(result.error.message);
        setIsLoading(false);
        return;
      }
      
      // Devolver el cliente al modal de pago
      onCustomerSaved(newCustomer);
      handleClose();

    } catch (err) {
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
    <div className="modal" style={{ display: 'flex', zIndex: 2200 }}>
      <div className="modal-content quick-add-modal">
        <h2 className="modal-title">Añadir Cliente Rápido</h2>
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
            <label className="form-label" htmlFor="quick-customer-phone">Teléfono *</label>
            <input
              className={`form-input ${error ? 'invalid' : ''}`}
              id="quick-customer-phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
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