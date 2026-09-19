// src/pages/CustomersPage.jsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AlertTriangle, UserPlus, Users } from 'lucide-react';
import CustomerForm from '../components/customers/CustomerForm';
import CustomerList from '../components/customers/CustomerList';
import PurchaseHistoryModal from '../components/customers/PurchaseHistoryModal';
import AbonoModal from '../components/customers/AbonoModal';
import LayawayModal from '../components/customers/LayawayModal';
import { useCaja } from '../hooks/useCaja';
import { showConfirmModal, showMessageModal } from '../services/utils';
import { useAppStore } from '../store/useAppStore';
import { useNavigate } from 'react-router-dom';
import Logger from '../services/Logger';
import { useSearchParams } from 'react-router-dom';
import { customerCreditRepository, CUSTOMER_CREDIT_CLOUD_OFFLINE_MESSAGE } from '../services/customerCredit/customerCreditRepository';
import { cashRepository } from '../services/cash/cashRepository';
import { db } from '../services/db/dexie';
import { loadData, STORES, DB_ERROR_CODES } from '../services/database';
import { customerRepository } from '../services/customers/customerRepository';
import { getSafeCustomerDebt } from '../utils/customerUtils';
import {
  buildAccountStatementMessagePayload,
  buildPaymentMessagePayload,
  createFinancialNotificationResult,
  formatMoneyValue,
  hasConfirmedPaymentReceipt,
  notificationNotRequested,
  prepareCustomerMessageOutbox,
  selectCreditNotes,
  showCustomerMessageOutboxModal
} from '../services/customerMessaging';
import {
  canPerformRefunds,
  getSalesActorIdentity
} from '../services/auth/salesPermissionPolicy';
import { useActorRuntimeSnapshot } from '../services/auth/useActorRuntimeSnapshot';
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
  const [abonoCashSession, setAbonoCashSession] = useState(null);
  const [abonoPendingNotes, setAbonoPendingNotes] = useState(null);
  const [imageShareLoading, setImageShareLoading] = useState(null);
  const [isLayawayModalOpen, setIsLayawayModalOpen] = useState(false);
  const requestVersionRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const abonoNotesRequestRef = useRef(0);

  const {
    cajaActual,
    sincronizarEstadoCaja,
    isCloudCash,
    cashActor,
    cashMode
  } = useCaja();
  const companyProfile = useAppStore((state) => state.companyProfile);
  const actorRuntime = useActorRuntimeSnapshot();
  const canManageRefunds = canPerformRefunds(actorRuntime);
  const salesActorIdentity = getSalesActorIdentity(actorRuntime);
  const companyName = companyProfile?.name || 'Tu Negocio';
  const globalCreditLimit = Number(companyProfile?.settings_default_credit_limit) || 0;

  useEffect(() => {
    setIsLayawayModalOpen(false);
  }, [canManageRefunds, salesActorIdentity]);

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
    if (isCloudCash) {
      if (cashMode?.online === false) {
        const offlineError = new Error(CUSTOMER_CREDIT_CLOUD_OFFLINE_MESSAGE);
        offlineError.code = 'CUSTOMER_CREDIT_CLOUD_OFFLINE';
        throw offlineError;
      }

      if (cajaActual?.estado === 'abierta') {
        return cajaActual;
      }

      // Evita falsos negativos cuando Clientes se renderiza antes de que useCaja hidrate cajaActual.
      const freshState = await cashRepository.getCurrentCashSession();
      if (freshState?.success === false) {
        throw new Error(freshState.message || 'No se pudo verificar la caja actual.');
      }

      const freshCaja = freshState?.cashSession || freshState?.cash_session || null;
      if (freshCaja?.estado === 'abierta') {
        return freshCaja;
      }

      await sincronizarEstadoCaja();
      return null;
    }

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
  }, [cashMode?.online, cajaActual, isCloudCash, sincronizarEstadoCaja]);

  useEffect(() => {
    const tabParam = searchParams.get('tab');

    if (tabParam === 'add') {
      setActiveTab('add-customer');
    } else if (tabParam === 'list') {
      setActiveTab('view-customers');
      setEditingCustomer(null);
    }
  }, [searchParams]);

  const handleTabChange = (internalTab) => {
    if (internalTab === 'view-customers') {
      setSearchParams({ tab: 'list' });
      handleCancelEdit();
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
      } = await customerRepository.listCustomersPage({
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

  useEffect(() => {
    const refreshFromSync = () => {
      loadInitialCustomers().catch((error) => {
        Logger.warn('[CustomersPage] No se pudo refrescar tras sync:', error);
      });
    };

    window.addEventListener('lanzo:customers-sync-updated', refreshFromSync);
    window.addEventListener('online', refreshFromSync);

    return () => {
      window.removeEventListener('lanzo:customers-sync-updated', refreshFromSync);
      window.removeEventListener('online', refreshFromSync);
    };
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

    if (details.actionable === 'SUGGEST_RELOAD') {
      showMessageModal(message, () => window.location.reload(), {
        confirmButtonText: 'Recargar Pagina'
      });
    } else if (details.actionable === 'SUGGEST_BACKUP') {
      showMessageModal(message, () => navigate('/configuracion'), {
        confirmButtonText: 'Ir a Respaldar'
      });
    } else {
      showMessageModal(message, null, { type: 'error' });
    }
  };

  const getCustomerPhoneFieldError = (result) => {
    if (result?.fieldErrors?.phone) return result.fieldErrors.phone;

    const code = result?.error?.code || result?.code;
    const field = result?.error?.details?.field || result?.field;

    if ((code === DB_ERROR_CODES.CONSTRAINT_VIOLATION && field === 'phone') || code === 'DUPLICATE_PHONE') {
      return result?.error?.message || result?.message || 'El telefono ya esta registrado para otro cliente.';
    }

    return null;
  };

  const handleSaveCustomer = async (customerData) => {
    try {
      const result = await customerRepository.saveCustomer(customerData, {
        existingCustomer: editingCustomer
      });

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
      showMessageModal(result.pending
        ? 'Cliente guardado localmente. Sincronizacion pendiente.'
        : 'Cliente guardado con exito!');

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
    if (await showConfirmModal('¿Seguro que quieres eliminar este cliente?', {
      title: 'Eliminar cliente',
      confirmButtonText: 'Si, eliminar',
      cancelButtonText: 'Cancelar'
    })) {
      const customer = customers.find(c => c.id === customerId);

      if (customer && getSafeCustomerDebt(customer.debt) > 0) {
        showMessageModal('No se puede eliminar un cliente con deuda pendiente.', null, { type: 'error' });
        return;
      }

      setLoading(true);

      try {
        const result = await customerRepository.deleteCustomer(customerId);

        if (result.success) {
          await loadInitialCustomers();
          showMessageModal(result.pending
            ? 'Cliente eliminado localmente. Sincronizacion pendiente.'
            : 'Cliente enviado a la papelera.');
        } else {
          showMessageModal(`No se pudo eliminar: ${result.message || 'Error desconocido'}`);
        }
      } catch (error) {
        Logger.error('Error eliminando cliente:', error);
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
    let cajaVigente = null;

    try {
      cajaVigente = await resolveOpenCaja();
    } catch (error) {
      showMessageModal(error.message || CUSTOMER_CREDIT_CLOUD_OFFLINE_MESSAGE, null, { type: 'error' });
      return;
    }

    if (!cajaVigente) {
      showMessageModal(
        isCloudCash ? 'Debes abrir tu caja antes de registrar abonos.' : 'Debes tener una caja abierta para registrar un abono.',
        null,
        { type: 'error' }
      );
      return;
    }

    setAbonoCashSession(cajaVigente);
    if (!cajaActual || cajaActual.id !== cajaVigente.id || cajaActual.estado !== 'abierta') {
      await sincronizarEstadoCaja();
    }

    // Read-only enrichment: a cloud summary is authoritative whenever it is
    // available, but opening the payment modal never depends on this request.
    setAbonoPendingNotes(null);
    setSelectedCustomer(customer);
    setIsAbonoModalOpen(true);

    const abonoNotesRequestId = ++abonoNotesRequestRef.current;
    Promise.all([
      customerCreditRepository.getCustomerCreditSummary(customer.id).catch((error) => {
        Logger.warn('[CustomersPage] No se pudo cargar el resumen cloud de crédito:', error);
        return null;
      }),
      db.table(STORES.SALES).where('customerId').equals(customer.id).toArray().catch((error) => {
        Logger.warn('[CustomersPage] No se pudieron leer las notas locales:', error);
        return [];
      })
    ]).then(([summary, localSales]) => {
      if (abonoNotesRequestId !== abonoNotesRequestRef.current) return;
      setAbonoPendingNotes(selectCreditNotes({
        customerId: customer.id,
        cloudSummary: summary,
        localSales
      }));
    }).catch((error) => {
      Logger.warn('[CustomersPage] No se pudieron preparar notas para abono:', error);
    });
  };

  const handleOpenLayaways = (customer) => {
    setSelectedCustomer(customer);
    setIsLayawayModalOpen(true);
  };

  const handleCloseModals = () => {
    abonoNotesRequestRef.current += 1;
    setSelectedCustomer(null);
    setAbonoCashSession(null);
    setAbonoPendingNotes(null);
    setIsHistoryModalOpen(false);
    setIsAbonoModalOpen(false);
    setIsLayawayModalOpen(false);
  };

  const showNotificationStatus = (notificationResult, operationLabel) => {
    if (!notificationResult || [
      'not_requested',
      'opened',
      'ready',
      'shared',
      'downloaded',
      'cancelled',
      'preparado',
      'compartido',
      'descarga_generada',
      'cancelado_por_usuario',
      'reintento_pendiente'
    ].includes(notificationResult.status)) return;

    const messages = {
      missing_phone: 'El cliente no tiene un teléfono válido. Aún puedes descargar la imagen manualmente.',
      invalid_phone: 'El teléfono del cliente no es válido. Aún puedes descargar la imagen manualmente.',
      payload_invalid: 'No se pudo preparar el comprobante como imagen.',
      unsupported: 'El navegador no permite compartir el archivo directamente.',
      failed: 'No se pudo preparar el mensaje. La operación financiera se conservó correctamente.',
      error: 'No se pudo completar la acción de mensajería. La operación financiera se conservó correctamente.'
    };
    showMessageModal(
      messages[notificationResult.status] || `${operationLabel}: no se pudo preparar el comprobante como imagen.`,
      null,
      { type: 'warning' }
    );
  };

  const preparePayloadOutbox = async (payload, title = 'Mensaje al cliente') => {
    const prepared = await prepareCustomerMessageOutbox({ payload });
    if (!prepared?.ok || !prepared.record) {
      showMessageModal(
        'No se pudo guardar el estado del mensaje. La operación financiera se conservó correctamente.',
        null,
        { type: 'warning' }
      );
      return { status: 'failed', code: prepared?.code || 'OUTBOX_PERSISTENCE_FAILED' };
    }

    showCustomerMessageOutboxModal(prepared.record, { title });
    return {
      status: 'ready',
      code: 'IMAGE_SHARE_USER_ACTION_REQUIRED',
      outboxRecord: prepared.record,
      duplicate: prepared.duplicate === true
    };
  };

  const handleConfirmAbono = async (customer, amount, sendReceipt, allocations = null) => {
    let result = null;

    // This block owns only the confirmed financial operation. Notification work
    // deliberately starts after it has completed and cannot enter this catch.
    try {
      const cajaVigente = await resolveOpenCaja();
      setAbonoCashSession(cajaVigente);

      if (!cajaVigente) {
        showMessageModal(
          isCloudCash ? 'Debes abrir tu caja antes de registrar abonos.' : 'Debes tener una caja abierta para registrar un abono.',
          null,
          { type: 'error' }
        );
        handleCloseModals();
        return createFinancialNotificationResult({
          financialResult: { status: 'failed', code: 'CASH_SESSION_REQUIRED' }
        });
      }

      result = await customerCreditRepository.processPayment(
        customer.id,
        amount,
        'efectivo',
        cajaVigente.id,
        `Abono de cliente: ${customer.name}`,
        allocations
      );

      if (!result?.success) {
        showMessageModal(result?.message || 'No se pudo registrar el abono.', null, { type: 'error' });
        return createFinancialNotificationResult({
          financialResult: { status: 'failed', code: result?.code || 'CUSTOMER_PAYMENT_FAILED' }
        });
      }

    } catch (error) {
      Logger.error('Error crítico en abono:', error);
      showMessageModal(`Transacción abortada: ${error.message || 'Error desconocido al procesar la transacción.'}`, null, { type: 'error' });
      handleCloseModals();
      return createFinancialNotificationResult({
        financialResult: { status: 'failed', code: error?.code || 'CUSTOMER_PAYMENT_EXCEPTION' }
      });
    }

    // Refreshing UI state happens after the payment is committed. A refresh
    // failure must never make a successful financial operation look aborted.
    showMessageModal('¡Abono registrado exitosamente!');
    handleCloseModals();
    try {
      await Promise.all([loadInitialCustomers(), sincronizarEstadoCaja()]);
    } catch (error) {
      Logger.warn('[CustomersPage] El abono fue confirmado, pero no se pudo actualizar la vista:', error);
    }

    const confirmedReceipt = hasConfirmedPaymentReceipt(result.receipt) ? result.receipt : null;
    const financialResult = {
      status: 'success',
      paymentId: result.ledgerId || confirmedReceipt?.ledgerId || null,
      newBalance: confirmedReceipt?.newDebt ?? result.newDebt ?? null
    };
    let notificationResult = notificationNotRequested();

    if (sendReceipt) {
      try {
        // Cloud receipts include their durable timestamp. Local payments expose
        // the ledger id, so read that committed record rather than inventing a
        // browser timestamp for the receipt.
        const localLedger = confirmedReceipt || !result.ledgerId
          ? null
          : await db.table(STORES.CUSTOMER_LEDGER).get(result.ledgerId);
        const payloadResult = buildPaymentMessagePayload({
          customer,
          business: { ...(companyProfile || {}), name: companyProfile?.name || companyName },
          financialResult: { ...financialResult, amount },
          receipt: confirmedReceipt,
          previousBalance: customer.debt,
          occurredAt: localLedger?.timestamp || null,
          allocations: allocations || []
        });
        notificationResult = payloadResult.ok
          ? await preparePayloadOutbox(
              payloadResult.payload,
              payloadResult.payload.eventType === 'account_settled'
                ? 'Cuenta saldada'
                : 'Comprobante de abono'
            )
          : { status: 'payload_invalid', code: payloadResult.code || 'MESSAGE_PAYLOAD_INVALID' };
      } catch (error) {
        Logger.error('[CustomersPage] El abono fue confirmado, pero falló el comprobante:', error);
        notificationResult = { status: 'failed', code: error?.code || 'IMAGE_PREPARATION_FAILED' };
      }
      showNotificationStatus(notificationResult, 'El abono');
    }

    return createFinancialNotificationResult({ financialResult, notificationResult });
  };

  const handleShareStatementImage = async (customer) => {
    setImageShareLoading(customer.id);

    try {
      const [summaryResult, localSales] = await Promise.all([
        customerCreditRepository.getCustomerCreditSummary(customer.id).catch((error) => {
          Logger.warn('[CustomersPage] No se pudo obtener el resumen cloud para la imagen:', error);
          return null;
        }),
        loadData(STORES.SALES)
      ]);
      const customerSales = (localSales || []).filter((sale) => (sale.customerId ?? sale.customer_id) === customer.id);
      const summary = summaryResult?.success === false ? null : summaryResult;
      const cloudLedgerEntries = Array.isArray(summary?.ledger_entries)
        ? summary.ledger_entries
        : (Array.isArray(summary?.ledgerEntries) ? summary.ledgerEntries : []);
      const cloudLedgerTimestamps = cloudLedgerEntries
        .map((entry) => entry?.created_at || entry?.createdAt || entry?.timestamp)
        .filter(Boolean)
        .sort();
      const latestDurableTimestamp = summary?.cutoffAt
        || summary?.cutoff_at
        || summary?.generatedAt
        || summary?.generated_at
        || summary?.asOf
        || summary?.as_of
        || summary?.customer?.updatedAt
        || summary?.customer?.updated_at
        || cloudLedgerTimestamps.at(-1)
        || customerSales.map((sale) => sale.timestamp).filter(Boolean).sort().at(-1)
        || null;
      const payloadResult = buildAccountStatementMessagePayload({
        customer,
        business: { ...(companyProfile || {}), name: companyProfile?.name || companyName },
        cloudSummary: summary,
        localSales: customerSales,
        occurredAt: latestDurableTimestamp
      });
      const notificationResult = payloadResult.ok
        ? await preparePayloadOutbox(payloadResult.payload, 'Estado de cuenta')
        : { status: 'payload_invalid', code: payloadResult.code || 'MESSAGE_PAYLOAD_INVALID' };
      showNotificationStatus(notificationResult, 'El estado de cuenta');
      return createFinancialNotificationResult({
        financialResult: { status: 'not_applicable' },
        notificationResult
      });
    } catch (error) {
      Logger.error('Error al generar estado de cuenta como imagen:', error);
      showMessageModal('No se pudo preparar el estado de cuenta como imagen.', null, { type: 'warning' });
      return createFinancialNotificationResult({
        financialResult: { status: 'not_applicable' },
        notificationResult: { status: 'failed', code: 'MESSAGE_PREPARATION_FAILED' }
      });
    } finally {
      setImageShareLoading(null);
    }
  };

  const effectiveAbonoCashSession = abonoCashSession || cajaActual;
  const isAbonoBlocked = Boolean(isCloudCash && (cashMode?.online === false || !effectiveAbonoCashSession));
  const abonoBlockedReason = cashMode?.online === false
    ? CUSTOMER_CREDIT_CLOUD_OFFLINE_MESSAGE
    : (isCloudCash && !effectiveAbonoCashSession ? 'Debes abrir tu caja antes de registrar abonos.' : '');

  return (
    <>
      <main className="ui-page customers-page" aria-label="Clientes">
        <section className="ui-page__header customers-hero" aria-label="Resumen de clientes">
          <div className="customers-hero__metric">
            <span>Fiado total</span>
            <strong>{formatMoneyValue(customerPortfolio.totalDebt)}</strong>
          </div>

          <div className="customers-hero__metric customers-hero__metric--alert">
            <span>Clientes excedidos</span>
            <div>
              <strong>{customerPortfolio.overLimitCount}</strong>
              {customerPortfolio.overLimitCount > 0 && (
                <span className="ui-badge ui-badge--warning customers-alert-badge">
                  <AlertTriangle size={16} aria-hidden="true" />
                  Limite excedido
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            className={`ui-button ui-button--primary customers-add-button ${activeTab === 'add-customer' ? 'is-active' : ''}`}
            onClick={() => {
              if (activeTab === 'add-customer') {
                handleTabChange('view-customers');
              } else {
                handleTabChange('add-customer');
              }
            }}
            aria-pressed={activeTab === 'add-customer'}
          >
            {activeTab === 'add-customer' ? (
              <>
                <Users size={20} aria-hidden="true" />
                Ver lista
              </>
            ) : (
              <>
                <UserPlus size={20} aria-hidden="true" />
                {editingCustomer ? 'Editar cliente' : 'Añadir cliente'}
              </>
            )}
          </button>
        </section>

        <section className="ui-section customers-page__content">
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
              onWhatsApp={handleShareStatementImage}
              onWhatsAppLoading={imageShareLoading}
            />
          )}
        </section>
      </main>

      <PurchaseHistoryModal
        show={isHistoryModalOpen}
        onClose={handleCloseModals}
        customer={selectedCustomer}
        isCloudCredit={customerCreditRepository.getMode().cloudEnabled}
      />

      <AbonoModal
        show={isAbonoModalOpen}
        onClose={handleCloseModals}
        onConfirmAbono={handleConfirmAbono}
        customer={selectedCustomer}
        isCloudCredit={customerCreditRepository.getMode().cloudEnabled}
        isBlocked={isAbonoBlocked}
        blockedReason={abonoBlockedReason}
        cashSession={effectiveAbonoCashSession}
        cashActor={cashActor}
        authoritativePendingSales={abonoPendingNotes}
      />

      <LayawayModal
        show={isLayawayModalOpen}
        onClose={handleCloseModals}
        customer={selectedCustomer}
        canManageRefunds={canManageRefunds}
        actorIdentity={salesActorIdentity}
        onUpdate={() => {
          // Apartados siguen fuera del alcance cloud Fase 1.
        }}
      />
    </>
  );
}
