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
import { loadData, saveBulk, saveData, STORES } from '../services/database';
import { showMessageModal, sendWhatsAppMessage } from '../services/utils';
import { useAppStore } from '../store/useAppStore';
import './PosPage.css';

export default function PosPage() {
  // --- Estados Locales ---
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isQuickCajaOpen, setIsQuickCajaOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

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
      
      // A. Validaciones iniciales
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
        console.time('ProcesoDeVenta');
        
        // B. Cargar datos FRESCOS para la transacción (Inventario Real)
        const allBatches = await loadData(STORES.PRODUCT_BATCHES);
        const allProductsMenu = await loadData(STORES.MENU);
        const productMap = new Map(allProductsMenu.map(p => [p.id, p]));

        // Organizar lotes por producto para acceso rápido
        const batchesByProduct = new Map();
        allBatches.forEach(batch => {
          if (!batchesByProduct.has(batch.productId)) {
            batchesByProduct.set(batch.productId, []);
          }
          batchesByProduct.get(batch.productId).push(batch);
        });

        const processedItems = [];
        const updatedBatches = [];
        const updatedBatchesIds = new Set(); // Para evitar duplicados

        // C. Iterar sobre cada producto del carrito
        for (const orderItem of itemsToProcess) {
          const product = productMap.get(orderItem.id);
          if (!product) continue;

          const itemBatchesUsed = [];
          let itemTotalCost = 0;

          // === BIFURCACIÓN LÓGICA: ¿ES UNA RECETA (RESTAURANTE)? ===
          if (product.recipe && product.recipe.length > 0) {
             console.log(`🍳 Procesando receta para: ${product.name}`);
             
             // Descontar stock de cada ingrediente
             for (const ingredient of product.recipe) {
                let requiredQty = ingredient.quantity * orderItem.quantity;
                
                // Buscamos los lotes del INGREDIENTE (Harina, Queso, etc.)
                const ingredientBatches = batchesByProduct.get(ingredient.ingredientId) || [];
                const activeIngBatches = ingredientBatches
                    .filter(b => b.isActive && b.stock > 0)
                    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); // FIFO

                for (const batch of activeIngBatches) {
                    if (requiredQty <= 0) break;
                    
                    const toDeduct = Math.min(requiredQty, batch.stock);
                    batch.stock -= toDeduct;
                    
                    // Desactivar lote si se acaba (con tolerancia para decimales)
                    if (batch.stock < 0.0001) { 
                       batch.stock = 0;
                       batch.isActive = false;
                    }
                    
                    // Registrar uso para costos y devoluciones
                    itemBatchesUsed.push({
                        batchId: batch.id,
                        ingredientId: ingredient.ingredientId,
                        quantity: toDeduct,
                        cost: batch.cost
                    });
                    
                    itemTotalCost += (batch.cost * toDeduct);
                    requiredQty -= toDeduct;

                    if (!updatedBatchesIds.has(batch.id)) {
                        updatedBatches.push(batch);
                        updatedBatchesIds.add(batch.id);
                    }
                }
                
                if (requiredQty > 0.001) {
                    console.warn(`⚠️ Faltó stock para ingrediente: ${ingredient.name}`);
                }
            }
          } else {
            // === LÓGICA ESTÁNDAR (FIFO) ===
            console.log(`📦 Procesando producto estándar: ${product.name}`);
            
            const productBatches = batchesByProduct.get(orderItem.id) || [];
            const activeBatches = productBatches
              .filter(b => b.isActive && b.stock > 0)
              .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

            let remaining = orderItem.quantity;

            for (const batch of activeBatches) {
              if (remaining <= 0) break;
              
              const toDeduct = Math.min(remaining, batch.stock);
              batch.stock -= toDeduct;
              
              if (batch.stock === 0) batch.isActive = false;

              itemBatchesUsed.push({
                batchId: batch.id,
                quantity: toDeduct,
                cost: batch.cost
              });

              itemTotalCost += (batch.cost * toDeduct);
              remaining -= toDeduct;

              if (!updatedBatchesIds.has(batch.id)) {
                updatedBatches.push(batch);
                updatedBatchesIds.add(batch.id);
              }
            }
          }

          // Calcular costo unitario promedio real para este ítem
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

        // D. Guardar todos los cambios de inventario (Transacción Bulk)
        if (updatedBatches.length > 0) {
          await saveBulk(STORES.PRODUCT_BATCHES, updatedBatches);
        }

        // E. Guardar la Venta
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

        // F. Actualizar deuda del cliente si es Fiado
        if (sale.paymentMethod === 'fiado' && sale.customerId && sale.saldoPendiente > 0) {
          const customer = await loadData(STORES.CUSTOMERS, sale.customerId);
          if (customer) {
            customer.debt = (customer.debt || 0) + sale.saldoPendiente;
            await saveData(STORES.CUSTOMERS, customer);
          }
        }

        // G. Finalizar
        clearOrder();
        showMessageModal('¡Pedido procesado exitosamente!');
        
        refreshData(); // ¡IMPORTANTE! Actualiza la UI globalmente

        // H. Enviar Ticket (Opcional)
        if (paymentData.sendReceipt && paymentData.customerId) {
           // (Tu lógica de ticket existente...)
        }
        
        console.timeEnd('ProcesoDeVenta');

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