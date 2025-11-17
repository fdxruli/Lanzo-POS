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
import { saveData, loadData, loadBulk, saveBulk, STORES } from '../services/database';
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
    // 1. Validar caja (Tu lógica existente)
    if (paymentData.paymentMethod === 'efectivo' && (!cajaActual || cajaActual.estado !== 'abierta')) {
      console.log('❌ Validación de caja falló para pago en efectivo.');
      setIsPaymentModalOpen(false);
      setIsQuickCajaOpen(true);
      return;
    }
    
    // 2. Validar pedido vacío (Tu lógica existente)
    const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
    if (itemsToProcess.length === 0) {
      setIsPaymentModalOpen(false);
      showMessageModal('El pedido está vacío.');
      return;
    }

    // 3. Validación de stock (Tu lógica existente)
    const stockIssues = itemsToProcess.filter(item => item.exceedsStock);
    if (stockIssues.length > 0) {
      const userConfirmed = window.confirm(
        'Algunos productos exceden el stock disponible. ¿Deseas continuar de todos modos?'
      );
      if (!userConfirmed) return;
    }
    
    // 4. Cerrar modal
    setIsPaymentModalOpen(false);


    // --- INICIO DE LA NUEVA LÓGICA DE TRANSACCIÓN ---
    try {
        console.time('ProcesoDeVenta'); // Para medir el rendimiento

        // 🔧 OPTIMIZACIÓN: Cargar todos los productos en UNA sola transacción
        const productIds = itemsToProcess.map(item => item.id);
        const products = await loadBulk(STORES.MENU, productIds);
                
        // Crear mapa de productos para acceso rápido
        const productMap = new Map(products.map(p => [p.id, p]));
                
        // 🔧 OPTIMIZACIÓN: Cargar todos los lotes activos en UNA transacción
        // (Esto es MÁS rápido que múltiples lecturas pequeñas)
        const allBatches = await loadData(STORES.PRODUCT_BATCHES);
        const batchesByProduct = new Map();
        
        // Organiza los lotes por ID de producto para acceso rápido
        allBatches.forEach(batch => {
            if (!batchesByProduct.has(batch.productId)) {
                batchesByProduct.set(batch.productId, []);
            }
            batchesByProduct.get(batch.productId).push(batch);
        });
                
        // Procesar items y descontar stock (en memoria)
        const processedItems = [];      // Para el objeto de Venta
        const updatedBatches = [];      // Para guardar en BD

        for (const orderItem of itemsToProcess) {
            const product = productMap.get(orderItem.id);
            if (!product) continue; // Producto no encontrado, saltar
                        
            const productBatches = batchesByProduct.get(orderItem.id) || [];
            
            // Filtra solo lotes activos y con stock, y los ordena por FIFO
            const activeBatches = productBatches
                .filter(b => b.isActive && b.stock > 0)
                .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); // FIFO por defecto
                        
            let remaining = orderItem.quantity;
            const batchesUsed = []; // Para rastrear qué lotes se usaron

            // Descontar de lotes (en memoria, sin transacciones aún)
            for (const batch of activeBatches) {
                if (remaining <= 0) break; // Ya se descontó todo
                                
                const toDeduct = Math.min(remaining, batch.stock);
                batch.stock -= toDeduct;
                if (batch.stock === 0) {
                  batch.isActive = false; // Agotado
                }
                                
                batchesUsed.push({
                    batchId: batch.id,
                    quantity: toDeduct,
                    price: batch.price,
                    cost: batch.cost
                });
                                
                remaining -= toDeduct;
                updatedBatches.push(batch); // Añadir a la lista para guardar en BD
            }

            if (remaining > 0) {
              // Esto significa que no había suficiente stock en los lotes
              console.warn(`¡Venta sin stock! Faltaron ${remaining} de ${orderItem.name}`);
              // (La venta continúa por la validación de stock anterior, pero 'remaining' se perdió)
            }
                        
            // Calcular costo promedio ponderado para esta venta
            const totalCost = batchesUsed.reduce((sum, b) => sum + (b.cost * b.quantity), 0);
            const avgCost = (orderItem.quantity > 0) ? (totalCost / orderItem.quantity) : 0;
                        
            processedItems.push({
                ...orderItem,
                cost: avgCost, // ¡Costo exacto de la venta!
                batchesUsed: batchesUsed // ¡Trazabilidad!
            });
        }
                
        // 🔧 OPTIMIZACIÓN: Guardar TODO en DOS transacciones bulk
        if (updatedBatches.length > 0) {
          await saveBulk(STORES.PRODUCT_BATCHES, updatedBatches); // 1. Actualiza Lotes
        }
                
        const sale = {
            timestamp: new Date().toISOString(),
            items: processedItems,
            total: total,
            customerId: paymentData.customerId,
            paymentMethod: paymentData.paymentMethod,
            abono: paymentData.amountPaid,
            saldoPendiente: paymentData.saldoPendiente
        };
        await saveData(STORES.SALES, sale); // 2. Guarda la Venta

        // --- LÓGICA DE CLIENTE Y WHATSAPP (Sin cambios) ---
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

        clearOrder();
        showMessageModal('¡Pedido procesado exitosamente!');
        
        // Refrescar datos en segundo plano
        refreshDashboardAndTicker();
        loadPosData(); // Recarga los productos del POS

        // Enviar Ticket por WhatsApp
        if (paymentData.sendReceipt && paymentData.customerId) {
            if (!customer) { // Cargar cliente si no se cargó antes
              customer = await loadData(STORES.CUSTOMERS, paymentData.customerId);
            }
            
            if (customer && customer.phone) {
                let message = `*--- Ticket de Venta ---*
*Negocio:* ${companyName}
*Fecha:* ${new Date(sale.timestamp).toLocaleString()}

*Productos:*
`;
                sale.items.forEach(item => {
                    message += ` - ${item.name} (x${item.quantity}) - $${(item.price * item.quantity).toFixed(2)}\n`;
                });

                message += `
*Total:* $${sale.total.toFixed(2)}
*Método de Pago:* ${sale.paymentMethod === 'fiado' ? 'Fiado' : 'Efectivo'}
`;

                if (sale.paymentMethod === 'fiado') {
                    message += `*Abono:* $${sale.abono.toFixed(2)}\n`;
                    message += `*Saldo Pendiente (esta venta):* $${sale.saldoPendiente.toFixed(2)}\n`;
                    message += `*Deuda Total Acumulada:* $${customer.debt.toFixed(2)}\n`;
                } else {
                    message += `*Pagado:* $${paymentData.amountPaid.toFixed(2)}\n`;
                    message += `*Cambio:* $${(paymentData.amountPaid - sale.total).toFixed(2)}\n`;
                }
                
                message += `\n¡Gracias por tu compra!`;
                sendWhatsAppMessage(customer.phone, message);
            }
        }

        console.timeEnd('ProcesoDeVenta');

    } catch (error) {
        console.error('❌ Error al procesar el pedido:', error);
        // Tu `database.js` ya resetea la conexión 'db' en caso de error,
        // así que no necesitamos 'pool.resetConnection()'.
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