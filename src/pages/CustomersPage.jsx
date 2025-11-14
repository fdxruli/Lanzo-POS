import React, { useState, useEffect } from 'react';
// Importamos la lógica pura de tu database.js original
import { loadData, saveData, deleteData, STORES } from '../services/database'; 
// Importamos tus componentes visuales (del Paso 3)
import CustomerForm from '../components/customers/CustomerForm';
import CustomerList from '../components/customers/CustomerList';

export default function CustomersPage() {
  // 1. ESTADO (STATE)
  // Reemplaza tus variables globales
  const [activeTab, setActiveTab] = useState('add-customer');
  const [customers, setCustomers] = useState([]);
  const [editingCustomer, setEditingCustomer] = useState(null); // Para saber a quién editamos
  const [loading, setLoading] = useState(true);

  // 2. EFECTO (EFFECT)
  // Reemplaza 'loadAndRenderCustomers'
  // 'useEffect' con [] se ejecuta 1 vez cuando el componente carga
  useEffect(() => {
    loadCustomers();
  }, []);

  // 3. ACCIONES (FUNCIONES)

  /**
   * Carga los clientes desde IndexedDB y los guarda en el estado
   */
  const loadCustomers = async () => {
    setLoading(true);
    const customerData = await loadData(STORES.CUSTOMERS);
    setCustomers(customerData);
    setLoading(false);
  };

  /**
   * Guarda un cliente (nuevo o editado)
   * Reemplaza 'handleFormSubmit'
   */
  const handleSaveCustomer = async (customerData) => {
    try {
      const id = editingCustomer ? editingCustomer.id : `customer-${Date.now()}`;
      const dataToSave = { ...customerData, id };
      
      await saveData(STORES.CUSTOMERS, dataToSave);
      
      // Limpiamos el formulario y recargamos la lista
      setEditingCustomer(null);
      setActiveTab('view-customers'); // Cambiamos a la pestaña de "ver"
      loadCustomers(); // Recarga la lista
      
      // (Aquí iría tu showMessageModal)
      console.log('¡Cliente guardado con éxito!');

    } catch (error) {
      console.error('Error al guardar cliente:', error);
    }
  };

  /**
   * Prepara el formulario para edición
   * Reemplaza la lógica 'btn-edit' de tu listener
   */
  const handleEditCustomer = (customer) => {
    setEditingCustomer(customer);
    setActiveTab('add-customer'); // Cambia a la pestaña del formulario
  };

  /**
   * Elimina un cliente
   * Reemplaza la lógica 'btn-delete'
   */
  const handleDeleteCustomer = async (customerId) => {
    // (Aquí mostrarías un modal de confirmación)
    if (window.confirm('¿Seguro que quieres eliminar este cliente?')) {
      await deleteData(STORES.CUSTOMERS, customerId);
      loadCustomers(); // Recarga la lista
    }
  };
  
  /**
   * Cancela la edición
   */
  const handleCancelEdit = () => {
    setEditingCustomer(null);
  };

  // 4. VISTA (RENDER)
  // Pasamos los datos y funciones a los componentes hijos
  return (
    <>
      <h2 className="section-title">Administración de Clientes</h2>
      
      <div className="tabs-container" id="customers-tabs">
        <button
          className={`tab-btn ${activeTab === 'add-customer' ? 'active' : ''}`}
          onClick={() => setActiveTab('add-customer')}
        >
          {editingCustomer ? 'Editar Cliente' : 'Añadir Cliente'}
        </button>
        <button
          className={`tab-btn ${activeTab === 'view-customers' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('view-customers');
            handleCancelEdit(); // Limpia la edición si nos movemos
          }}
        >
          Ver Clientes
        </button>
      </div>

      {activeTab === 'add-customer' ? (
        <CustomerForm 
          onSave={handleSaveCustomer}
          onCancel={handleCancelEdit}
          // Pasamos el cliente a editar y la lista para validación
          customerToEdit={editingCustomer}
          allCustomers={customers}
        />
      ) : (
        <CustomerList 
          customers={customers}
          isLoading={loading}
          onEdit={handleEditCustomer}
          onDelete={handleDeleteCustomer}
        />
      )}
    </>
  );
}