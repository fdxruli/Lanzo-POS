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

  // --- 1. CONEXIÓN AL STORE (CORRECCIÓN CLAVE) ---
  // Usamos 'menu' del store, que ya incluye los productos aunque tengan stock 0
  const allProducts = useDashboardStore((state) => state.menu);
  const refreshData = useDashboardStore((state) => state.loadAllData);

  const total = getTotalPrice();

  // --- 2. EFECTO DE CARGA INICIAL ---
  useEffect(() => {
    const loadExtras = async () => {
      try {
        // Cargamos las categorías
        const categoryData = await loadData(STORES.CATEGORIES);
        setCategories(categoryData || []);

        // Refrescamos el store global para asegurar que los productos estén al día
        await refreshData();
      } catch (error) {
        console.error("Error cargando datos iniciales del POS:", error);
      }
    };
    loadExtras();
  }, []); // Se ejecuta una sola vez al montar

  // --- 3. FILTRADO DE PRODUCTOS ---
  const filteredProducts = useMemo(() => {
    // CORRECCIÓN: Filtramos primero para excluir ingredientes
    let items = (allProducts || []).filter(p => p.productType === 'sellable' || !p.productType);
    // (Nota: !p.productType es para compatibilidad con productos antiguos que no tengan ese campo)

    if (selectedCategoryId) {
      items = items.filter(p => p.categoryId === selectedCategoryId);
    }
    if (searchTerm) {
      items = items.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    return items;
  }, [allProducts, selectedCategoryId, searchTerm]);

  // --- 4. PROCESAMIENTO DE LA VENTA (LÓGICA ROBUSTA) ---
  const handleProcessOrder = async (paymentData) => {
    const licenseDetails = useAppStore.getState().licenseDetails;
    const appStatus = useAppStore.getState().appStatus;

    // Si no hay detalles de licencia o no es válida
    if (!licenseDetails || !licenseDetails.valid) {
      showMessageModal('⚠️ Error de Seguridad: No se detectó una licencia activa válida. El sistema se reiniciará.');

      // Opcional: Forzar cierre de sesión o recarga tras unos segundos
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      return; // DETIENE LA VENTA AQUÍ
    }

    // A. Validaciones iniciales (Igual que antes)
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

    // A.1. Validación previa de stock (antes de procesar)
    try {
      const stockValidationErrors = [];
      for (const orderItem of itemsToProcess) {
        const product = await loadData(STORES.MENU, orderItem.id);
        if (!product) {
          stockValidationErrors.push(`${orderItem.name || orderItem.id}: Producto no encontrado`);
          continue;
        }

        // Si el producto NO rastrea stock, saltamos la validación
        if (product.trackStock === false) continue;

        const itemsToDeduct = (product.recipe && product.recipe.length > 0)
          ? product.recipe
          : [{ ingredientId: product.id, quantity: 1 }];

        for (const component of itemsToDeduct) {
          const requiredQty = component.quantity * orderItem.quantity;
          const targetId = component.ingredientId;

          // --- CORRECCIÓN: Lógica de carga de stock mejorada ---
          let batches = await queryBatchesByProductIdAndActive(targetId, true);

          // Fallback de seguridad: Si no encuentra lotes por el método rápido,
          // busca TODOS los del producto y filtra manual (igual que en el Dashboard)
          if (!batches || batches.length === 0) {
            batches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', targetId);
            batches = batches.filter(b => b.isActive && b.stock > 0);
          }
          // ----------------------------------------------------

          const totalStock = batches
            .filter(b => b.stock > 0)
            .reduce((sum, b) => sum + (b.stock || 0), 0);

          // Tolerancia pequeña para errores de punto flotante (0.001)
          if (totalStock < (requiredQty - 0.001)) {
            const ingredientName = allProducts.find(p => p.id === targetId)?.name || targetId;
            stockValidationErrors.push(
              `${orderItem.name}: Faltan ${(requiredQty - totalStock).toFixed(2)} unidades de ${ingredientName}`
            );
          }
        }
      }

      if (stockValidationErrors.length > 0) {
        setIsPaymentModalOpen(false); // Cierra el modal de pago si hay error
        showMessageModal(`Error de stock:\n${stockValidationErrors.join('\n')}`);
        return;
      }
    } catch (error) {
      console.error('Error validando stock:', error);
      showMessageModal('Error al validar stock. Por favor, intente nuevamente.');
      return;
    }

    try {
      console.time('ProcesoDeVentaOptimo');

      const processedItems = [];
      const batchUpdates = new Map(); // Map para evitar duplicados si un lote se usa varias veces

      // B. Iterar sobre el carrito (SOLO cargamos lo necesario)
      for (const orderItem of itemsToProcess) {

        // 1. Cargar SOLO el producto actual
        let product;
        try {
          product = await loadData(STORES.MENU, orderItem.id);
          if (!product) {
            console.warn(`Producto no encontrado: ${orderItem.id}`);
            showMessageModal(`Error: Producto "${orderItem.name || orderItem.id}" no encontrado en la base de datos.`);
            continue;
          }
        } catch (error) {
          console.error(`Error cargando producto ${orderItem.id}:`, error);
          showMessageModal(`Error al cargar producto "${orderItem.name || orderItem.id}".`);
          continue;
        }

        const itemBatchesUsed = [];
        let itemTotalCost = 0;

        // Definir qué ingredientes/productos necesitamos buscar
        // Si es receta, buscamos sus ingredientes. Si no, el producto mismo.
        const itemsToDeduct = (product.recipe && product.recipe.length > 0)
          ? product.recipe
          : [{ ingredientId: product.id, quantity: 1 }]; // Normalizamos estructura

        for (const component of itemsToDeduct) {
          // Cantidad total requerida de este componente
          let requiredQty = component.quantity * orderItem.quantity;
          const targetId = component.ingredientId;

          // 2. Cargar SOLO lotes activos de este componente
          // Usamos función especializada que maneja correctamente el índice compuesto
          let batches = await queryBatchesByProductIdAndActive(targetId, true);

          // Si no hay resultados, intentamos solo por productId como fallback
          if (!batches || batches.length === 0) {
            batches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', targetId);
            // Filtrar solo activos con stock > 0
            batches = batches.filter(b => b.isActive && b.stock > 0);
          }

          // 3. Filtrar stock > 0 y Ordenar FIFO en memoria (rápido porque son pocos registros)
          const activeBatches = batches
            .filter(b => b.isActive && b.stock > 0)
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

          // 4. Algoritmo de descuento (Igual que tenías, pero optimizado)
          for (const batch of activeBatches) {
            if (requiredQty <= 0) break;

            // Si ya modificamos este lote en una iteración anterior del bucle (mismo pedido), usar la versión de memoria
            const currentBatch = batchUpdates.get(batch.id) || batch;

            const toDeduct = Math.min(requiredQty, currentBatch.stock);

            // Modificamos el objeto
            currentBatch.stock -= toDeduct;
            if (currentBatch.stock < 0.0001) {
              currentBatch.stock = 0;
              currentBatch.isActive = false;
            }

            itemBatchesUsed.push({
              batchId: currentBatch.id,
              ingredientId: targetId, // Guardamos qué ID descontó (útil para recetas)
              quantity: toDeduct,
              cost: currentBatch.cost
            });

            itemTotalCost += (currentBatch.cost * toDeduct);
            requiredQty -= toDeduct;

            // Guardamos en el Map para actualizar al final
            batchUpdates.set(currentBatch.id, currentBatch);
          }

          if (requiredQty > 0.001) {
            const ingredientName = allProducts.find(p => p.id === targetId)?.name || targetId;
            console.warn(`⚠️ Faltó stock para ID: ${targetId} (${ingredientName}). Requerido: ${requiredQty.toFixed(2)}`);
            // Esto no debería pasar si la validación previa funcionó, pero es una verificación adicional
          }
        }

        // Calcular costo unitario promedio
        const avgUnitCost = orderItem.quantity > 0 ? (itemTotalCost / orderItem.quantity) : 0;

        processedItems.push({
          ...orderItem,
          cost: avgUnitCost,
          price: orderItem.price,
          originalPrice: orderItem.originalPrice,
          batchesUsed: itemBatchesUsed,
          stockDeducted: orderItem.quantity
        });
      }

      // C. Guardar ACTUALIZACIONES de lotes en una sola transacción
      if (batchUpdates.size > 0) {
        try {
          await saveBulk(STORES.PRODUCT_BATCHES, Array.from(batchUpdates.values()));
        } catch (error) {
          console.error('Error guardando actualizaciones de lotes:', error);
          throw new Error('Error al actualizar el inventario. La venta no se procesó.');
        }
      }

      // D. Guardar la Venta (Igual que antes)
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

      // E. Actualizar deuda cliente (Igual que antes)
      if (sale.paymentMethod === 'fiado' && sale.customerId && sale.saldoPendiente > 0) {
        const customer = await loadData(STORES.CUSTOMERS, sale.customerId);
        if (customer) {
          customer.debt = (customer.debt || 0) + sale.saldoPendiente;
          await saveData(STORES.CUSTOMERS, customer);
        }
      }

      // F. Finalizar UI
      clearOrder();
      showMessageModal('¡Pedido procesado exitosamente!');
      refreshData(); // Recargar UI global

      if (paymentData.sendReceipt && paymentData.customerId) {
        try {
          // 1. Cargamos al cliente para obtener su teléfono
          const customer = await loadData(STORES.CUSTOMERS, paymentData.customerId);

          if (customer && customer.phone) {
            // 2. Construimos el mensaje del ticket
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
              receiptText += `Saldo Restante de esta venta: $${parseFloat(paymentData.saldoPendiente).toFixed(2)}\n`;
              // Opcional: Mostrar deuda total acumulada si la tienes disponible
              const nuevaDeudaTotal = (customer.debt || 0) + sale.saldoPendiente;
              receiptText += `\n*Deuda Total Acumulada: $${nuevaDeudaTotal.toFixed(2)}*\n`;
            }

            receiptText += `\n¡Gracias por su preferencia!`;

            // 3. Enviamos el mensaje
            sendWhatsAppMessage(customer.phone, receiptText);
          }
        } catch (error) {
          console.error("Error al generar ticket de WhatsApp:", error);
          // No detenemos el flujo si falla el mensaje, ya que la venta ya se guardó
        }
      }

      console.timeEnd('ProcesoDeVentaOptimo');

    } catch (error) {
      console.error('❌ Error al procesar el pedido:', error);
      showMessageModal(`Error al procesar el pedido: ${error.message}`);
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

  // --- 6. VISTA ---
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