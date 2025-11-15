// src/pages/CustomersPage.jsx
import React, { useState, useEffect } from 'react';
import { loadData, saveData, deleteData, STORES } from '../services/database'; 
import CustomerForm from '../components/customers/CustomerForm';
import CustomerList from '../components/customers/CustomerList';
import PurchaseHistoryModal from '../components/customers/PurchaseHistoryModal';
import AbonoModal from '../components/common/AbonoModal';
import { useCaja } from '../hooks/useCaja';
import { showMessageModal, sendWhatsAppMessage } from '../services/utils';
import { useAppStore } from '../store/useAppStore';

export default function CustomersPage() {
  // ... (estados existentes sin cambios) ...
  const [activeTab, setActiveTab] = useState('add-customer');
  const [customers, setCustomers] = useState([]);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isAbonoModalOpen, setIsAbonoModalOpen] = useState(false);
  const [whatsAppLoading, setWhatsAppLoading] = useState(null);
  
  const { registrarMovimiento, cajaActual } = useCaja();
  const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');

  // ... (funciones loadCustomers, handleSaveCustomer, handleEditCustomer, handleDeleteCustomer, etc. SIN CAMBIOS) ...
  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    setLoading(true);
    const customerData = await loadData(STORES.CUSTOMERS);
    setCustomers(customerData);
    setLoading(false);
  };

  const handleSaveCustomer = async (customerData) => {
    try {
      const id = editingCustomer ? editingCustomer.id : `customer-${Date.now()}`;
      const existingDebt = editingCustomer ? editingCustomer.debt : 0;
      const dataToSave = { ...customerData, id, debt: existingDebt };
      
      await saveData(STORES.CUSTOMERS, dataToSave);
      
      setEditingCustomer(null);
      setActiveTab('view-customers');
      loadCustomers();
      
      showMessageModal('¡Cliente guardado con éxito!');

    } catch (error) {
      console.error('Error al guardar cliente:', error);
      showMessageModal('Error al guardar cliente.');
    }
  };

  const handleEditCustomer = (customer) => {
    setEditingCustomer(customer);
    setActiveTab('add-customer');
  };

  const handleDeleteCustomer = async (customerId) => {
    if (window.confirm('¿Seguro que quieres eliminar este cliente?')) {
      const customer = customers.find(c => c.id === customerId);
      if (customer && customer.debt > 0) {
        showMessageModal('No se puede eliminar un cliente con deuda pendiente.');
        return;
      }
      
      await deleteData(STORES.CUSTOMERS, customerId);
      loadCustomers();
      showMessageModal('Cliente eliminado.');
    }
  };
  
  const handleCancelEdit = () => {
    setEditingCustomer(null);
  };
  
  const handleViewHistory = (customer) => {
    setSelectedCustomer(customer);
    setIsHistoryModalOpen(true);
  };

  const handleOpenAbono = (customer) => {
    if (!cajaActual || cajaActual.estado !== 'abierta') {
      showMessageModal('Debes tener una caja abierta para registrar un abono.');
      return;
    }
    setSelectedCustomer(customer);
    setIsAbonoModalOpen(true);
  };

  const handleCloseModals = () => {
    setSelectedCustomer(null);
    setIsHistoryModalOpen(false);
    setIsAbonoModalOpen(false);
  };
  
  const handleConfirmAbono = async (customer, amount, sendReceipt) => {
    // ... (esta función no cambia)
    try {
      const concepto = `Abono de cliente: ${customer.name}`;
      const movimientoExitoso = await registrarMovimiento('entrada', amount, concepto);
      
      if (!movimientoExitoso) {
        showMessageModal('Error al registrar la entrada en caja. Intenta de nuevo.');
        return;
      }

      const customerData = await loadData(STORES.CUSTOMERS, customer.id);
      const deudaAnterior = customerData.debt || 0;
      const nuevaDeuda = deudaAnterior - amount;
      customerData.debt = nuevaDeuda < 0 ? 0 : nuevaDeuda;
      
      await saveData(STORES.CUSTOMERS, customerData);
      
      showMessageModal('¡Abono registrado exitosamente!');
      handleCloseModals();
      loadCustomers(); 

      if (sendReceipt) {
        const message = 
`*--- Recibo de Abono ---*
*Negocio:* ${companyName}

Hola *${customer.name}*,
Hemos registrado tu abono:

Monto Abonado: *$${amount.toFixed(2)}*
Deuda Anterior: $${deudaAnterior.toFixed(2)}
*Saldo Restante: $${customerData.debt.toFixed(2)}*

¡Gracias por tu pago!`;
        
        sendWhatsAppMessage(customer.phone, message);
      }

    } catch (error) {
      console.error('Error al confirmar abono:', error);
      showMessageModal(`Error al procesar el abono: ${error.message}`);
    }
  };

  /**
   * FUNCIÓN DE WHATSAPP (¡ACTUALIZADA!)
   */
  const handleWhatsApp = async (customer) => {
    if (!customer.phone) {
      showMessageModal('Este cliente no tiene un teléfono registrado.');
      return;
    }

    setWhatsAppLoading(customer.id);
    let message = '';

    try {
      if (customer.debt > 0) {
        const allSales = await loadData(STORES.SALES);
        
        const fiadoSales = allSales
          .filter(sale => 
            sale.customerId === customer.id && 
            sale.paymentMethod === 'fiado' && 
            sale.saldoPendiente > 0
          )
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        message = `*--- Recordatorio de Saldo Pendiente ---*
*Negocio:* ${companyName}
Hola *${customer.name}*,

Este es un resumen de tu estado de cuenta con nosotros.

*Deuda Total Actual: $${customer.debt.toFixed(2)}*
`;

        if (fiadoSales.length > 0) {
          message += `
*Detalle de adeudos pendientes:*
`;
          fiadoSales.forEach(sale => {
            const saleDate = new Date(sale.timestamp).toLocaleDateString();
            
            // --- INICIO DE LA MODIFICACIÓN ---
            // 1. Crear el string de productos
            let itemsString = "\n_Productos en esta venta:_\n";
            sale.items.forEach(item => {
              // Usamos formato _italico_ para los productos
              itemsString += `_ - ${item.name} (x${item.quantity})_\n`;
            });
            // --- FIN DE LA MODIFICACIÓN ---

            message += `
*Fecha:* ${saleDate}
*Venta Total:* $${sale.total.toFixed(2)}
*Abono Inicial:* $${sale.abono.toFixed(2)}
*Saldo Pendiente (de esta venta): $${sale.saldoPendiente.toFixed(2)}*
${itemsString} {/* <-- 2. Añadimos el string de productos aquí */}
---
`;
          });
        } else {
          message += `\nGracias por tu preferencia. ¡Pasa a saldar tu cuenta cuando gustes!`;
        }
        message += `\n¡Esperamos tu visita!`;
      
      } else {
        message = `Hola ${customer.name}, te comunicas de ${companyName}. ¿En qué podemos ayudarte?`;
      }
      
      sendWhatsAppMessage(customer.phone, message);

    } catch (error) {
      console.error("Error al generar mensaje de WhatsApp:", error);
      showMessageModal('Error al generar el mensaje. Abriendo chat simple.');
      sendWhatsAppMessage(customer.phone, '');
    } finally {
      setWhatsAppLoading(null);
    }
  };

  // RENDER (Sin cambios, solo pasamos los props)
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
            handleCancelEdit();
          }}
        >
          Ver Clientes
        </button>
      </div>


      {activeTab === 'add-customer' ? (
        <CustomerForm 
          onSave={handleSaveCustomer}
          onCancel={handleCancelEdit}
          customerToEdit={editingCustomer}
          allCustomers={customers}
        />
      ) : (
        <CustomerList 
          customers={customers}
          isLoading={loading}
          onEdit={handleEditCustomer}
          onDelete={handleDeleteCustomer}
          onViewHistory={handleViewHistory}
          onAbonar={handleOpenAbono}
          onWhatsApp={handleWhatsApp}
          onWhatsAppLoading={whatsAppLoading}
        />
      )}
      
      <PurchaseHistoryModal
        show={isHistoryModalOpen}
        onClose={handleCloseModals}
        customer={selectedCustomer}
      />
      
      <AbonoModal
        show={isAbonoModalOpen}
        onClose={handleCloseModals}
        onConfirmAbono={handleConfirmAbono}
        customer={selectedCustomer}
      />
    </>
  );
}