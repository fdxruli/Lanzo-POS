// src/pages/PosPage.jsx
import { useState, useEffect, useCallback } from 'react';
import ProductMenu from '../components/pos/ProductMenu';
import OrderSummary from '../components/pos/OrderSummary';
import TablesView from '../components/pos/TablesView';
import SplitBillModal from '../components/pos/SplitBillModal';
import ScannerModal from '../components/common/ScannerModal';
import PaymentModal from '../components/common/PaymentModal';
import QuickCajaModal from '../components/common/QuickCajaModal';
import PrescriptionModal from '../components/pos/PrescriptionModal';
import { useCaja } from '../hooks/useCaja';
import { useOrderStore } from '../store/useOrderStore';
import { processSale, splitOpenTableOrder } from '../services/salesService';
import Logger from '../services/Logger';
import LayawayModal from '../components/pos/LayawayModal';
import { layawayRepo } from '../services/db';
import { searchProductsInDB } from '../services/database';

import { useProductStore } from '../store/useProductStore';
import { useInventoryMovement } from '../hooks/useInventoryMovement';

import { showMessageModal } from '../services/utils';
import { useAppStore } from '../store/useAppStore';
import { useDebounce } from '../hooks/useDebounce';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import { getAvailableStock } from '../services/db/utils';
import { db, STORES } from '../services/db';
import { SALE_STATUS } from '../services/sales/financialStats';
import './PosPage.css';

const playBeep = (freq = 1200, type = 'sine') => {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;

        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);

        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
        console.warn('Audio no disponible', e);
    }
};

export default function PosPage() {
    const verifySessionIntegrity = useAppStore((state) => state.verifySessionIntegrity);
    const features = useFeatureConfig();

    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isQuickCajaOpen, setIsQuickCajaOpen] = useState(false);
    const [isSaleInProgress, setIsSaleInProgress] = useState(false);
    const [isMobileOrderOpen, setIsMobileOrderOpen] = useState(false);
    const [toastMsg, setToastMsg] = useState(null);
    const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState(false);
    const [prescriptionItems, setPrescriptionItems] = useState([]);
    const [tempPrescriptionData, setTempPrescriptionData] = useState(null);
    const [isLayawayModalOpen, setIsLayawayModalOpen] = useState(false);
    const [isTablesViewOpen, setIsTablesViewOpen] = useState(false);
    const [activeTablesCount, setActiveTablesCount] = useState(0);
    const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);

    const fetchActiveTablesCount = useCallback(async () => {
        if (!features.hasTables) return;
        try {
            const count = await db.table(STORES.SALES)
                .where('status')
                .equals(SALE_STATUS.OPEN)
                .count();
            setActiveTablesCount(count);
        } catch (error) {
            Logger.error('Error contando mesas activas:', error);
        }
    }, [features.hasTables]);

    useEffect(() => {
        fetchActiveTablesCount();
    }, [fetchActiveTablesCount]);

    // ── Búsqueda con debounce ──────────────────────────────────────
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    // ── Inventario y escaneo ───────────────────────────────────────
    const { scanProductFast } = useInventoryMovement();

    // ── Store de productos: fuente de verdad única para el catálogo ─
    //
    // CAMBIO ARQUITECTÓNICO:
    // Antes: selectedCategoryId vivía en useState local y se combinaba con
    //   allProducts en un useMemo para producir productosFiltradosParaMenu.
    //   Esto hacía que el filtrado ocurriera en el cliente sobre datos paginados
    //   (50 registros), ocultando el resto del catálogo.
    //
    // Ahora: No existe estado local de categoría seleccionada en este componente.
    //   Cuando el usuario elige una categoría, se llama a setFilters en el store.
    //   El store ejecuta una nueva query en Dexie con el filtro correcto y
    //   reemplaza `menu` con los resultados reales de la BD.
    //   ProductMenu recibe `menu` directamente, sin pasar por ningún useMemo.
    const menu = useProductStore((state) => state.menu);
    const categories = useProductStore((state) => state.categories);
    const activeFilters = useProductStore((state) => state.filters);
    const setFilters = useProductStore((state) => state.setFilters);
    const refreshData = useProductStore((state) => state.loadInitialProducts);
    const checkHasOutOfStockProducts = useProductStore((state) => state.checkHasOutOfStockProducts);
    const [menuVisual, setMenuVisual] = useState([]);

    // El flag de "hay agotados" se consulta a la BD una sola vez al montar,
    // para decidir si mostrar la categoría virtual en el sidebar.
    const [hasOutOfStockItems, setHasOutOfStockItems] = useState(false);

    const applyActiveFilters = useCallback((items = []) =>
        items.filter((item) => {
            // 1. Descartar inactivos
            if (item?.isActive === false) return false;

            // 2. CORRECCIÓN: Descartar ingredientes inmediatamente
            if (item?.productType === 'ingredient') return false;

            const matchesCategory =
                (activeFilters.categoryId === null || activeFilters.categoryId === undefined) ||
                item.categoryId === activeFilters.categoryId;

            // Determinar si el producto está realmente agotado
            const isOutOfStock =
                (item.trackStock || item.batchManagement?.enabled) && getAvailableStock(item) <= 0;

            // Lógica excluyente:
            if (activeFilters.outOfStockOnly) {
                return matchesCategory && isOutOfStock;
            } else {
                return matchesCategory && !isOutOfStock;
            }
        }), [activeFilters.categoryId, activeFilters.outOfStockOnly]);

    // ── Store de orden ─────────────────────────────────────────────
    const { cajaActual, abrirCaja } = useCaja();
    const {
        order,
        customer,
        activeOrderId,
        clearOrder,
        clearSession,
        getTotalPrice,
        saveOrderAsOpen,
        loadOpenOrder
    } = useOrderStore();
    const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');

    const total = getTotalPrice();
    const totalItemsCount = order.reduce(
        (acc, item) => acc + (item.saleType === 'bulk' ? 1 : item.quantity),
        0
    );

    // ── Toast helper ───────────────────────────────────────────────
    const showToast = (msg) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(null), 2000);
    };

    // ── Carga inicial ──────────────────────────────────────────────
    useEffect(() => {
        const initialize = async () => {
            await refreshData();
            // Consulta puntual a la BD: ¿hay algún producto agotado?
            // Se realiza una sola vez al montar. Se re-ejecuta tras una venta exitosa (refreshData).
            const hasAgotados = await checkHasOutOfStockProducts();
            setHasOutOfStockItems(hasAgotados);
        };
        initialize();
    }, []);

    // ── Búsqueda local desacoplada del store global ─────────────────
    useEffect(() => {
        let isActive = true;

        const syncMenuVisual = async () => {
            const term = debouncedSearchTerm.trim();

            if (!term) {
                if (isActive) {
                    setMenuVisual(applyActiveFilters(menu));
                }
                return;
            }

            try {
                const results = await searchProductsInDB(term);
                if (isActive) {
                    setMenuVisual(applyActiveFilters(results));
                }
            } catch (error) {
                Logger.error('Error buscando en POS:', error);
                if (isActive) {
                    setMenuVisual([]);
                }
            }
        };

        syncMenuVisual();

        return () => {
            isActive = false;
        };
    }, [
        debouncedSearchTerm,
        menu,
        applyActiveFilters
    ]);

    // ── Manejador de selección de categoría ───────────────────────
    //
    // ANTES (anti-patrón eliminado):
    //   const [selectedCategoryId, setSelectedCategoryId] = useState(null);
    //   → Actualizaba un estado local, el useMemo lo leía y filtraba en memoria.
    //
    // AHORA (correcto):
    //   Despacha directamente al store. setFilters intercepta 'CAT_DYNAMIC_AGOTADOS'
    //   y lo convierte en { outOfStockOnly: true } antes de pasarlo a Dexie.
    //   Si es null (todas las categorías) o un ID real, limpia outOfStockOnly.
    const handleSelectCategory = (categoryId) => {
        setFilters({ categoryId });
    };

    // Derivamos el categoryId activo para que ProductMenu pueda marcar
    // visualmente la categoría seleccionada en el sidebar.
    // Si outOfStockOnly está activo, el ID visual es la categoría virtual.
    const activeCategoryId = activeFilters.outOfStockOnly
        ? 'CAT_DYNAMIC_AGOTADOS'
        : activeFilters.categoryId;

    // ── Scanner físico (teclado) ───────────────────────────────────
    useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();

        const handleKeyDown = async (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            const char = e.key;
            const currentTime = Date.now();

            if (currentTime - lastKeyTime > 100) {
                buffer = '';
            }
            lastKeyTime = currentTime;

            if (char === 'Enter') {
                if (buffer.length > 2) {
                    e.preventDefault();
                    await processBarcode(buffer);
                }
                buffer = '';
            } else if (char.length === 1) {
                buffer += char;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const processBarcode = async (code) => {
        const product = await scanProductFast(code);

        if (product) {
            playBeep(1000, 'sine');
            await useOrderStore.getState().addSmartItem(product);

            if (product.saleType === 'bulk') {
                showMessageModal(
                    `⚖️ Producto a Granel: ${product.name}`,
                    null,
                    { type: 'warning', duration: 4000 }
                );
                setTimeout(() => playBeep(500, 'square'), 150);
            } else {
                showToast(`✅ Agregado: ${product.name}`);
            }
        } else {
            playBeep(200, 'sawtooth');
            showMessageModal(`⚠️ Producto no encontrado: ${code}`, null, { type: 'error', duration: 1500 });
        }
    };

    // ── Botón "Atrás" del navegador cierra el modal móvil ─────────
    useEffect(() => {
        if (isMobileOrderOpen) {
            window.history.pushState({ modal: 'cart' }, document.title);

            const handlePopState = () => {
                setIsMobileOrderOpen(false);
            };

            window.addEventListener('popstate', handlePopState);
            return () => window.removeEventListener('popstate', handlePopState);
        }
    }, [isMobileOrderOpen]);

    // ── Flujo de pago ──────────────────────────────────────────────
    const handleInitiateCheckout = () => {
        const licenseDetails = useAppStore.getState().licenseDetails;
        if (!licenseDetails || !licenseDetails.valid) {
            showMessageModal('⚠️ Error de Seguridad: Licencia no válida.');
            return;
        }

        const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
        if (itemsToProcess.length === 0) {
            showMessageModal('El pedido está vacío.');
            return;
        }

        setIsMobileOrderOpen(false);

        const itemsRequiring = features.hasLabFields
            ? itemsToProcess.filter(item =>
                item.requiresPrescription ||
                (item.prescriptionType && item.prescriptionType !== 'otc')
            )
            : [];

        if (itemsRequiring.length > 0) {
            setPrescriptionItems(itemsRequiring);
            setTempPrescriptionData(null);
            setIsPrescriptionModalOpen(true);
        } else {
            setTempPrescriptionData(null);
            setIsPaymentModalOpen(true);
        }
    };

    const handlePrescriptionConfirm = (data) => {
        setTempPrescriptionData(data);
        setIsPrescriptionModalOpen(false);
        setIsPaymentModalOpen(true);
    };

    const handleProcessOrder = async (paymentData, forceSale = false) => {
        if (isSaleInProgress) {
            console.warn('🚫 Intento de venta duplicada bloqueado por idempotencia UI.');
            return;
        }

        const isSessionValid = await verifySessionIntegrity();
        if (!isSessionValid) {
            showMessageModal('Sesion invalida o licencia expirada. El sistema se recargará.', () => {
                window.location.reload();
            });
            return;
        }

        setIsSaleInProgress(true);

        if (paymentData.paymentMethod === 'efectivo' && (!cajaActual || cajaActual.estado !== 'abierta')) {
            setIsPaymentModalOpen(false);
            setIsQuickCajaOpen(true);
            setIsSaleInProgress(false);
            return;
        }

        try {
            setIsPaymentModalOpen(false);

            const result = await processSale({
                order,
                paymentData,
                total,
                allProducts: menu,
                features,
                companyName,
                tempPrescriptionData,
                ignoreStock: forceSale,
                activeOrderId,
            });

            if (result.success) {
                clearSession();
                setTempPrescriptionData(null);
                setIsMobileOrderOpen(false);
                showMessageModal('✅ ¡Venta registrada correctamente!');

                // Recargamos catálogo y re-chequeamos agotados tras cada venta
                await refreshData();
                const hasAgotados = await checkHasOutOfStockProducts();
                setHasOutOfStockItems(hasAgotados);

                await fetchActiveTablesCount();
            } else {
                if (result.errorType === 'RACE_CONDITION') {
                    showMessageModal('⚠️ El sistema está muy ocupado. Por favor intenta cobrar de nuevo.');
                    await refreshData();
                } else if (result.errorType === 'STOCK_WARNING') {
                    showMessageModal(
                        result.message,
                        () => {
                            setIsSaleInProgress(false);
                            handleProcessOrder(paymentData, true);
                        },
                        {
                            confirmButtonText: 'Sí, Vender Igual',
                            type: 'warning',
                        }
                    );
                } else {
                    showMessageModal(`Error: ${result.message}`, null, { type: 'error' });
                }
            }
        } catch (error) {
            Logger.error('Error crítico en UI:', error);
            showMessageModal(`Error inesperado: ${error.message}`);
        } finally {
            setIsSaleInProgress(false);
        }
    };

    const handleQuickCajaSubmit = async (monto) => {
        const success = await abrirCaja(monto);
        if (success) {
            setIsQuickCajaOpen(false);
            setIsPaymentModalOpen(true);
        } else {
            setIsQuickCajaOpen(false);
        }
    };

    // ── Apartados ──────────────────────────────────────────────────
    const handleInitiateLayaway = () => {
        if (order.length === 0) {
            showToast('⚠️ El carrito está vacío');
            return;
        }
        if (!features.hasLayaway) return;
        setIsLayawayModalOpen(true);
    };

    const handleConfirmLayaway = async ({ initialPayment, deadline, customer: customerFromModal }) => {
        if (isSaleInProgress) return;
        try {
            setIsSaleInProgress(true);

            const targetCustomer = customerFromModal || customer;
            if (!targetCustomer) {
                throw new Error('No se ha identificado al cliente para el apartado.');
            }

            const layawayData = {
                id: crypto.randomUUID(),
                customerId: targetCustomer.id,
                customerName: targetCustomer.name,
                items: order,
                totalAmount: total,
                deadline: deadline,
            };

            const result = await layawayRepo.create(layawayData, initialPayment);

            if (result.success) {
                clearOrder();
                setIsLayawayModalOpen(false);
                showMessageModal('✅ Apartado guardado correctamente');
            } else {
                showMessageModal('❌ Error al guardar apartado: ' + result.message);
            }
        } catch (error) {
            Logger.error('Layaway Error', error);
            showMessageModal('Error inesperado al crear apartado.');
        } finally {
            setIsSaleInProgress(false);
        }
    };

    // ── Render ─────────────────────────────────────────────────────
    const handleSaveAsOpen = async () => {
        if (!features.hasTables) return;

        const currentTableData = useOrderStore.getState().tableData;
        const isUpdating = Boolean(useOrderStore.getState().activeOrderId); // Comprobar si es edición

        if (!currentTableData || currentTableData.trim() === '') {
            const promptedName = window.prompt('Por favor, ingresa un identificador para la mesa (Ej: Mesa 2, Barra, Cliente):');

            if (!promptedName || promptedName.trim() === '') {
                return;
            }
            useOrderStore.setState({ tableData: promptedName.trim() });
        }

        const result = await saveOrderAsOpen();
        if (result.success) {
            setIsMobileOrderOpen(false);
            // FEEDBACK DINÁMICO
            showMessageModal(isUpdating ? '✅ Mesa actualizada correctamente.' : '✅ Pedido guardado y enviado a cocina.');
            await fetchActiveTablesCount();
            return;
        }

        showMessageModal(result.message || 'No se pudo guardar la orden abierta.', null, { type: 'error' });
    };

    const executeLoadOpenOrder = async (orderId, silent = false) => {
        const result = await loadOpenOrder(orderId);
        if (result.success) {
            if (!silent) {
                setIsTablesViewOpen(false);
                showMessageModal('Mesa cargada en el pedido actual.');
            }
            await fetchActiveTablesCount();
            return result; // Es crucial retornar el resultado para saber si tuvo éxito
        }

        if (!silent) {
            showMessageModal(result.message || 'No se pudo cargar la orden abierta.', null, { type: 'error' });
        }
        return result;
    };

    const handleLoadOpenOrder = (orderId) => {
        if (!features.hasTables) return;

        const hasCurrentOrder = order.some((item) => Number(item?.quantity) > 0);
        if (!hasCurrentOrder) {
            void executeLoadOpenOrder(orderId);
            return;
        }

        showMessageModal(
            'Hay un carrito activo. Deseas reemplazarlo por la mesa seleccionada?',
            () => {
                void executeLoadOpenOrder(orderId);
            },
            {
                title: 'Cambiar mesa activa',
                type: 'warning',
                confirmButtonText: 'Si, cargar mesa',
            }
        );
    };

    const handleQuickTableAction = async (targetOrder, actionType) => {
        const hasCurrentOrder = order.some((item) => Number(item?.quantity) > 0);

        if (hasCurrentOrder) {
            showMessageModal(
                'Tienes un carrito activo sin guardar. Límpialo o guárdalo antes de cobrar una mesa diferente.',
                () => { },
                {
                    title: 'Acción bloqueada',
                    type: 'error',
                    confirmButtonText: 'Entendido'
                }
            );
            return;
        }

        try {
            // Le pasamos "true" para que no interrumpa al usuario con mensajes innecesarios
            const result = await executeLoadOpenOrder(targetOrder.id, true);

            // Solo abrimos los modales si la carga fue realmente exitosa
            if (result && result.success) {
                setIsTablesViewOpen(false);

                // NOMBRES DE VARIABLES CORREGIDOS
                if (actionType === 'checkout') {
                    setIsPaymentModalOpen(true);
                } else if (actionType === 'split') {
                    setIsSplitModalOpen(true);
                }
            } else {
                // Si la carga falla silenciosamente, avisamos aquí
                showMessageModal(result?.message || 'Error al cargar la mesa para cobro.', null, { type: 'error' });
            }
        } catch (error) {
            console.error("Error al cargar la mesa para acción rápida:", error);
        }
    };

    const handleOpenSplitBill = () => {
        if (!features.hasTables) return;

        if (!activeOrderId) {
            showMessageModal('No hay una mesa activa cargada para dividir.');
            return;
        }

        const sellableItems = order.filter((item) => Number(item?.quantity) > 0);
        if (sellableItems.length === 0) {
            showMessageModal('No hay productos en la mesa activa para dividir.');
            return;
        }

        setIsSplitModalOpen(true);
    };

    const handleConfirmSplitBill = async (splitPayload) => {
        if (isSaleInProgress) return;

        const isSessionValid = await verifySessionIntegrity();
        if (!isSessionValid) {
            showMessageModal('Sesion invalida o licencia expirada. El sistema se recargará.', () => {
                window.location.reload();
            });
            return;
        }

        if (
            splitPayload?.tickets?.some((ticket) => ticket?.paymentData?.paymentMethod === 'efectivo') &&
            (!cajaActual || cajaActual.estado !== 'abierta')
        ) {
            showMessageModal('Necesitas abrir caja para cobrar tickets en efectivo.', null, { type: 'warning' });
            return;
        }

        setIsSaleInProgress(true);
        try {
            const result = await splitOpenTableOrder({
                parentOrderId: activeOrderId,
                orderSnapshot: order,
                mode: splitPayload.mode,
                tickets: splitPayload.tickets,
                features,
                companyName
            });

            if (result.success) {
                clearSession();
                setIsSplitModalOpen(false);
                showMessageModal('✅ Split bill aplicado y cobro registrado correctamente.');
                await refreshData();
                const hasAgotados = await checkHasOutOfStockProducts();
                setHasOutOfStockItems(hasAgotados);
                await fetchActiveTablesCount();
                return;
            }

            if (result.errorType === 'DIRTY_ORDER') {
                showMessageModal(result.message, null, { type: 'warning' });
                return;
            }

            if (result.errorType === 'RACE_CONDITION') {
                showMessageModal(result.message, null, { type: 'warning' });
                await refreshData();
                return;
            }

            showMessageModal(result.message || 'No se pudo dividir/cobrar la mesa.', null, { type: 'error' });
        } catch (error) {
            Logger.error('Error crítico en Split Bill:', error);
            showMessageModal(`Error inesperado: ${error.message}`, null, { type: 'error' });
        } finally {
            setIsSaleInProgress(false);
        }
    };

    return (
        <>
            <div className="pos-page-layout">
                <div className="pos-grid">
                    {/*
                     * ProductMenu recibe `menuVisual`, una proyección local:
                     * - Sin búsqueda: replica el caché paginado del store.
                     * - Con búsqueda: usa Dexie y filtra localmente categoría/agotados.
                     *
                     * - selectedCategoryId: reflejado desde el store para
                     *   mantener el estado visual sincronizado.
                     * - onSelectCategory: despacha al store, no al useState local.
                     */}
                    <ProductMenu
                        products={menuVisual}
                        categories={categories}
                        selectedCategoryId={activeCategoryId}
                        onSelectCategory={handleSelectCategory}
                        searchTerm={searchTerm}
                        onSearchChange={setSearchTerm}
                        onOpenScanner={() => setIsScannerOpen(true)}
                        showOutofStockCategory={hasOutOfStockItems}
                    />
                    <OrderSummary
                        onOpenPayment={handleInitiateCheckout}
                        onOpenSplit={handleOpenSplitBill}
                        onOpenLayaway={handleInitiateLayaway}
                        showRestaurantActions={features.hasTables}
                        canSplitOrder={features.hasTables && Boolean(activeOrderId)}
                        onSaveOpenOrder={features.hasTables ? handleSaveAsOpen : undefined}
                        onOpenTables={() => setIsTablesViewOpen(true)}
                        activeTablesCount={activeTablesCount}
                    />
                </div>
            </div>

            {/* --- BARRA FLOTANTE DUAL POS (MÓVIL) --- */}
            {((features.hasTables && activeTablesCount > 0) || totalItemsCount > 0) && (
                <div className="floating-pos-bar">

                    {/* Solo se muestra si hay mesas activas */}
                    {features.hasTables && activeTablesCount > 0 && (
                        <button
                            className="floating-btn tables-btn"
                            onClick={() => setIsTablesViewOpen(true)}
                        >
                            <span className="btn-label">Mesas</span>
                            <span className="tables-badge">{activeTablesCount}</span>
                        </button>
                    )}

                    {/* Solo se muestra si hay productos en el carrito */}
                    {totalItemsCount > 0 && (
                        <button
                            className="floating-btn cart-btn active"
                            onClick={() => setIsMobileOrderOpen(true)}
                        >
                            <div className="cart-summary-content">
                                <span className="cart-count">{totalItemsCount}</span>
                                <span className="cart-total">${total.toFixed(2)}</span>
                            </div>
                        </button>
                    )}
                </div>
            )}

            {/* Modal de carrito en móvil */}
            {isMobileOrderOpen && (
                <div className="modal" style={{ display: 'flex', zIndex: 10005, alignItems: 'flex-end' }}>
                    <div
                        className="modal-content"
                        style={{
                            borderRadius: '20px 20px 0 0',
                            width: '100%',
                            height: '85vh',
                            maxWidth: '100%',
                            padding: '0',
                            animation: 'slideUp 0.3s ease-out',
                            overflow: 'hidden',
                        }}
                    >
                        <OrderSummary
                            onOpenPayment={handleInitiateCheckout}
                            onOpenSplit={handleOpenSplitBill}
                            isMobileModal={true}
                            onClose={() => setIsMobileOrderOpen(false)}
                            onOpenLayaway={handleInitiateLayaway}
                            showRestaurantActions={features.hasTables}
                            canSplitOrder={features.hasTables && Boolean(activeOrderId)}
                            onSaveOpenOrder={features.hasTables ? handleSaveAsOpen : undefined}
                            onOpenTables={() => setIsTablesViewOpen(true)}
                            activeTablesCount={activeTablesCount}
                        />
                    </div>
                </div>
            )}

            {/* Toast no bloqueante */}
            {toastMsg && (
                <div
                    style={{
                        position: 'fixed',
                        bottom: '80px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        color: 'white',
                        padding: '10px 20px',
                        borderRadius: '30px',
                        zIndex: 10010,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                        fontSize: '0.9rem',
                        fontWeight: '500',
                        animation: 'fadeIn 0.2s ease-out',
                    }}
                >
                    {toastMsg}
                </div>
            )}

            {/* Modales */}
            {features.hasTables && (
                <TablesView
                    show={isTablesViewOpen}
                    onClose={() => setIsTablesViewOpen(false)}
                    onSelectOrder={handleLoadOpenOrder} // El clic normal sigue usando la lógica vieja
                    onCheckoutOrder={(order) => handleQuickTableAction(order, 'checkout')}
                    onSplitOrder={(order) => handleQuickTableAction(order, 'split')}
                />
            )}

            <ScannerModal show={isScannerOpen} onClose={() => setIsScannerOpen(false)} />

            <PaymentModal
                show={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                onConfirm={handleProcessOrder}
                total={total}
            />

            <SplitBillModal
                show={isSplitModalOpen}
                onClose={() => setIsSplitModalOpen(false)}
                order={order}
                total={total}
                isCajaOpen={Boolean(cajaActual && cajaActual.estado === 'abierta')}
                onConfirm={handleConfirmSplitBill}
            />

            <QuickCajaModal
                show={isQuickCajaOpen}
                onClose={() => setIsQuickCajaOpen(false)}
                onConfirm={handleQuickCajaSubmit}
            />

            <PrescriptionModal
                show={isPrescriptionModalOpen}
                onClose={() => setIsPrescriptionModalOpen(false)}
                onConfirm={handlePrescriptionConfirm}
                itemsRequiringPrescription={prescriptionItems}
            />

            <LayawayModal
                show={isLayawayModalOpen}
                onClose={() => setIsLayawayModalOpen(false)}
                onConfirm={handleConfirmLayaway}
                total={total}
                customer={customer}
            />
        </>
    );
}
