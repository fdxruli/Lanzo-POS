import React, { useState, useEffect } from 'react';
import { Info } from 'lucide-react'; // Asegúrate de tener este icono o usa otro
import './CustomerForm.css';

// Recibimos 'globalCreditLimit' para sugerirlo por defecto
export default function CustomerForm({ onSave, onCancel, customerToEdit, allCustomers, globalCreditLimit = 0 }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [creditLimit, setCreditLimit] = useState(0);
  const [phoneError, setPhoneError] = useState('');

  useEffect(() => {
    if (customerToEdit) {
      setName(customerToEdit.name);
      setPhone(customerToEdit.phone || '');
      setAddress(customerToEdit.address || '');
      // Si ya tiene límite lo usamos, si no, asumimos 0 (sin crédito) o el que tenga guardado
      setCreditLimit(customerToEdit.creditLimit !== undefined ? customerToEdit.creditLimit : 0);
    } else {
      // NUEVO CLIENTE: Sugerimos el límite global configurado
      setName('');
      setPhone('');
      setAddress('');
      setCreditLimit(globalCreditLimit); 
    }
  }, [customerToEdit, globalCreditLimit]);

  const validatePhone = (currentPhone) => {
    // Permitir teléfono vacío si no es obligatorio, pero si se escribe, validar unicidad
    if (!currentPhone) {
        setPhoneError('');
        return true;
    }
    const editingId = customerToEdit ? customerToEdit.id : null;
    const existingCustomer = allCustomers.find(
      c => c.phone === currentPhone && c.id !== editingId
    );

    if (existingCustomer) {
      setPhoneError(`Teléfono ya usado por: ${existingCustomer.name}`);
      return false;
    } else {
      setPhoneError('');
      return true;
    }
  };

  const handlePhoneChange = (e) => {
    const newPhone = e.target.value;
    setPhone(newPhone);
    validatePhone(newPhone);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim().length === 0) {
      alert("El nombre del cliente no puede estar vacío.");
      return;
    }
    if (validatePhone(phone)) {
      onSave({ 
        name, 
        phone, 
        address, 
        creditLimit: parseFloat(creditLimit) || 0 // Aseguramos que sea número
      });
    }
  };

  return (
    <div className="customer-form-container">
      <h3 className="subtitle" id="customer-form-title">
        {customerToEdit ? `Editar: ${customerToEdit.name}` : 'Añadir Nuevo Cliente'}
      </h3>
      <form id="customer-form" onSubmit={handleSubmit}>
        
        {/* --- Sección de Datos Básicos --- */}
        <div className="form-group">
          <label className="form-label" htmlFor="customer-name">Nombre Completo *</label>
          <input
            className="form-input"
            id="customer-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Juan Pérez"
          />
        </div>

        <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            <div className="form-group">
            <label className="form-label" htmlFor="customer-phone">Teléfono</label>
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

            {/* --- NUEVO CAMPO: Límite de Crédito --- */}
            <div className="form-group">
                <label className="form-label" htmlFor="credit-limit" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    Límite de Crédito ($)
                    <span title="Monto máximo que se le puede fiar a este cliente. Ponga 0 para desactivar fiado.">
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
          <label className="form-label" htmlFor="customer-address">Dirección</label>
          <textarea
            className="form-textarea"
            id="customer-address"
            rows="2"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Dirección de entrega..."
          ></textarea>
        </div>

        <div className="form-actions" style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button type="submit" className="btn btn-save" style={{ flex: 1 }} disabled={!!phoneError}>
            Guardar Cliente
            </button>
            {customerToEdit && (
            <button type="button" className="btn btn-cancel" onClick={onCancel}>
                Cancelar
            </button>
            )}
        </div>
      </form>
    </div>
  );
}