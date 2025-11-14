// src/pages/PosPage.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom'; // 1. Importa 'useNavigate' para la navegación
import ProductMenu from '../components/pos/ProductMenu';
import OrderSummary from '../components/pos/OrderSummary';
import ScannerModal from '../components/common/ScannerModal';
import PaymentModal from '../components/common/PaymentModal';
import { useCaja } from '../hooks/useCaja';
import { useOrderStore } from '../store/useOrderStore';
import { useDashboard } from '../hooks/useDashboard'; // 2. Importa el hook del Dashboard
import { saveData, loadData, STORES } from '../services/database';
import { showMessageModal } from '../services/utils';
import './PosPage.css';

export default function PosPage() {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [allProducts, setAllProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Hooks globales
  const navigate = useNavigate(); // 3. Inicializa el hook de navegación
  const { cajaActual } = useCaja();
  const { order, clearOrder, getTotalPrice } = useOrderStore();
  const { loadAllData: refreshDashboardAndTicker } = useDashboard(); // 4. Obtén la función de recarga

  const total = getTotalPrice();

  // Efecto para cargar productos y categorías
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
  }, []); // Se ejecuta 1 vez al cargar

  // Lógica de filtrado
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
   * Lógica principal de 'processOrder' y 'completeOrderProcessing'
   */
  const handleProcessOrder = async (paymentData) => {
    // 1. Validar que la caja esté abierta
    if (!cajaActual || cajaActual.estado !== 'abierta') {
      showMessageModal(
        'No se puede procesar la venta. No hay una caja abierta.',
        null,
        // 5. Conecta el botón "Ir a Caja"
        { extraButton: { text: 'Ir a Caja', action: () => navigate('/caja') } }
      );
      return;
    }

    // 2. Validar que el pedido no esté vacío
    const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
    if (itemsToProcess.length === 0) {
      showMessageModal('El pedido está vacío.');
      return;
    }
    
    // (Validación de stock excedido)
    const stockIssues = itemsToProcess.filter(item => item.exceedsStock);
    if (stockIssues.length > 0) {
      // (Aquí deberías usar showMessageModal con confirmación)
      const userConfirmed = await new Promise((resolve) => {
        showMessageModal(
          'Algunos productos exceden el stock disponible. ¿Deseas continuar de todos modos?',
          () => resolve(true), // onConfirm
          { extraButton: { text: 'Cancelar', action: () => resolve(false) } } // Botón de cancelar
        );
      });

      if (!userConfirmed) {
        return; // Detiene el proceso si el usuario cancela
      }
    }

    try {
      const processedItems = [];
      // 3. Descontar stock
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

      // 4. Crear el registro de Venta
      const sale = {
        timestamp: new Date().toISOString(),
        items: processedItems,
        total: total,
        customerId: paymentData.customerId,
      };
      await saveData(STORES.SALES, sale);

      // 5. Limpiar y notificar
      setIsPaymentModalOpen(false);
      clearOrder(); // Limpia el carrito
      showMessageModal('¡Pedido procesado exitosamente!');
      
      // 6. ¡REFRESCAR EL DASHBOARD Y EL TICKER!
      refreshDashboardAndTicker();

    } catch (error) {
      console.error('Error al procesar el pedido:', error);
      showMessageModal(`Error al procesar el pedido: ${error.message}`);
    }
  };

  return (
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
    </>
  );
}