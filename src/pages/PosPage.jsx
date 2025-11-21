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

  // --- 4. PROCESAMIENTO DE LA VENTA (OPTIMIZADO) ---
  const handleProcessOrder = async (paymentData) => {
    const licenseDetails = useAppStore.getState().licenseDetails;

    // Validación de Licencia
    if (!licenseDetails || !licenseDetails.valid) {
      showMessageModal('⚠️ Error de Seguridad: Licencia no válida. El sistema se reiniciará.');
      setTimeout(() => window.location.reload(), 2000);
      return;
    }

    // Validación de Caja
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

    // Cerramos modal antes de procesar para dar feedback visual
    setIsPaymentModalOpen(false);

    try {
      console.time('ProcesoVentaOptimizado'); // Para depuración

      // ============================================================
      // PASO 1: Pre-cargar TODOS los lotes necesarios en UNA consulta
      // ============================================================
      const uniqueProductIds = new Set();

      // Identificar todos los IDs de ingredientes/productos involucrados
      for (const orderItem of itemsToProcess) {
        const product = allProducts.find(p => p.id === orderItem.id);
        if (!product) continue;

        // Determinar si usa receta o es directo
        const itemsToDeduct = (product.recipe && product.recipe.length > 0)
          ? product.recipe
          : [{ ingredientId: product.id, quantity: 1 }];

        itemsToDeduct.forEach(component => {
          uniqueProductIds.add(component.ingredientId);
        });
      }

      // Cargar lotes en paralelo
      const batchesMap = new Map();
      await Promise.all(
        Array.from(uniqueProductIds).map(async (productId) => {
          let batches = await queryBatchesByProductIdAndActive(productId, true);

          // Fallback si la query optimizada falla (red de seguridad)
          if (!batches || batches.length === 0) {
            const allBatches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', productId);
            batches = allBatches.filter(b => b.isActive && b.stock > 0);
          }

          if (batches && batches.length > 0) {
            // Ordenar FIFO (Primero que entra, primero que sale)
            batches.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            batchesMap.set(productId, batches);
          }
        })
      );

      // ============================================================
      // PASO 2: Validación de stock (En memoria, ultrarrápida)
      // ============================================================
      const stockValidationErrors = [];

      // Mapa temporal para simular descuento y validar stock compartido
      // (Ej: 2 productos usan Harina, hay que sumar el consumo total)
      const tempStockCheck = new Map();

      for (const orderItem of itemsToProcess) {
        const product = allProducts.find(p => p.id === orderItem.id);
        // Si no rastrea stock, saltar
        if (!product || product.trackStock === false) continue;

        const itemsToDeduct = (product.recipe && product.recipe.length > 0)
          ? product.recipe
          : [{ ingredientId: product.id, quantity: 1 }];

        for (const component of itemsToDeduct) {
          const targetId = component.ingredientId;
          const requiredQty = component.quantity * orderItem.quantity;

          // Obtener stock disponible real (de los lotes cargados)
          const batches = batchesMap.get(targetId) || [];
          const totalRealStock = batches.reduce((sum, b) => sum + (b.stock || 0), 0);

          // Verificar consumo acumulado en esta orden
          const currentUsage = tempStockCheck.get(targetId) || 0;
          const newUsage = currentUsage + requiredQty;

          if (totalRealStock < (newUsage - 0.001)) { // Tolerancia decimal
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
        return; // DETENER VENTA
      }

      // ============================================================
      // PASO 3: Procesamiento y Descuento (En memoria)
      // ============================================================
      const processedItems = [];
      const batchUpdates = new Map(); // Mapa para guardar lotes modificados y evitar duplicados

      for (const orderItem of itemsToProcess) {
        const product = allProducts.find(p => p.id === orderItem.id);
        // Nota: Ya validamos existencia arriba, pero por seguridad:
        if (!product) continue;

        const itemsToDeduct = (product.recipe && product.recipe.length > 0)
          ? product.recipe
          : [{ ingredientId: product.id, quantity: 1 }];

        let itemTotalCost = 0;
        const itemBatchesUsed = [];

        for (const component of itemsToDeduct) {
          let requiredQty = component.quantity * orderItem.quantity;
          const targetId = component.ingredientId;

          // Obtenemos los lotes del mapa pre-cargado
          const batches = batchesMap.get(targetId) || [];

          for (const batch of batches) {
            if (requiredQty <= 0.0001) break;

            // IMPORTANTE: Usar la versión del lote que está en `batchUpdates` si ya fue tocado
            // por otro producto en este mismo bucle.
            const currentBatch = batchUpdates.get(batch.id) || batch;

            const toDeduct = Math.min(requiredQty, currentBatch.stock);

            // Modificamos el objeto (en memoria)
            currentBatch.stock -= toDeduct;
            if (currentBatch.stock < 0.0001) {
              currentBatch.stock = 0;
              currentBatch.isActive = false;
            }

            // Registramos el uso para historial
            itemBatchesUsed.push({
              batchId: currentBatch.id,
              ingredientId: targetId,
              quantity: toDeduct,
              cost: currentBatch.cost
            });

            itemTotalCost += (currentBatch.cost * toDeduct);
            requiredQty -= toDeduct;

            // Guardamos el lote modificado en el mapa de actualizaciones
            batchUpdates.set(currentBatch.id, currentBatch);
          }
        }

        // Calcular costo promedio ponderado
        const avgUnitCost = orderItem.quantity > 0 ? (itemTotalCost / orderItem.quantity) : 0;

        processedItems.push({
          ...orderItem,
          cost: avgUnitCost,
          batchesUsed: itemBatchesUsed,
          stockDeducted: orderItem.quantity
        });
      }

      // ============================================================
      // PASO 4: Guardado masivo en una sola transacción (Atomicidad)
      // ============================================================
      if (batchUpdates.size > 0) {
        await saveBulk(STORES.PRODUCT_BATCHES, Array.from(batchUpdates.values()));
      }

      // Guardar la venta
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

      // Actualizar deuda cliente si aplica (Fiado)
      if (sale.paymentMethod === 'fiado' && sale.customerId && sale.saldoPendiente > 0) {
        const customer = await loadData(STORES.CUSTOMERS, sale.customerId);
        if (customer) {
          customer.debt = (customer.debt || 0) + sale.saldoPendiente;
          await saveData(STORES.CUSTOMERS, customer);
        }
      }

      // ============================================================
      // PASO 5: Finalización y UI
      // ============================================================
      clearOrder();
      showMessageModal('✅ ¡Pedido procesado exitosamente!');
      refreshData(); // Actualizar dashboard y stock visual

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
              receiptText += `• ${item.name} (x${item.quantity}) - $${(item.price * item.quantity).toFixed(2)}\n`;
            });

            receiptText += `\n*TOTAL: $${total.toFixed(2)}*\n`;

            if (paymentData.paymentMethod === 'efectivo') {
              receiptText += `Pago con: $${parseFloat(paymentData.amountPaid).toFixed(2)}\n`;
              const cambio = parseFloat(paymentData.amountPaid) - total;
              receiptText += `Cambio: $${cambio.toFixed(2)}\n`;
            } else if (paymentData.paymentMethod === 'fiado') {
              receiptText += `Método: Fiado / Crédito\n`;
              receiptText += `Abono Inicial: $${parseFloat(paymentData.amountPaid).toFixed(2)}\n`;
              receiptText += `Saldo Restante: $${parseFloat(paymentData.saldoPendiente).toFixed(2)}\n`;
            }
            receiptText += `\n¡Gracias por su preferencia!`;

            sendWhatsAppMessage(customer.phone, receiptText);
          }
        } catch (error) {
          console.error("Error ticket WhatsApp:", error);
        }
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