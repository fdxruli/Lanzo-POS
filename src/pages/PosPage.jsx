// src/pages/PosPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import ProductMenu from '../components/pos/ProductMenu';
import OrderSummary from '../components/pos/OrderSummary';
import ScannerModal from '../components/common/ScannerModal';
import PaymentModal from '../components/common/PaymentModal';
import QuickCajaModal from '../components/common/QuickCajaModal';
import PrescriptionModal from '../components/pos/PrescriptionModal';
import { useCaja } from '../hooks/useCaja';
import { useOrderStore } from '../store/useOrderStore';
import { processSale } from '../services/salesService';
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
            if (item?.isActive === false) return false;

            const matchesCategory =
                (activeFilters.categoryId === null || activeFilters.categoryId === undefined) ||
                item.categoryId === activeFilters.categoryId;

            // Determinar si el producto está realmente agotado
            const isOutOfStock =
                (item.trackStock || item.batchManagement?.enabled) && Number(item.stock || 0) <= 0;

            // Lógica excluyente:
            if (activeFilters.outOfStockOnly) {
                // En la categoría dinámica, SOLO mostramos los que no tienen stock
                return matchesCategory && isOutOfStock;
            } else {
                // En el catálogo general, OCULTAMOS explícitamente los que no tienen stock
                return matchesCategory && !isOutOfStock;
            }
        }), [activeFilters.categoryId, activeFilters.outOfStockOnly]);

    // ── Store de orden ─────────────────────────────────────────────
    const { cajaActual, abrirCaja } = useCaja();
    const { order, customer, clearOrder, getTotalPrice } = useOrderStore();
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
            });

            if (result.success) {
                clearOrder();
                setTempPrescriptionData(null);
                setIsMobileOrderOpen(false);
                showMessageModal('✅ ¡Venta registrada correctamente!');

                // Recargamos catálogo y re-chequeamos agotados tras cada venta
                await refreshData();
                const hasAgotados = await checkHasOutOfStockProducts();
                setHasOutOfStockItems(hasAgotados);
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
                    <OrderSummary onOpenPayment={handleInitiateCheckout} />
                </div>
            </div>

            {/* Barra flotante del carrito (móvil) */}
            {totalItemsCount > 0 && (
                <div
                    className="floating-cart-bar"
                    onClick={() => setIsMobileOrderOpen(true)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Ver carrito con ${totalItemsCount} artículos, total $${total.toFixed(2)}`}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            setIsMobileOrderOpen(true);
                        }
                    }}
                >
                    <div className="cart-info">
                        <span className="cart-count-badge">{totalItemsCount}</span>
                        <span className="cart-total-label">${total.toFixed(2)}</span>
                    </div>
                    <span className="cart-arrow">Ver pedido</span>
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
                            isMobileModal={true}
                            onClose={() => setIsMobileOrderOpen(false)}
                            onOpenLayaway={handleInitiateLayaway}
                            features={features}
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
            <ScannerModal show={isScannerOpen} onClose={() => setIsScannerOpen(false)} />

            <PaymentModal
                show={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                onConfirm={handleProcessOrder}
                total={total}
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
