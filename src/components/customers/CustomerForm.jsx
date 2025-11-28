import React, { useState, useEffect } from 'react';
import './CustomerForm.css';

export default function CustomerForm({ onSave, onCancel, customerToEdit, allCustomers }) {
  // Estado local del formulario
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [phoneError, setPhoneError] = useState('');

  // 'useEffect' para rellenar el formulario si estamos editando
  useEffect(() => {
    if (customerToEdit) {
      setName(customerToEdit.name);
      setPhone(customerToEdit.phone);
      setAddress(customerToEdit.address);
    } else {
      // Si no estamos editando (ej. se canceló), limpiar
      setName('');
      setPhone('');
      setAddress('');
    }
  }, [customerToEdit]); // Se ejecuta cada vez que 'customerToEdit' cambia

  /**
   * Valida el teléfono en tiempo real
   * Lógica de 'validatePhoneNumber'
   */
  const validatePhone = (currentPhone) => {
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
      // Llama a la función 'onSave' que nos pasó el padre
      onSave({ name, phone, address });
    }
  };

  // HTML traducido a JSX de 'add-customer-content'
  return (
    <div className="customer-form-container">
      <h3 className="subtitle" id="customer-form-title">
        {customerToEdit ? `Editar: ${customerToEdit.name}` : 'Añadir Nuevo Cliente'}
      </h3>
      <form id="customer-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label" htmlFor="customer-name">Nombre Completo</label>
          <input
            className="form-input"
            id="customer-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="customer-phone">Teléfono</label>
          <input
            className={`form-input ${phoneError ? 'invalid' : ''}`}
            id="customer-phone"
            type="tel"
            required
            value={phone}
            onChange={handlePhoneChange}
          />
          <p id="phone-validation-message" className="form-help-text validation-message error">
            {phoneError}
          </p>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="customer-address">Dirección</label>
          <textarea
            className="form-textarea"
            id="customer-address"
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          ></textarea>
        </div>
        <button type="submit" className="btn btn-save" disabled={!!phoneError}>
          Guardar Cliente
        </button>
        {/* Mostramos 'Cancelar' solo si estamos editando */}
        {customerToEdit && (
          <button type="button" id="cancel-customer-edit-btn" className="btn btn-cancel" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </form>
    </div>
  );
}