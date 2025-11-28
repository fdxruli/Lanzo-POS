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
import { useDashboardStore } from '../store/useDashboardStore';
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

  const searchProducts = useDashboardStore((state) => state.searchProducts);
  
  // Ejecutar búsqueda en base de datos cuando el término "debounced" cambie
  useEffect(() => {
    searchProducts(debouncedSearchTerm);
  }, [debouncedSearchTerm, searchProducts]);

  const { cajaActual, abrirCaja } = useCaja();
  const { order, clearOrder, getTotalPrice } = useOrderStore();
  const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');
  
  // Estos "allProducts" ya son los resultados filtrados que vienen de la BD
  const allProducts = useDashboardStore((state) => state.menu); 
  const refreshData = useDashboardStore((state) => state.loadAllData);

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
        await refreshData();
      } catch (error) {
        console.error("Error cargando datos:", error);
      }
    };
    loadExtras();
  }, []);

  // --- OPTIMIZACIÓN CRÍTICA (PASO 2) ---
  // Eliminamos el filtrado de texto local. Confiamos en que 'allProducts' 
  // ya contiene los resultados correctos gracias a 'searchProducts' del store.
  // Solo filtramos localmente por Categoría y Tipo, que son filtros rápidos.
  const filteredProducts = useMemo(() => {
    // 1. Filtro base (Vendibles)
    let items = (allProducts || []).filter(p => p.productType === 'sellable' || !p.productType);
    
    // 2. Filtro de Categoría
    if (selectedCategoryId) {
      items = items.filter(p => p.categoryId === selectedCategoryId);
    }

    // NOTA: Ya no filtramos por 'searchTerm' aquí. 
    // El Store ya nos devuelve la lista filtrada por nombre/código desde la BD.
    
    return items;
  }, [allProducts, selectedCategoryId]); 
  // Quitamos 'searchTerm' de las dependencias para evitar re-renders innecesarios al escribir

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

    if (paymentData.paymentMethod === 'efectivo' && (!cajaActual || cajaActual.estado !== 'abierta')) {
      setIsPaymentModalOpen(false);
      setIsQuickCajaOpen(true);
      setIsProcessing(false);
      return;
    }

    try {
      setIsPaymentModalOpen(false);
      console.time('ProcesoVenta');

      const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);

      // A. PRE-CARGA DE LOTES
      const uniqueProductIds = new Set();
      for (const orderItem of itemsToProcess) {
        const realProductId = orderItem.parentId || orderItem.id;
        const product = allProducts.find(p => p.id === realProductId);
        if (!product) continue;
        const itemsToDeduct = (features.hasRecipes && product.recipe && product.recipe.length > 0)
          ? product.recipe
          : [{ ingredientId: realProductId, quantity: 1 }];
        itemsToDeduct.forEach(component => uniqueProductIds.add(component.ingredientId));
      }

      const batchesMap = new Map();
      await Promise.all(
        Array.from(uniqueProductIds).map(async (productId) => {
          let batches = await queryBatchesByProductIdAndActive(productId, true);
          if (!batches || batches.length === 0) {
            const allBatches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', productId);
            batches = allBatches.filter(b => b.isActive && b.stock > 0);
          }
          if (batches && batches.length > 0) {
            batches.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            batchesMap.set(productId, batches);
          }
        })
      );

      // B. PLANIFICACIÓN DE DESCUENTOS
      const batchesToDeduct = []; 
      const processedItems = [];

      for (const orderItem of itemsToProcess) {
        const realProductId = orderItem.parentId || orderItem.id;
        const product = allProducts.find(p => p.id === realProductId);
        if (!product) continue;

        const itemsToDeduct = (product.recipe && product.recipe.length > 0)
          ? product.recipe
          : [{ ingredientId: realProductId, quantity: 1 }];

        let itemTotalCost = 0;
        const itemBatchesUsed = [];

        for (const component of itemsToDeduct) {
          let requiredQty = component.quantity * orderItem.quantity;
          const targetId = component.ingredientId;
          const batches = batchesMap.get(targetId) || [];

          for (const batch of batches) {
            if (requiredQty <= 0.0001) break;
            if (batch.stock <= 0) continue;

            const toDeduct = Math.min(requiredQty, batch.stock);

            batchesToDeduct.push({
              batchId: batch.id,
              quantity: toDeduct
            });

            batch.stock -= toDeduct;

            itemBatchesUsed.push({
              batchId: batch.id,
              ingredientId: targetId,
              quantity: toDeduct,
              cost: batch.cost
            });

            itemTotalCost += (batch.cost * toDeduct);
            requiredQty -= toDeduct;
          }
        }

        const avgUnitCost = orderItem.quantity > 0 ? (itemTotalCost / orderItem.quantity) : 0;

        processedItems.push({
          ...orderItem,
          cost: avgUnitCost,
          batchesUsed: itemBatchesUsed,
          stockDeducted: orderItem.quantity
        });
      }

      // C. EJECUCIÓN
      if (batchesToDeduct.length > 0) {
        try {
          await processBatchDeductions(batchesToDeduct);
        } catch (error) {
          console.error("Error crítico en inventario:", error);
          showMessageModal("⚠️ Error de Inventario: El stock cambió. Intenta de nuevo.");
          return;
        }
      }

      // D. GUARDADO
      const sale = {
        timestamp: new Date().toISOString(),
        items: processedItems,
        total: total,
        customerId: paymentData.customerId,
        paymentMethod: paymentData.paymentMethod,
        abono: paymentData.amountPaid,
        saldoPendiente: paymentData.saldoPendiente,
        fulfillmentStatus: features.hasKDS ? 'pending' : 'completed',
        prescriptionDetails: tempPrescriptionData || null
      };

      await saveData(STORES.SALES, sale);

      useDashboardStore.getState().updateStatsWithSale(sale);

      if (sale.paymentMethod === 'fiado' && sale.customerId && sale.saldoPendiente > 0) {
        const customer = await loadData(STORES.CUSTOMERS, sale.customerId);
        if (customer) {
          customer.debt = (customer.debt || 0) + sale.saldoPendiente;
          await saveData(STORES.CUSTOMERS, customer);
        }
      }

      clearOrder();
      setTempPrescriptionData(null);
      setIsMobileOrderOpen(false);
      showMessageModal('✅ ¡Venta registrada correctamente!');
      refreshData(true);

      // E. WHATSAPP
      if (paymentData.sendReceipt && paymentData.customerId) {
        try {
          const customer = await loadData(STORES.CUSTOMERS, paymentData.customerId);
          if (customer && customer.phone) {
            let receiptText = `*--- TICKET DE VENTA ---*\n`;
            receiptText += `*Negocio:* ${companyName}\n`;
            receiptText += `*Fecha:* ${new Date().toLocaleString()}\n\n`;

            if (sale.prescriptionDetails) {
              receiptText += `*--- DATOS DE DISPENSACIÓN ---*\n`;
              receiptText += `Dr(a): ${sale.prescriptionDetails.doctorName}\n`;
              receiptText += `Cédula: ${sale.prescriptionDetails.licenseNumber}\n`;
              if (sale.prescriptionDetails.notes) receiptText += `Notas: ${sale.prescriptionDetails.notes}\n`;
              receiptText += `\n`;
            }

            receiptText += `*Productos:*\n`;
            processedItems.forEach(item => {
              receiptText += `• ${item.name} (x${item.quantity}) - $${(item.price * item.quantity).toFixed(2)}\n`;
              if (features.hasLabFields && item.requiresPrescription) {
                receiptText += `  _(Antibiótico/Controlado)_\n`;
              }
            });

            receiptText += `\n*TOTAL: $${total.toFixed(2)}*\n`;

            if (paymentData.paymentMethod === 'efectivo') {
              const cambio = parseFloat(paymentData.amountPaid) - total;
              receiptText += `Cambio: $${cambio.toFixed(2)}\n`;
            }

            receiptText += `\n¡Gracias por su preferencia!`;
            sendWhatsAppMessage(customer.phone, receiptText);
          }
        } catch (error) { console.error("Error ticket WhatsApp:", error); }
      }
      console.timeEnd('ProcesoVenta');

    } catch (error) {
      console.error('Error al procesar:', error);
      showMessageModal(`Error: ${error.message}`);
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
      <h2 className="section-title">Punto de Venta</h2>
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

      {order.length > 0 && !isMobileOrderOpen && !isPrescriptionModalOpen && !isPaymentModalOpen && (
        <div className="floating-cart-bar" onClick={() => setIsMobileOrderOpen(true)}>
          <div className="cart-count-badge">{totalItemsCount}</div>
          <span>Ver Pedido</span>
          <span className="cart-total-label">${total.toFixed(2)}</span>
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