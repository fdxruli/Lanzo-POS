// src/pages/PosPage.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ProductMenu from '../components/pos/ProductMenu';
import OrderSummary from '../components/pos/OrderSummary';
import ScannerModal from '../components/common/ScannerModal';
import PaymentModal from '../components/common/PaymentModal';
import QuickCajaModal from '../components/common/QuickCajaModal';
import PrescriptionModal from '../components/pos/PrescriptionModal';
import { useCaja } from '../hooks/useCaja';
import { useOrderStore } from '../store/useOrderStore';
import { processSale } from '../services/salesService';

// --- CAMBIOS: Importamos los nuevos stores especializados ---
import { useProductStore } from '../store/useProductStore';
import { useStatsStore } from '../store/useStatsStore';

import { loadData, saveBulk, saveData, queryByIndex, queryBatchesByProductIdAndActive, STORES, processBatchDeductions } from '../services/database';
import { showMessageModal, sendWhatsAppMessage } from '../services/utils';
import { useAppStore } from '../store/useAppStore';
import { useDebounce } from '../hooks/useDebounce';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import './PosPage.css';

export default function PosPage() {
  const features = useFeatureConfig();
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isQuickCajaOpen, setIsQuickCajaOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  // Esperamos 300ms después de que el usuario deje de escribir para buscar en la BD
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isMobileOrderOpen, setIsMobileOrderOpen] = useState(false);

  // --- CAMBIO: Usamos useProductStore para buscar ---
  const searchProducts = useProductStore((state) => state.searchProducts);

  // Ejecutar búsqueda en base de datos cuando el término "debounced" cambie
  useEffect(() => {
    searchProducts(debouncedSearchTerm);
  }, [debouncedSearchTerm]);

  const { cajaActual, abrirCaja } = useCaja();
  const { order, clearOrder, getTotalPrice } = useOrderStore();
  const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');

  // --- CAMBIO: Usamos useProductStore para obtener el menú y la función de recarga ---
  // Nota: 'loadInitialProducts' es el equivalente a la carga inicial/refresco en el nuevo store
  const allProducts = useProductStore((state) => state.menu);
  const refreshData = useProductStore((state) => state.loadInitialProducts);

  const total = getTotalPrice();
  const totalItemsCount = order.reduce((acc, item) => acc + (item.saleType === 'bulk' ? 1 : item.quantity), 0);

  const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState(false);
  const [prescriptionItems, setPrescriptionItems] = useState([]);
  const [tempPrescriptionData, setTempPrescriptionData] = useState(null);

  useEffect(() => {
    const loadExtras = async () => {
      try {
        const categoryData = await loadData(STORES.CATEGORIES);
        setCategories(categoryData || []);
        // Cargamos los productos iniciales
        await refreshData();
      } catch (error) {
        console.error("Error cargando datos:", error);
      }
    };
    loadExtras();
  }, []); // Dependencias vacías para cargar solo al montar

  // Filtramos localmente por Categoría y Tipo (búsqueda por texto ya viene filtrada del store)
  const filteredProducts = useMemo(() => {
    // 1. Filtro base (Vendibles)
    let items = (allProducts || []).filter(p => p.productType === 'sellable' || !p.productType);

    // 2. Filtro de Categoría
    if (selectedCategoryId) {
      items = items.filter(p => p.categoryId === selectedCategoryId);
    }

    return items;
  }, [allProducts, selectedCategoryId]);

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
      ? itemsToProcess.filter(item => item.requiresPrescription)
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

  const handleProcessOrder = async (paymentData) => {
    if (isProcessing) return;
    setIsProcessing(true);

    // Validación rápida de caja (UI logic)
    if (paymentData.paymentMethod === 'efectivo' && (!cajaActual || cajaActual.estado !== 'abierta')) {
      setIsPaymentModalOpen(false);
      setIsQuickCajaOpen(true);
      setIsProcessing(false);
      return;
    }

    try {
      setIsPaymentModalOpen(false);

      // 🚀 LLAMADA AL SERVICIO: Le pasamos todo lo que necesita
      const result = await processSale({
        order,
        paymentData,
        total,
        allProducts,
        features,
        companyName,
        tempPrescriptionData
      });

      if (result.success) {
        // --- ÉXITO: Actualizar UI ---
        clearOrder();
        setTempPrescriptionData(null);
        setIsMobileOrderOpen(false);
        showMessageModal('✅ ¡Venta registrada correctamente!');

        // Recargar inventario visualmente
        await refreshData();
      } else {
        // --- ERROR CONTROLADO ---
        if (result.errorType === 'RACE_CONDITION') {
          showMessageModal(`⚠️ ${result.message} Se han actualizado los datos. Intenta cobrar de nuevo.`);
          await refreshData();
        } else {
          showMessageModal(`Error: ${result.message}`);
        }
      }

    } catch (error) {
      // --- ERROR NO CONTROLADO ---
      console.error('Error crítico en UI:', error);
      showMessageModal(`Error inesperado: ${error.message}`);
    } finally {
      setIsProcessing(false);
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

  const handleBarcodeScanned = (code) => {
    // Si tienes lógica específica de escaneo manual, va aquí.
    // El ScannerModal ya maneja la adición al carrito internamente en modo POS.
  };

  return (
    <>
      <div className="pos-page-layout">
        <div className="pos-grid">
          <ProductMenu
            products={filteredProducts}
            categories={categories}
            selectedCategoryId={selectedCategoryId}
            onSelectCategory={setSelectedCategoryId}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            onOpenScanner={() => setIsScannerOpen(true)}
          />
          <OrderSummary onOpenPayment={handleInitiateCheckout} />
        </div>
      </div>

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

      {isMobileOrderOpen && (
        <div className="modal" style={{ display: 'flex', zIndex: 10005, alignItems: 'flex-end' }}>
          <div className="modal-content" style={{
            borderRadius: '20px 20px 0 0',
            width: '100%',
            height: '85vh',
            maxWidth: '100%',
            padding: '0',
            animation: 'slideUp 0.3s ease-out',
            overflow: 'hidden'
          }}>
            <OrderSummary
              onOpenPayment={handleInitiateCheckout}
              isMobileModal={true}
              onClose={() => setIsMobileOrderOpen(false)}
            />
          </div>
        </div>
      )}

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
    </>
  );
}