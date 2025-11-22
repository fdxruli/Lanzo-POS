// src/pages/PosPage.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
import './PosPage.css';

export default function PosPage() {
  // --- Estados Locales ---
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
      items = items.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    return items;
  }, [allProducts, selectedCategoryId, searchTerm]);

  const handleProcessOrder = async (paymentData) => {
    const licenseDetails = useAppStore.getState().licenseDetails;

    if (!licenseDetails || !licenseDetails.valid) {
      showMessageModal('⚠️ Error de Seguridad: Licencia no válida.');
      return;
    }

    if (paymentData.paymentMethod === 'efectivo' && (!cajaActual || cajaActual.estado !== 'abierta')) {
      setIsPaymentModalOpen(false);
      setIsQuickCajaOpen(true);
      return;
    }

    const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
    if (itemsToProcess.length === 0) {
      setIsPaymentModalOpen(false);
      showMessageModal('El pedido está vacío.');
      return;
    }

    setIsPaymentModalOpen(false);

    try {
      console.time('ProcesoVentaOptimizado');

      // ============================================================
      // PASO 1: Pre-cargar TODOS los lotes necesarios
      // ============================================================
      const uniqueProductIds = new Set();

      for (const orderItem of itemsToProcess) {
        // --- CORRECCIÓN: Usar parentId si existe (es un modificador), sino el id normal ---
        const realProductId = orderItem.parentId || orderItem.id;
        const product = allProducts.find(p => p.id === realProductId);

        if (!product) continue;

        const itemsToDeduct = (product.recipe && product.recipe.length > 0)
          ? product.recipe
          : [{ ingredientId: realProductId, quantity: 1 }];

        itemsToDeduct.forEach(component => {
          uniqueProductIds.add(component.ingredientId);
        });
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

      // ============================================================
      // PASO 2: Validación de stock
      // ============================================================
      const stockValidationErrors = [];
      const tempStockCheck = new Map();

      for (const orderItem of itemsToProcess) {
        // --- CORRECCIÓN DE ID ---
        const realProductId = orderItem.parentId || orderItem.id;
        const product = allProducts.find(p => p.id === realProductId);

        if (!product || product.trackStock === false) continue;

        const itemsToDeduct = (product.recipe && product.recipe.length > 0)
          ? product.recipe
          : [{ ingredientId: realProductId, quantity: 1 }];

        for (const component of itemsToDeduct) {
          const targetId = component.ingredientId;
          const requiredQty = component.quantity * orderItem.quantity;

          const batches = batchesMap.get(targetId) || [];
          const totalRealStock = batches.reduce((sum, b) => sum + (b.stock || 0), 0);

          const currentUsage = tempStockCheck.get(targetId) || 0;
          const newUsage = currentUsage + requiredQty;

          if (totalRealStock < (newUsage - 0.001)) {
            const ingredientName = allProducts.find(p => p.id === targetId)?.name || targetId;
            stockValidationErrors.push(
              `${orderItem.name}: Faltan ${(newUsage - totalRealStock).toFixed(2)} de ${ingredientName}`
            );
          }
          tempStockCheck.set(targetId, newUsage);
        }
      }

      if (stockValidationErrors.length > 0) {
        showMessageModal(`❌ Stock Insuficiente:\n\n${stockValidationErrors.join('\n')}`);
        return;
      }

      // ============================================================
      // PASO 3: Procesamiento y Descuento
      // ============================================================
      const processedItems = [];
      const batchUpdates = new Map();

      for (const orderItem of itemsToProcess) {
        // --- CORRECCIÓN DE ID ---
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

      // ============================================================
      // PASO 4: Guardado masivo
      // ============================================================
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

        fulfillmentStatus: 'pending'
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
      showMessageModal('✅ ¡Pedido procesado exitosamente!');
      refreshData();

      // Generar Ticket WhatsApp
      if (paymentData.sendReceipt && paymentData.customerId) {
        try {
          const customer = await loadData(STORES.CUSTOMERS, paymentData.customerId);
          if (customer && customer.phone) {
            let receiptText = `*--- TICKET DE VENTA ---*\n`;
            receiptText += `*Negocio:* ${companyName}\n`;
            receiptText += `*Fecha:* ${new Date().toLocaleString()}\n\n`;
            receiptText += `*Productos:*\n`;

            processedItems.forEach(item => {
              // --- MODIFICADORES EN TICKET ---
              receiptText += `• ${item.name} (x${item.quantity}) - $${(item.price * item.quantity).toFixed(2)}\n`;
              if (item.selectedModifiers && item.selectedModifiers.length > 0) {
                const mods = item.selectedModifiers.map(m => m.name).join(', ');
                receiptText += `  _(${mods})_\n`;
              }
              if (item.notes) {
                receiptText += `  _Nota: ${item.notes}_\n`;
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

      console.timeEnd('ProcesoVentaOptimizado');

    } catch (error) {
      console.error('❌ Error al procesar el pedido:', error);
      showMessageModal(`Error crítico: ${error.message}`);
    }
  };

  // --- 5. HANDLER DE CAJA RÁPIDA ---
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
        <OrderSummary onOpenPayment={() => setIsPaymentModalOpen(true)} />
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
    </>
  );
}