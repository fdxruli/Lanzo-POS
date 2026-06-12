// src/pages/CustomersPage.jsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AlertTriangle, UserPlus } from 'lucide-react';
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
import { db } from '../services/db/dexie';
import { generateID } from '../services/utils';
import {
  saveDataSafe,
  loadCustomersByDebtPaginated,
  loadData,
  STORES,
  recycleData,
  DB_ERROR_CODES
} from '../services/database';
import { getSafeCustomerDebt, formatCustomerDebt } from '../utils/customerUtils';
import './CustomersPage.css';

const PAGE_SIZE = 50;

const mergeUniqueCustomers = (currentCustomers, nextCustomers) => {
  const seenIds = new Set(currentCustomers.map(customer => customer.id));

  const uniqueNextCustomers = nextCustomers.filter(customer => {
    if (!customer?.id || seenIds.has(customer.id)) return false;
    seenIds.add(customer.id);
    return true;
  });

  return [...currentCustomers, ...uniqueNextCustomers];
};

export default function CustomersPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('add-customer');
  const [searchParams, setSearchParams] = useSearchParams();
  const [customers, setCustomers] = useState([]);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [snapshotAt, setSnapshotAt] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isAbonoModalOpen, setIsAbonoModalOpen] = useState(false);
  const [whatsAppLoading, setWhatsAppLoading] = useState(null);
  const [isLayawayModalOpen, setIsLayawayModalOpen] = useState(false);
  const requestVersionRef = useRef(0);
  const requestInFlightRef = useRef(false);

  const { cajaActual, sincronizarEstadoCaja } = useCaja();
  const companyProfile = useAppStore((state) => state.companyProfile);
  const companyName = companyProfile?.name || 'Tu Negocio';
  const globalCreditLimit = Number(companyProfile?.settings_default_credit_limit) || 0;

  const customerPortfolio = useMemo(() => {
    return customers.reduce((summary, customer) => {
      const debt = getSafeCustomerDebt(customer.debt);
      const hasCustomerLimit = customer.creditLimit !== undefined && customer.creditLimit !== null;
      const creditLimit = hasCustomerLimit
        ? Number(customer.creditLimit) || 0
        : globalCreditLimit;

      summary.totalDebt += debt;

      if (creditLimit > 0 && debt > creditLimit) {
        summary.overLimitCount += 1;
      }

      return summary;
    }, { totalDebt: 0, overLimitCount: 0 });
  }, [customers, globalCreditLimit]);

  const resolveOpenCaja = useCallback(async () => {
    if (cajaActual?.estado === 'abierta') {
      return cajaActual;
    }

    const cajasAbiertas = await db.table(STORES.CAJAS)
      .where('estado')
      .equals('abierta')
      .toArray();

    if (cajasAbiertas.length === 0) {
      return null;
    }

    return cajasAbiertas.reduce((masReciente, caja) => {
      if (!masReciente) return caja;

      const aperturaActual = new Date(caja.fecha_apertura || 0).getTime();
      const aperturaMasReciente = new Date(masReciente.fecha_apertura || 0).getTime();

      return aperturaActual > aperturaMasReciente ? caja : masReciente;
    }, null);
  }, [cajaActual]);

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

  const loadCustomersPage = useCallback(async ({
    targetOffset = 0,
    replace = false,
    snapshotOverride = null
  } = {}) => {
    const requestVersion = ++requestVersionRef.current;
    requestInFlightRef.current = true;

    if (replace) {
      setLoading(true);
      setIsLoadingMore(false);
    } else {
      setIsLoadingMore(true);
    }

    try {
      const {
        data = [],
        hasMore: nextHasMore = false,
        snapshotAt: resolvedSnapshotAt = snapshotOverride
      } = await loadCustomersByDebtPaginated({
        limit: PAGE_SIZE,
        offset: targetOffset,
        snapshotAt: snapshotOverride
      });

      if (requestVersionRef.current !== requestVersion) return;

      const safeData = Array.isArray(data) ? data : [];

      setCustomers(prevCustomers =>
        replace ? safeData : mergeUniqueCustomers(prevCustomers, safeData)
      );
      setOffset(replace ? safeData.length : targetOffset + safeData.length);
      setSnapshotAt(resolvedSnapshotAt || null);
      setHasMore(Boolean(nextHasMore));
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) return;

      Logger.error(
        replace ? 'Error cargando clientes:' : 'Error paginando clientes por deuda:',
        error
      );

      if (replace) {
        setCustomers([]);
        setOffset(0);
        setSnapshotAt(null);
      }

      setHasMore(false);
    } finally {
      if (requestVersionRef.current === requestVersion) {
        requestInFlightRef.current = false;
        setLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, []);

  const loadInitialCustomers = useCallback(async () => {
    const freshSnapshot = new Date().toISOString();

    await loadCustomersPage({
      targetOffset: 0,
      replace: true,
      snapshotOverride: freshSnapshot
    });
  }, [loadCustomersPage]);

  useEffect(() => {
    loadInitialCustomers();
  }, [loadInitialCustomers]);

  const loadMoreCustomers = useCallback(async () => {
    if (loading || isLoadingMore || requestInFlightRef.current || !hasMore) return;

    await loadCustomersPage({
      targetOffset: offset,
      replace: false,
      snapshotOverride: snapshotAt
    });
  }, [hasMore, isLoadingMore, loadCustomersPage, loading, offset, snapshotAt]);

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
      const existingDebt = editingCustomer ? getSafeCustomerDebt(editingCustomer.debt) : 0;
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
      if (customer && getSafeCustomerDebt(customer.debt) > 0) {
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

  const handleOpenAbono = async (customer) => {
    const cajaVigente = await resolveOpenCaja();

    if (!cajaVigente) {
      showMessageModal('Debes tener una caja abierta para registrar un abono.');
      return;
    }

    if (!cajaActual || cajaActual.id !== cajaVigente.id || cajaActual.estado !== 'abierta') {
      await sincronizarEstadoCaja();
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

  const handleConfirmAbono = async (customer, amount, sendReceipt, allocations = null) => {
    try {
      // 1. Verificación estricta de pre-condiciones en UI
      const cajaVigente = await resolveOpenCaja();

      if (!cajaVigente) {
        showMessageModal('Debes tener una caja abierta para registrar un abono.');
        handleCloseModals();
        return;
      }

      const concepto = `Abono de cliente: ${customer.name}`;
      const deudaAnterior = getSafeCustomerDebt(customer.debt); // Capturamos para el recibo antes de mutar

      // 2. Ejecutar la transacción Atómica (Ledger + Cliente + Caja)
      // Delegamos TODO al repositorio. Si algo falla aquí, Dexie hace rollback automático.
      const result = await customerCreditRepository.processPayment(
        customer.id,
        amount,
        'efectivo',
        cajaVigente.id,
        concepto,
        allocations
      );

      // 3. Manejo del Caso de Éxito
      if (result && result.success) {
        showMessageModal('¡Abono registrado exitosamente!');
        handleCloseModals();

        // Recargar la lista de clientes para que la UI refleje la nueva deuda
        loadInitialCustomers();

        // Sincronizar estado de caja para reflejar la entrada de efectivo
        // y el nuevo movimiento inmediatamente (sin esperar el polling)
        await sincronizarEstadoCaja();

        // 4. Enviar Recibo (Opcional) usando la deuda real calculada por la BD (result.newDebt)
        if (sendReceipt) {
          const message =
            `*--- Recibo de Abono ---*\n` +
            `*Negocio:* ${companyName}\n\n` +
            `Hola *${customer.name}*,\n` +
            `Hemos registrado tu abono:\n\n` +
            `Monto Abonado: *$${amount.toFixed(2)}*\n` +
            `Deuda Anterior: $${deudaAnterior.toFixed(2)}\n` +
            `*Saldo Restante: $${Number(result.newDebt || 0).toFixed(2)}*\n\n` +
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
      if (getSafeCustomerDebt(customer.debt) > 0) {
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
        let remainingDebtToAllocate = getSafeCustomerDebt(customer.debt);
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

*DEUDA TOTAL A LA FECHA: $${formatCustomerDebt(customer.debt)}*
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
      <main className="customers-page">
      <section className="customers-hero" aria-labelledby="customers-page-title">
        <div className="customers-hero__identity">
          <p className="customers-eyebrow">Directorio y credito</p>
          <h1 id="customers-page-title">Clientes</h1>
        </div>

        <div className="customers-hero__metric">
          <span>Fiado total</span>
          <strong>${customerPortfolio.totalDebt.toFixed(2)}</strong>
        </div>

        <div className="customers-hero__metric customers-hero__metric--alert">
          <span>Clientes excedidos</span>
          <div>
            <strong>{customerPortfolio.overLimitCount}</strong>
            {customerPortfolio.overLimitCount > 0 && (
              <span className="customers-alert-badge">
                <AlertTriangle size={16} aria-hidden="true" />
                Limite excedido
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          className={`customers-add-button ${activeTab === 'add-customer' ? 'is-active' : ''}`}
          onClick={() => handleTabChange('add-customer')}
          aria-pressed={activeTab === 'add-customer'}
        >
          <UserPlus size={20} aria-hidden="true" />
          {editingCustomer ? 'Editar cliente' : 'Anadir cliente'}
        </button>
      </section>

      <div className="customers-page__content">
      {activeTab === 'add-customer' ? (
          <CustomerForm
            onSave={handleSaveCustomer}
            onCancel={() => handleTabChange('view-customers')}
            customerToEdit={editingCustomer}
            globalCreditLimit={globalCreditLimit}
        />
      ) : (
        <CustomerList
          customers={customers}
          isLoading={loading && customers.length === 0}
          isLoadingMore={isLoadingMore}
          hasMore={hasMore}
          onLoadMore={loadMoreCustomers}
          onRefreshList={loadInitialCustomers}
          onEdit={handleEditCustomer}
          onDelete={handleDeleteCustomer}
          onViewHistory={handleViewHistory}
          onAbonar={handleOpenAbono}
          onViewLayaways={handleOpenLayaways}
          onWhatsApp={handleWhatsApp}
          onWhatsAppLoading={whatsAppLoading}
        />
      )}
      </div>
      </main>

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
