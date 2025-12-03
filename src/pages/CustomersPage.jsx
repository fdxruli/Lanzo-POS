// src/pages/CustomersPage.jsx
import React, { useState, useEffect } from 'react';
import CustomerForm from '../components/customers/CustomerForm';
import CustomerList from '../components/customers/CustomerList';
import PurchaseHistoryModal from '../components/customers/PurchaseHistoryModal';
import AbonoModal from '../components/common/AbonoModal';
import { useCaja } from '../hooks/useCaja';
import { showMessageModal, sendWhatsAppMessage } from '../services/utils';
import { useAppStore } from '../store/useAppStore';
import { useNavigate } from 'react-router-dom';
import {
  saveDataSafe,
  deleteDataSafe,
  loadDataPaginated,
  loadData,
  STORES
} from '../services/database';

export default function CustomersPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('add-customer');
  const [customers, setCustomers] = useState([]);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 50;
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isAbonoModalOpen, setIsAbonoModalOpen] = useState(false);
  const [whatsAppLoading, setWhatsAppLoading] = useState(null);

  const { registrarMovimiento, cajaActual } = useCaja();
  const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');

  // ... (funciones loadCustomers, handleSaveCustomer, handleEditCustomer, handleDeleteCustomer, etc. SIN CAMBIOS) ...
  useEffect(() => {
    loadInitialCustomers();
  }, []);

  const loadInitialCustomers = async () => {
    setLoading(true);
    try {
      const data = await loadDataPaginated(STORES.CUSTOMERS, { limit: PAGE_SIZE, offset: 0 });
      setCustomers(data);
      setPage(1);
      setHasMore(data.length === PAGE_SIZE);
    } catch (error) {
      console.error("Error cargando clientes:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreCustomers = async () => {
    if (!hasMore) return;
    setLoading(true);
    try {
      const nextData = await loadDataPaginated(STORES.CUSTOMERS, {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      });

      if (nextData.length > 0) {
        setCustomers(prev => [...prev, ...nextData]);
        setPage(prev => prev + 1);
        setHasMore(nextData.length === PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Error paginando:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleActionableError = (result) => {
    const { message, details } = result.error;

    // Opción 1: Sugerir Recarga (DB Bloqueada/Desconectada)
    if (details.actionable === 'SUGGEST_RELOAD') {
      showMessageModal(message, () => window.location.reload(), {
        confirmButtonText: 'Recargar Página'
      });
    }
    // Opción 2: Sugerir Respaldo (Disco Lleno)
    else if (details.actionable === 'SUGGEST_BACKUP') {
      // CORREGIDO: Usamos navigate y corregimos la ruta '/configuracion'
      showMessageModal(message, () => navigate('/configuracion'), {
        confirmButtonText: 'Ir a Respaldar'
      });
    }
    // Opción 3: Error Genérico
    else {
      showMessageModal(message, null, { type: 'error' });
    }
  };

  const handleSaveCustomer = async (customerData) => {
    try {
      const id = editingCustomer ? editingCustomer.id : `customer-${Date.now()}`;
      const existingDebt = editingCustomer ? editingCustomer.debt : 0;
      const dataToSave = { ...customerData, id, debt: existingDebt };

      // --- CAMBIO: Usamos versión Segura ---
      const result = await saveDataSafe(STORES.CUSTOMERS, dataToSave);

      if (!result.success) {
        handleActionableError(result);
        return; // Detenemos si falló
      }
      // ------------------------------------

      setEditingCustomer(null);
      setActiveTab('view-customers');
      loadInitialCustomers();
      showMessageModal('¡Cliente guardado con éxito!');

    } catch (error) {
      console.error('Error al guardar cliente:', error);
      showMessageModal('Error inesperado al guardar cliente.');
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

      if (customer) {
        const deletedCustomer = {
          ...customer,
          deletedTimestamp: new Date().toISOString()
        };
        const trashResult = await saveDataSafe(STORES.DELETED_CUSTOMERS, deletedCustomer);
        if (!trashResult.success) {
          handleActionableError(trashResult);
          return;
        }
      }

      const deleteResult = await deleteDataSafe(STORES.CUSTOMERS, customerId);
      if (!deleteResult.success) {
        handleActionableError(deleteResult);
        return;
      }
      loadInitialCustomers();
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
    try {
      const concepto = `Abono de cliente: ${customer.name}`;

      // 1. Registrar en caja (existente)
      const movimientoExitoso = await registrarMovimiento('entrada', amount, concepto);
      if (!movimientoExitoso) {
        showMessageModal('Error: No se pudo registrar en caja (¿Caja cerrada?).');
        handleCloseModals();
        return;
      }

      // 2. Cargar cliente (usamos loadData normal porque es lectura simple)
      const customerData = await loadData(STORES.CUSTOMERS, customer.id);
      const deudaAnterior = customerData.debt || 0;
      const nuevaDeuda = Math.max(0, deudaAnterior - amount);
      customerData.debt = nuevaDeuda;

      // 3. --- REFACTORIZACIÓN A SAFE ---
      const result = await saveDataSafe(STORES.CUSTOMERS, customerData);

      if (!result.success) {
        // Usamos tu helper de errores accionables si existe, o mensaje directo
        if (result.error && result.error.details) {
          handleActionableError(result); // Reutilizamos tu función de manejo de errores
        } else {
          showMessageModal(`Error al guardar el abono: ${result.error?.message || 'Desconocido'}`);
        }
        handleCloseModals();
        return;
      }

      showMessageModal('¡Abono registrado exitosamente!');
      handleCloseModals();
      loadInitialCustomers();

      // 3. Enviar Recibo (Opcional)
      if (sendReceipt) {
        const message =
          `*--- Recibo de Abono ---*\n` +
          `*Negocio:* ${companyName}\n\n` +
          `Hola *${customer.name}*,\n` +
          `Hemos registrado tu abono:\n\n` +
          `Monto Abonado: *$${amount.toFixed(2)}*\n` +
          `Deuda Anterior: $${deudaAnterior.toFixed(2)}\n` +
          `*Saldo Restante: $${nuevaDeuda.toFixed(2)}*\n\n` +
          `¡Gracias por tu pago!`;

        sendWhatsAppMessage(customer.phone, message);
      }

    } catch (error) {
      console.error('Error crítico en abono:', error);
      showMessageModal(`Error al procesar: ${error.message}`);
      // ✅ MEJORA CRÍTICA: Aseguramos que el modal se cierre si hay error de sistema
      handleCloseModals();
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

        // 1. Obtener ventas a crédito históricas (ordenadas de la más reciente a la más antigua)
        const fiadoSales = allSales
          .filter(sale =>
            sale.customerId === customer.id &&
            sale.paymentMethod === 'fiado' &&
            sale.saldoPendiente > 0
          )
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // 2. Distribuir la deuda actual entre las notas más recientes (Lógica LIFO inversa)
        let remainingDebtToAllocate = customer.debt;
        const salesToReport = [];

        for (const sale of fiadoSales) {
          if (remainingDebtToAllocate <= 0.01) break;

          const amountOwedForThisSale = Math.min(sale.saldoPendiente, remainingDebtToAllocate);

          salesToReport.push({
            ...sale,
            currentOwed: amountOwedForThisSale
          });

          remainingDebtToAllocate -= amountOwedForThisSale;
        }

        // Reordenar cronológicamente para el reporte (opcional, pero se lee mejor)
        salesToReport.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // 3. Construir el mensaje detallado
        message = `*--- Estado de Cuenta ---*
*Negocio:* ${companyName}
Hola *${customer.name}*,

A continuación el detalle de su saldo pendiente con nosotros.

*DEUDA TOTAL A LA FECHA: $${customer.debt.toFixed(2)}*
--------------------------------
*Detalle de notas pendientes:*
`;

        if (salesToReport.length > 0) {
          salesToReport.forEach(sale => {
            const saleDate = new Date(sale.timestamp).toLocaleDateString();

            // Lista de productos limpia
            let itemsString = "";
            sale.items.forEach(item => {
              itemsString += `  • ${item.name} (x${item.quantity})\n`;
            });

            // Lógica para mostrar si hubo abono inicial
            const abonoInicial = sale.abono || 0;
            let detallesPago = "";

            if (abonoInicial > 0) {
              detallesPago = `*Total Nota:* $${sale.total.toFixed(2)}\n*Abono inicial:* -$${abonoInicial.toFixed(2)}\n*Saldo Original:* $${sale.saldoPendiente.toFixed(2)}`;
            } else {
              detallesPago = `*Total Nota:* $${sale.total.toFixed(2)} (Sin abono inicial)`;
            }

            message += `
📅 *Fecha:* ${saleDate}
${detallesPago}

🔴 *Resta por pagar de esta nota:* $${sale.currentOwed.toFixed(2)}

_Productos:_
${itemsString}
--------------------------------
`;
          });
        } else {
          message += `\nFavor de pasar a realizar su abono para regularizar su cuenta.`;
        }

        message += `\n¡Gracias por su preferencia!`;

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
          allCustomers={customers} // Nota: Esto pasará solo los cargados. Para validación perfecta, idealmente CustomerForm buscaría en BD.
        />
      ) : (
        <>
          <CustomerList
            customers={customers}
            isLoading={loading && customers.length === 0} // Solo loading full si está vacío
            onEdit={handleEditCustomer}
            onDelete={handleDeleteCustomer}
            onViewHistory={handleViewHistory}
            onAbonar={handleOpenAbono}
            onWhatsApp={handleWhatsApp}
            onWhatsAppLoading={whatsAppLoading}
          />

          {/* BOTÓN CARGAR MÁS */}
          {hasMore && (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <button
                className="btn btn-secondary"
                onClick={loadMoreCustomers}
                disabled={loading}
              >
                {loading ? 'Cargando...' : '⬇️ Cargar más clientes'}
              </button>
            </div>
          )}
        </>
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