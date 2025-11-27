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
import { loadData, saveBulk, saveData, queryByIndex, queryBatchesByProductIdAndActive, STORES } from '../services/database';
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
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // --- NUEVO ESTADO: Controlar el Modal de Resumen en Móvil ---
  const [isMobileOrderOpen, setIsMobileOrderOpen] = useState(false);

  const searchProducts = useDashboardStore((state) => state.searchProducts);

  useEffect(() => {
    searchProducts(debouncedSearchTerm);
  }, [debouncedSearchTerm, searchProducts]);

  const { cajaActual, abrirCaja } = useCaja();
  const { order, clearOrder, getTotalPrice } = useOrderStore();
  const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');
  const allProducts = useDashboardStore((state) => state.menu);
  const refreshData = useDashboardStore((state) => state.loadAllData);

  const total = getTotalPrice();

  // Calculamos cantidad total de items para el badge del botón flotante
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

  const filteredProducts = useMemo(() => {
    let items = (allProducts || []).filter(p => p.productType === 'sellable' || !p.productType);
    if (selectedCategoryId) {
      items = items.filter(p => p.categoryId === selectedCategoryId);
    }
    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      items = items.filter(p => {
        const matchName = p.name.toLowerCase().includes(lowerTerm);
        const matchBarcode = p.barcode && p.barcode.includes(lowerTerm);
        let matchSustancia = false;
        if (p.sustancia) matchSustancia = p.sustancia.toLowerCase().includes(lowerTerm);
        return matchName || matchBarcode || matchSustancia;
      });
    }
    return items;
  }, [allProducts, selectedCategoryId, searchTerm]);

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

    // Cerramos el modal móvil si está abierto
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
    // Validar Caja
    if (paymentData.paymentMethod === 'efectivo' && (!cajaActual || cajaActual.estado !== 'abierta')) {
      setIsPaymentModalOpen(false);
      setIsQuickCajaOpen(true);
      return;
    }

    try {
      setIsPaymentModalOpen(false);
      console.time('ProcesoVenta');

      const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);

      // A. Pre-carga de Lotes
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

      // B. Descuento de Stock
      const processedItems = [];
      const batchUpdates = new Map();

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
            const currentBatch = batchUpdates.get(batch.id) || batch;
            const toDeduct = Math.min(requiredQty, currentBatch.stock);

            currentBatch.stock -= toDeduct;
            if (currentBatch.stock < 0.0001) {
              currentBatch.stock = 0;
              currentBatch.isActive = false;
            }

            itemBatchesUsed.push({
              batchId: currentBatch.id,
              ingredientId: targetId,
              quantity: toDeduct,
              cost: currentBatch.cost
            });

            itemTotalCost += (currentBatch.cost * toDeduct);
            requiredQty -= toDeduct;
            batchUpdates.set(currentBatch.id, currentBatch);
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

      // C. Guardar cambios
      if (batchUpdates.size > 0) {
        await saveBulk(STORES.PRODUCT_BATCHES, Array.from(batchUpdates.values()));
      }

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

      // --- CORRECCIÓN AQUÍ: Nombre correcto de la función del store ---
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
      setIsMobileOrderOpen(false); // CERRAR EL MODAL MÓVIL
      showMessageModal('✅ ¡Venta registrada correctamente!');
      refreshData(true);

      // D. Ticket WhatsApp
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
    // ... lógica de escaneo ...
  };

  return (
    <>
      <h2 className="section-title">Punto de Venta</h2>
      <div className="pos-grid">

        {/* 1. Menú de Productos (Siempre visible) */}
        <ProductMenu
          products={filteredProducts}
          categories={categories}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={setSelectedCategoryId}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onOpenScanner={() => setIsScannerOpen(true)}
        />

        {/* 2. Resumen de Pedido (Visible solo en Desktop por CSS) */}
        <OrderSummary onOpenPayment={handleInitiateCheckout} />
      </div>

      {/* --- 3. BARRA FLOTANTE MÓVIL (Toast) --- */}
      {/* Solo se muestra si hay items y estamos en pantalla pequeña (controlado por CSS) */}
      {order.length > 0 && !isMobileOrderOpen && !isPrescriptionModalOpen && !isPaymentModalOpen && (
        <div className="floating-cart-bar" onClick={() => setIsMobileOrderOpen(true)}>
          <div className="cart-count-badge">{totalItemsCount}</div>
          <span>Ver Pedido</span>
          <span className="cart-total-label">${total.toFixed(2)}</span>
        </div>
      )}
      {/* --- 4. MODAL RESUMEN PEDIDO (MÓVIL) --- */}
      {isMobileOrderOpen && (
        /* CAMBIO AQUÍ: Subimos el zIndex a 10005 para superar al Navbar (que tiene 9999) */
        <div className="modal" style={{ display: 'flex', zIndex: 10005, alignItems: 'flex-end' }}>

          {/* Estilo del contenido del modal (hoja deslizable) */}
          <div className="modal-content" style={{
            borderRadius: '20px 20px 0 0',
            width: '100%',
            height: '85vh', /* Ocupa casi toda la pantalla */
            maxWidth: '100%',
            padding: '0', /* Quitamos padding del contenedor para que el hijo maneje el scroll */
            animation: 'slideUp 0.3s ease-out',
            overflow: 'hidden' /* Importante para que el scroll sea interno */
          }}>
            <OrderSummary
              onOpenPayment={handleInitiateCheckout}
              isMobileModal={true}
              onClose={() => setIsMobileOrderOpen(false)}
            />
          </div>
        </div>
      )}

      {/* --- Otros Modales --- */}
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