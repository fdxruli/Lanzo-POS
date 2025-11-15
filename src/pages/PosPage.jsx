// src/pages/PosPage.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ProductMenu from '../components/pos/ProductMenu';
import OrderSummary from '../components/pos/OrderSummary';
import ScannerModal from '../components/common/ScannerModal';
import PaymentModal from '../components/common/PaymentModal';
import QuickCajaModal from '../components/common/QuickCajaModal';
import { useCaja } from '../hooks/useCaja';
import { useOrderStore } from '../store/useOrderStore';
// 1. Importa el store
import { useDashboardStore } from '../store/useDashboardStore';
import { saveData, loadData, STORES } from '../services/database';
import { showMessageModal, sendWhatsAppMessage } from '../services/utils';
import './PosPage.css';
import { useAppStore } from '../store/useAppStore';

export default function PosPage() {
  // ... (estados locales sin cambios) ...
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isQuickCajaOpen, setIsQuickCajaOpen] = useState(false);
  const [allProducts, setAllProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const navigate = useNavigate();
  const { cajaActual, abrirCaja } = useCaja();
  const { order, clearOrder, getTotalPrice } = useOrderStore();
  // 2. Obtén la acción de refresco del store
  const refreshDashboardAndTicker = useDashboardStore((state) => state.loadAllData);
  const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');

  const total = getTotalPrice();

  // ... (funciones loadPosData, useEffect, filteredProducts, etc. SIN CAMBIOS) ...
  const loadPosData = useCallback(async () => {
    try {
      const productData = await loadData(STORES.MENU);
      const categoryData = await loadData(STORES.CATEGORIES);
      setAllProducts(productData.filter(item => item.isActive !== false));
      setCategories(categoryData || []);
    } catch (error) {
      console.error("Error al cargar datos del POS:", error);
    }
  }, []);

  useEffect(() => {
    loadPosData();
  }, [loadPosData]);

  const filteredProducts = useMemo(() => {
    let items = allProducts;
    if (selectedCategoryId) {
      items = items.filter(p => p.categoryId === selectedCategoryId);
    }
    if (searchTerm) {
      items = items.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    return items;
  }, [allProducts, selectedCategoryId, searchTerm]);


  const handleProcessOrder = async (paymentData) => {
    // ... (Toda la lógica de validación 1-4 de handleProcessOrder SIN CAMBIOS) ...
    // 1. Validar caja
    if (paymentData.paymentMethod === 'efectivo' && (!cajaActual || cajaActual.estado !== 'abierta')) {
      console.log('❌ Validación de caja falló para pago en efectivo.');
      setIsPaymentModalOpen(false);
      setIsQuickCajaOpen(true);
      return;
    }
    console.log('✅ Caja validada (o es fiado).');
    // 2. Validar pedido vacío
    const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
    if (itemsToProcess.length === 0) {
      setIsPaymentModalOpen(false);
      showMessageModal('El pedido está vacío.');
      return;
    }
    // 3. Validación de stock
    const stockIssues = itemsToProcess.filter(item => item.exceedsStock);
    if (stockIssues.length > 0) {
      const userConfirmed = window.confirm(
        'Algunos productos exceden el stock disponible. ¿Deseas continuar de todos modos?'
      );
      if (!userConfirmed) return;
    }
    // 4. Cerrar modal
    setIsPaymentModalOpen(false);


    try {
      // ... (Toda la lógica 5-7 de try...catch SIN CAMBIOS) ...
      // 5. Descontar stock
      const processedItems = [];
      for (const orderItem of itemsToProcess) {
        const product = await loadData(STORES.MENU, orderItem.id);
        let stockDeducted = 0;
        if (product && product.trackStock) {
          stockDeducted = Math.min(orderItem.quantity, product.stock);
          product.stock = Math.max(0, product.stock - stockDeducted);
          await saveData(STORES.MENU, product);
        }
        processedItems.push({ ...orderItem, stockDeducted });
      }
      // 6. Crear el registro de Venta
      const sale = {
        timestamp: new Date().toISOString(),
        items: processedItems,
        total: total,
        customerId: paymentData.customerId,
        paymentMethod: paymentData.paymentMethod,
        abono: paymentData.amountPaid,
        saldoPendiente: paymentData.saldoPendiente
      };
      await saveData(STORES.SALES, sale);
      console.log('💾 Venta guardada:', sale);
      // 7. Actualizar deuda del cliente (si es fiado)
      let customer = null; 
      if (sale.paymentMethod === 'fiado' && sale.customerId && sale.saldoPendiente > 0) {
        customer = await loadData(STORES.CUSTOMERS, sale.customerId);
        if (customer) {
          const currentDebt = customer.debt || 0;
          customer.debt = currentDebt + sale.saldoPendiente;
          await saveData(STORES.CUSTOMERS, customer);
          console.log(`Deuda de ${customer.name} actualizada a: $${customer.debt}`);
        }
      }

      // 8. Limpiar y notificar
      clearOrder();
      showMessageModal('¡Pedido procesado exitosamente!');
      console.log('✅ Proceso completado');

      // 9. Refrescar dashboard (y Ticker)
      // ESTA LÍNEA AHORA LLAMA AL STORE CENTRALIZADO
      refreshDashboardAndTicker();

      // 10. Enviar Ticket por WhatsApp
      if (paymentData.sendReceipt && paymentData.customerId) {
        // ... (lógica de ticket sin cambios) ...
      }

      // Vuelve a cargar los productos en esta página (PosPage)
      loadPosData(); 

    } catch (error) {
      console.error('❌ Error al procesar el pedido:', error);
      showMessageModal(`Error al procesar el pedido: ${error.message}`);
    }
  };

  const handleQuickCajaSubmit = async (monto) => {
    // ... (sin cambios) ...
    const success = await abrirCaja(monto);
    if (success) {
      setIsQuickCajaOpen(false);
      setIsPaymentModalOpen(true);
    } else {
      setIsQuickCajaOpen(false);
    }
  };

  return (
    // ... (El JSX de retorno no cambia) ...
    <>
      <h2 className="section-title">Punto de Venta Rápido y Eficiente</h2>
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
        <OrderSummary onOpenPayment={() => setIsPaymentModalOpen(true)} />
      </div>

      <ScannerModal
        show={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
      />

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
    </>
  );
}