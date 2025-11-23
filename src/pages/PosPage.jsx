// src/pages/PosPage.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Await, useNavigate } from 'react-router-dom';
import ProductMenu from '../components/pos/ProductMenu';
import OrderSummary from '../components/pos/OrderSummary';
import ScannerModal from '../components/common/ScannerModal';
import PaymentModal from '../components/common/PaymentModal';
import QuickCajaModal from '../components/common/QuickCajaModal';
import { useCaja } from '../hooks/useCaja';
import { useOrderStore } from '../store/useOrderStore';
import { useDashboardStore } from '../store/useDashboardStore'; // Store Global
import { loadData, saveBulk, saveData, queryByIndex, queryBatchesByProductIdAndActive, STORES } from '../services/database';
import { showMessageModal, sendWhatsAppMessage } from '../services/utils';
import { useAppStore } from '../store/useAppStore';
import { useDebounce } from '../hooks/useDebounce';
import PrescriptionModal from '../components/pos/PrescriptionModal';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import './PosPage.css';

export default function PosPage() {
  // --- Estados Locales ---
  const features = useFeatureConfig();
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isQuickCajaOpen, setIsQuickCajaOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const searchProducts = useDashboardStore((state) => state.searchProducts);

  useEffect(() => {
    searchProducts(debouncedSearchTerm);
  }, [debouncedSearchTerm, searchProducts]);

  const navigate = useNavigate();
  const { cajaActual, abrirCaja } = useCaja();
  const { order, clearOrder, getTotalPrice } = useOrderStore();
  const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');

  // --- 1. CONEXIÓN AL STORE ---
  const allProducts = useDashboardStore((state) => state.menu);
  const refreshData = useDashboardStore((state) => state.loadAllData);

  const total = getTotalPrice();

  // modal de llenado de receta...
  const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState(false);
  const [prescriptionItems, setPrescriptionItems] = useState([]);
  const [tempPrescriptionData, setTempPrescriptionData] = useState(null);

  // --- 2. EFECTO DE CARGA INICIAL ---
  useEffect(() => {
    const loadExtras = async () => {
      try {
        const categoryData = await loadData(STORES.CATEGORIES);
        setCategories(categoryData || []);
        await refreshData();
      } catch (error) {
        console.error("Error cargando datos iniciales del POS:", error);
      }
    };
    loadExtras();
  }, []);

  // --- 3. FILTRADO DE PRODUCTOS ---
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

        // --- LÓGICA FARMACIA: Buscar por Sustancia Activa ---
        let matchSustancia = false;
        // features viene de un hook, asegúrate de importarlo o checar si p.sustancia existe
        if (p.sustancia) {
          matchSustancia = p.sustancia.toLowerCase().includes(lowerTerm);
        }

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

    // Validar pedido vacío
    const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
    if (itemsToProcess.length === 0) {
      showMessageModal('El pedido está vacío.');
      return;
    }

    // LÓGICA FARMACIA: Detectar si requiere receta ANTES de pagar
    const itemsRequiring = itemsToProcess.filter(item => item.requiresPrescription);

    if (itemsRequiring.length > 0) {
      // Si hay controlados, abrimos modal de receta PRIMERO
      setPrescriptionItems(itemsRequiring);
      setTempPrescriptionData(null); // Limpiamos datos previos
      setIsPrescriptionModalOpen(true);
    } else {
      // Si no, vamos directo al pago
      setTempPrescriptionData(null);
      setIsPaymentModalOpen(true);
    }
  };

  // 2. El usuario confirma los datos del médico
  const handlePrescriptionConfirm = (data) => {
    setTempPrescriptionData(data); // Guardamos temporalmente
    setIsPrescriptionModalOpen(false); // Cerramos receta
    setIsPaymentModalOpen(true); // Abrimos pago
  };

  // 3. El usuario confirma el pago (Finalizar Venta)
  const handleProcessOrder = async (paymentData) => {
    // Validar Caja
    if (paymentData.paymentMethod === 'efectivo' && (!cajaActual || cajaActual.estado !== 'abierta')) {
      setIsPaymentModalOpen(false);
      setIsQuickCajaOpen(true);
      return;
    }

    try {
      setIsPaymentModalOpen(false); // Cerramos modal de pago
      console.time('ProcesoVenta');

      const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);

      // A. Pre-carga de Lotes
      const uniqueProductIds = new Set();
      for (const orderItem of itemsToProcess) {
        const realProductId = orderItem.parentId || orderItem.id;
        const product = allProducts.find(p => p.id === realProductId);
        if (!product) continue;
        const itemsToDeduct = (product.recipe && product.recipe.length > 0)
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

      if (sale.paymentMethod === 'fiado' && sale.customerId && sale.saldoPendiente > 0) {
        const customer = await loadData(STORES.CUSTOMERS, sale.customerId);
        if (customer) {
          customer.debt = (customer.debt || 0) + sale.saldoPendiente;
          await saveData(STORES.CUSTOMERS, customer);
        }
      }

      clearOrder();
      setTempPrescriptionData(null); // Limpiar datos temporales
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

            // INFO MÉDICA EN EL TICKET
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
              if (item.requiresPrescription) {
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

  // --- 6. VISTA (JSX) ---
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
        <OrderSummary onOpenPayment={handleInitiateCheckout} />
      </div>

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