// src/pages/PosPage.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ProductMenu from '../components/pos/ProductMenu';
import OrderSummary from '../components/pos/OrderSummary';
import ScannerModal from '../components/common/ScannerModal';
import PaymentModal from '../components/common/PaymentModal';
// 1. IMPORTA EL NUEVO MODAL
import QuickCajaModal from '../components/common/QuickCajaModal';
import { useCaja } from '../hooks/useCaja';
import { useOrderStore } from '../store/useOrderStore';
import { useDashboard } from '../hooks/useDashboard';
import { saveData, loadData, STORES } from '../services/database';
import { showMessageModal } from '../services/utils';
import './PosPage.css';

export default function PosPage() {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  
  // 2. AÑADE ESTADO PARA EL NUEVO MODAL
  const [isQuickCajaOpen, setIsQuickCajaOpen] = useState(false);
  
  const [allProducts, setAllProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Hooks globales
  const navigate = useNavigate();
  // 3. OBTÉN LA FUNCIÓN 'abrirCaja' DEL HOOK
  const { cajaActual, abrirCaja } = useCaja();
  const { order, clearOrder, getTotalPrice } = useOrderStore();
  const { loadAllData: refreshDashboardAndTicker } = useDashboard();

  const total = getTotalPrice();

  // ... (tu useEffect de loadPosData se queda igual) ...
  useEffect(() => {
    const loadPosData = async () => {
      try {
        const productData = await loadData(STORES.MENU);
        const categoryData = await loadData(STORES.CATEGORIES);
        setAllProducts(productData.filter(item => item.isActive !== false));
        setCategories(categoryData || []);
      } catch (error) {
        console.error("Error al cargar datos del POS:", error);
      }
    };
    loadPosData();
  }, []);
  
  // ... (tu const filteredProducts se queda igual) ...
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

  /**
   * Lógica principal de procesamiento de orden
   */
  const handleProcessOrder = async (paymentData) => {
    console.log('🔄 Iniciando proceso de pago...', paymentData);
    
    // 4. ¡AQUÍ ESTÁ LA NUEVA LÓGICA!
    // 1. Validar que la caja esté abierta
    if (!cajaActual || cajaActual.estado !== 'abierta') {
      console.log('❌ Validación de caja falló. Abriendo modal rápido.');
      
      // Cerramos el modal de pago
      setIsPaymentModalOpen(false);
      // Abrimos el modal de "Abrir Caja Rápido"
      setIsQuickCajaOpen(true);
      
      // Detenemos la ejecución de esta venta
      return;
    }
    
    console.log('✅ Caja validada correctamente');

    // 2. Validar que el pedido no esté vacío
    // ... (esta lógica sigue igual) ...
    const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
    if (itemsToProcess.length === 0) {
      setIsPaymentModalOpen(false);
      showMessageModal('El pedido está vacío.');
      return;
    }

    // 3. Validación de stock excedido
    // ... (esta lógica sigue igual) ...
    const stockIssues = itemsToProcess.filter(item => item.exceedsStock);
    if (stockIssues.length > 0) {
      const userConfirmed = window.confirm(
        'Algunos productos exceden el stock disponible. ¿Deseas continuar de todos modos?'
      );

      if (!userConfirmed) {
        return;
      }
    }

    // 4. Si todas las validaciones pasaron, cerramos el modal
    setIsPaymentModalOpen(false);

    try {
      // 5. Descontar stock
      // ... (esta lógica sigue igual) ...
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
      // ... (esta lógica sigue igual) ...
      const sale = {
        timestamp: new Date().toISOString(),
        items: processedItems,
        total: total,
        customerId: paymentData.customerId,
      };
      await saveData(STORES.SALES, sale);
      console.log('💾 Venta guardada:', sale);

      // 7. Limpiar y notificar
      // ... (esta lógica sigue igual) ...
      clearOrder();
      showMessageModal('¡Pedido procesado exitosamente!');
      console.log('✅ Proceso completado');

      // 8. Refrescar el dashboard y ticker
      refreshDashboardAndTicker();

    } catch (error) {
      console.error('❌ Error al procesar el pedido:', error);
      showMessageModal(`Error al procesar el pedido: ${error.message}`);
    }
  };
  
  // 5. AÑADE ESTA NUEVA FUNCIÓN
  /**
   * Maneja la confirmación del modal "QuickCajaModal"
   */
  const handleQuickCajaSubmit = async (monto) => {
    // Llama a la función del hook 'useCaja'
    const success = await abrirCaja(monto); //
    
    if (success) {
      // Si se abrió con éxito...
      setIsQuickCajaOpen(false); // 1. Cierra el modal rápido
      setIsPaymentModalOpen(true); // 2. RE-ABRE el modal de pago
      
      // Ahora el usuario está de vuelta en el modal de pago,
      // y la próxima vez que le dé "Confirmar", la caja SÍ estará abierta.
    } else {
      // 'abrirCaja' ya muestra un modal de error si falla,
      // así que solo cerramos el modal rápido.
      setIsQuickCajaOpen(false);
    }
  };

  return (
    <>
      <h2 className="section-title">Punto de Venta Rápido y Eficiente</h2>
      <div className="pos-grid">
        {/* ... (ProductMenu y OrderSummary se quedan igual) ... */}
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
      
      {/* 6. RENDERIZA EL NUEVO MODAL */}
      <QuickCajaModal
        show={isQuickCajaOpen}
        onClose={() => setIsQuickCajaOpen(false)}
        onConfirm={handleQuickCajaSubmit}
      />
    </>
  );
}