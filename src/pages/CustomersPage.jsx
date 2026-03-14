// src/pages/CustomersPage.jsx
import { useState, useEffect } from 'react';
import CustomerForm from '../components/customers/CustomerForm';
import CustomerList from '../components/customers/CustomerList';
import PurchaseHistoryModal from '../components/customers/PurchaseHistoryModal';
import AbonoModal from '../components/customers/AbonoModal';
import LayawayModal from '../components/customers/LayawayModal';
import { useCaja } from '../hooks/useCaja';
import { showMessageModal, sendWhatsAppMessage } from '../services/utils';
import { useAppStore } from '../store/useAppStore';
import { useNavigate } from 'react-router-dom';
import Logger from '../services/Logger';
import { useSearchParams } from 'react-router-dom';
import { customerCreditRepository } from '../services/db/customerCreditRepository';
import { generateID } from '../services/utils';
import {
  saveDataSafe,
  loadDataPaginated,
  loadData,
  STORES,
  recycleData,
  DB_ERROR_CODES
} from '../services/database';
import { ChevronDown, Loader2 } from 'lucide-react';

export default function CustomersPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('add-customer');
  const [searchParams, setSearchParams] = useSearchParams();
  const [customers, setCustomers] = useState([]);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 50;
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isAbonoModalOpen, setIsAbonoModalOpen] = useState(false);
  const [whatsAppLoading, setWhatsAppLoading] = useState(null);
  const [isLayawayModalOpen, setIsLayawayModalOpen] = useState(false);

  const { cajaActual } = useCaja();
  const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');

  useEffect(() => {
    loadInitialCustomers();
  }, []);

  useEffect(() => {
    const tabParam = searchParams.get('tab');

    // Mapeo: URL -> Estado Interno
    if (tabParam === 'add') {
      setActiveTab('add-customer');
    } else if (tabParam === 'list') { // Usaremos 'list' para ver clientes
      setActiveTab('view-customers');
      setEditingCustomer(null); // Aseguramos limpiar edición al entrar por URL
    }
  }, [searchParams]);

  const handleTabChange = (internalTab) => {
    if (internalTab === 'view-customers') {
      setSearchParams({ tab: 'list' });
      handleCancelEdit(); // Mantenemos tu limpieza original
    } else if (internalTab === 'add-customer') {
      setSearchParams({ tab: 'add' });
    }
  };

  const loadInitialCustomers = async () => {
    setLoading(true);
    try {
      const { data = [], nextCursor: newCursor = null } = await loadDataPaginated(STORES.CUSTOMERS, {
        limit: PAGE_SIZE,
        cursor: null,
        timeIndex: 'createdAt'
      });
      const safeData = Array.isArray(data) ? data : [];
      setCustomers(safeData);
      setNextCursor(newCursor);
      setHasMore(Boolean(newCursor));
    } catch (error) {
      Logger.error("Error cargando clientes:", error);
      setCustomers([]);
      setNextCursor(null);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreCustomers = async () => {
    if (!hasMore || !nextCursor) return;
    setLoading(true);
    try {
      const { data = [], nextCursor: newCursor = null } = await loadDataPaginated(STORES.CUSTOMERS, {
        limit: PAGE_SIZE,
        cursor: nextCursor,
        timeIndex: 'createdAt'
      });

      const safeNextData = Array.isArray(data) ? data : [];

      if (safeNextData.length > 0) {
        setCustomers(prev => [...prev, ...safeNextData]);
        setNextCursor(newCursor);
        setHasMore(Boolean(newCursor));
      } else {
        setNextCursor(null);
        setHasMore(false);
      }
    } catch (error) {
      Logger.error("Error paginando:", error);
      setNextCursor(null);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const handleActionableError = (result) => {
    const message = result?.error?.message || result?.message || 'Error en base de datos.';
    const details = result?.error?.details || {};

    // Opcion 1: Sugerir Recarga (DB Bloqueada/Desconectada)
    if (details.actionable === 'SUGGEST_RELOAD') {
      showMessageModal(message, () => window.location.reload(), {
        confirmButtonText: 'Recargar Pagina'
      });
    }
    // Opcion 2: Sugerir Respaldo (Disco Lleno)
    else if (details.actionable === 'SUGGEST_BACKUP') {
      showMessageModal(message, () => navigate('/configuracion'), {
        confirmButtonText: 'Ir a Respaldar'
      });
    }
    // Opcion 3: Error generico
    else {
      showMessageModal(message, null, { type: 'error' });
    }
  };

  const getCustomerPhoneFieldError = (result) => {
    const code = result?.error?.code;
    const field = result?.error?.details?.field;

    if (code === DB_ERROR_CODES.CONSTRAINT_VIOLATION && field === 'phone') {
      return result?.error?.message || result?.message || 'El telefono ya esta registrado para otro cliente.';
    }

    return null;
  };

  const handleSaveCustomer = async (customerData) => {
    try {
      const id = editingCustomer ? editingCustomer.id : generateID('cust');
      const existingDebt = editingCustomer ? (parseFloat(editingCustomer.debt) || 0) : 0;
      const dataToSave = { ...customerData, id, debt: existingDebt };

      const result = await saveDataSafe(STORES.CUSTOMERS, dataToSave);

      if (!result.success) {
        const phoneFieldError = getCustomerPhoneFieldError(result);
        if (phoneFieldError) {
          return { success: false, fieldErrors: { phone: phoneFieldError } };
        }

        handleActionableError(result);
        return { success: false };
      }

      setEditingCustomer(null);
      setActiveTab('view-customers');
      await loadInitialCustomers();
      showMessageModal('Cliente guardado con exito!');

      return { success: true };
    } catch (error) {
      Logger.error('Error al guardar cliente:', error);
      showMessageModal('Error inesperado al guardar cliente.');
      return { success: false };
    }
  };
  const handleEditCustomer = (customer) => {
    setEditingCustomer(customer);
    setSearchParams({ tab: 'add' });
  };

  const handleDeleteCustomer = async (customerId) => {
    if (window.confirm('¿Seguro que quieres eliminar este cliente?')) {
      const customer = customers.find(c => c.id === customerId);

      // Validación de negocio (Deuda)
      if (customer && customer.debt > 0) {
        showMessageModal('No se puede eliminar un cliente con deuda pendiente.', null, { type: 'error' });
        return;
      }

      setLoading(true); // Opcional: mostrar spinner rápido

      try {
        // --- USANDO LA NUEVA LÓGICA CENTRALIZADA ---
        const result = await recycleData(
          STORES.CUSTOMERS,           // Origen
          STORES.DELETED_CUSTOMERS,   // Destino (Papelera)
          customerId,                 // ID
          "Eliminado desde Directorio" // Razón para auditoría
        );

        if (result.success) {
          // Éxito: Recargar la lista
          loadInitialCustomers();
          showMessageModal('Cliente enviado a la papelera.');
        } else {
          // Error
          showMessageModal(`No se pudo eliminar: ${result.message}`);
        }
      } catch (error) {
        Logger.error("Error eliminando cliente:", error);
        showMessageModal('Error inesperado al eliminar.');
      } finally {
        setLoading(false);
      }
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

  const handleOpenLayaways = (customer) => {
    setSelectedCustomer(customer);
    setIsLayawayModalOpen(true);
  };

  const handleCloseModals = () => {
    setSelectedCustomer(null);
    setIsHistoryModalOpen(false);
    setIsAbonoModalOpen(false);
    setIsLayawayModalOpen(false);
  };

  const handleConfirmAbono = async (customer, amount, sendReceipt) => {
    try {
      // 1. Verificación estricta de pre-condiciones en UI
      if (!cajaActual || cajaActual.estado !== 'abierta') {
        showMessageModal('Debes tener una caja abierta para registrar un abono.');
        handleCloseModals();
        return;
      }

      const concepto = `Abono de cliente: ${customer.name}`;
      const deudaAnterior = customer.debt || 0; // Capturamos para el recibo antes de mutar

      // 2. Ejecutar la transacción Atómica (Ledger + Cliente + Caja)
      // Delegamos TODO al repositorio. Si algo falla aquí, Dexie hace rollback automático.
      const result = await customerCreditRepository.processPayment(
        customer.id,
        amount,
        'efectivo',
        cajaActual.id,
        concepto
      );

      // 3. Manejo del Caso de Éxito
      if (result && result.success) {
        showMessageModal('¡Abono registrado exitosamente!');
        handleCloseModals();

        // Recargar la lista de clientes para que la UI refleje la nueva deuda
        loadInitialCustomers();

        // 4. Enviar Recibo (Opcional) usando la deuda real calculada por la BD (result.newDebt)
        if (sendReceipt) {
          const message =
            `*--- Recibo de Abono ---*\n` +
            `*Negocio:* ${companyName}\n\n` +
            `Hola *${customer.name}*,\n` +
            `Hemos registrado tu abono:\n\n` +
            `Monto Abonado: *$${amount.toFixed(2)}*\n` +
            `Deuda Anterior: $${deudaAnterior.toFixed(2)}\n` +
            `*Saldo Restante: $${result.newDebt.toFixed(2)}*\n\n` +
            `¡Gracias por tu pago!`;

          sendWhatsAppMessage(customer.phone, message);
        }
      }

    } catch (error) {
      Logger.error('Error crítico en abono:', error);

      // Mostrar el error exacto que arrojó el motor transaccional (ej. Abono excede deuda)
      const errorMsg = error.message || 'Error desconocido al procesar la transacción.';
      showMessageModal(`Transacción abortada: ${errorMsg}`);

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

*DEUDA TOTAL A LA FECHA: $${Number(customer.debt || 0).toFixed(2)}*
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
      Logger.error("Error al generar mensaje de WhatsApp:", error);
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
          onClick={() => handleTabChange('add-customer')}
        >
          {editingCustomer ? 'Editar Cliente' : 'Añadir Cliente'}
        </button>
        <button
          className={`tab-btn ${activeTab === 'view-customers' ? 'active' : ''}`}
          onClick={() => {
            handleTabChange('view-customers');
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
            onViewLayaways={handleOpenLayaways}
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
      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
    >
      {loading ? (
        <>
          {/* Ojo: Necesitarás agregar una animación en tu CSS para que gire, ej: className="spin" */}
          <Loader2 size={18} /> 
          Cargando...
        </>
      ) : (
        <>
          <ChevronDown size={18} /> 
          Cargar más clientes
        </>
      )}
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

      <LayawayModal
        show={isLayawayModalOpen}
        onClose={handleCloseModals}
        customer={selectedCustomer}
        onUpdate={() => {
          // Opcional: Si queremos refrescar algo global al cambiar un apartado
          // Por ejemplo, si los apartados afectaran la deuda global del cliente (que por ahora no lo hacen, van separados)
        }}
      />
    </>
  );
}



