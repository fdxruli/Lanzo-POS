import React, { useState } from 'react';
import ProductMenu from '../components/pos/ProductMenu';
import OrderSummary from '../components/pos/OrderSummary';
import ScannerModal from '../components/common/ScannerModal';
import PaymentModal from '../components/common/PaymentModal'; // 1. Importa el modal de pago
import { useCaja } from '../hooks/useCaja'; // 2. Importa el hook de Caja
import { useOrderStore } from '../store/useOrderStore'; // 3. Importa el store del Pedido
import { saveData, loadData, STORES } from '../services/database';
import { showMessageModal } from '../services/utils'; // Importa tu modal de mensajes
import './PosPage.css'

export default function PosPage() {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false); // 4. Estado para el modal de pago

  // 5. Obtenemos estado y acciones de nuestros hooks/stores
  const { cajaActual } = useCaja();
  const { order, clearOrder, getTotalPrice } = useOrderStore();
  const total = getTotalPrice();

  /**
   * Lógica principal de 'processOrder' y 'completeOrderProcessing'
   */
  const handleProcessOrder = async (paymentData) => {
    // 1. Validar que la caja esté abierta
    if (!cajaActual || cajaActual.estado !== 'abierta') {
      showMessageModal(
        'No se puede procesar la venta. No hay una caja abierta.',
        null,
        { extraButton: { text: 'Ir a Caja', action: () => {/* (navegar a /caja) */} } }
      );
      return;
    }

    // 2. Validar que el pedido no esté vacío
    const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
    if (itemsToProcess.length === 0) {
      showMessageModal('El pedido está vacío.');
      return;
    }
    
    // (Aquí iría la validación de stock si la implementamos)

    try {
      const processedItems = [];
      // 3. Descontar stock
      for (const orderItem of itemsToProcess) {
        const product = await loadData(STORES.MENU, orderItem.id);
        let stockDeducted = 0;
        if (product && product.trackStock) {
          stockDeducted = Math.min(orderItem.quantity, product.stock);
          product.stock = Math.max(0, product.stock - stockDeducted);
          await saveData(STORES.MENU, product); // Actualiza el producto
        }
        processedItems.push({ ...orderItem, stockDeducted });
      }

      // 4. Crear el registro de Venta
      const sale = {
        timestamp: new Date().toISOString(),
        items: processedItems,
        total: total,
        customerId: paymentData.customerId,
        // (más datos si es necesario)
      };
      await saveData(STORES.SALES, sale);

      // 5. Limpiar y notificar
      setIsPaymentModalOpen(false);
      clearOrder(); // Limpia el carrito desde Zustand
      showMessageModal('¡Pedido procesado exitosamente!');
      
      // (Opcional: actualizar el dashboard o el ticker)

    } catch (error) {
      console.error('Error al procesar el pedido:', error);
      showMessageModal(`Error al procesar el pedido: ${error.message}`);
    }
  };

  return (
    <>
      <h2 className="section-title">Punto de Venta Rápido y Eficiente</h2>
      <div className="pos-grid">
        
        <ProductMenu onOpenScanner={() => setIsScannerOpen(true)} />
        
        <OrderSummary onOpenPayment={() => setIsPaymentModalOpen(true)} />
      </div>

      {/* (Scanner Modal - Deshabilitado por ahora) */}
      { <ScannerModal 
        show={isScannerOpen} 
        onClose={() => setIsScannerOpen(false)} 
      />}
      
      {/* 7. Renderizamos el Modal de Pago */}
      <PaymentModal 
        show={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        onConfirm={handleProcessOrder}
        total={total}
      />
    </>
  );
}