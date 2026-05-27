import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clipboard, Truck, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getLowStockProductsReport } from '../../services/inventoryAnalysis';
import { showMessageModal, getProductAlerts, LOW_STOCK_THRESHOLD } from '../../services/utils';
import { getAvailableStock } from '../../services/db/utils';
import Logger from '../../services/Logger';
import './RestockSuggestion.css';

/**
 * RestockSuggestion - Componente de sugerencias de reabastecimiento para Lanzo POS
 * 
 * Características principales:
 * - Consciente del rubro del negocio (Restaurante, Farmacia, Retail, etc.)
 * - Manejo robusto de estados (loading, error, data)
 * - Sincronización manual de inventario para mitigar stale data
 * - Agrupación defensiva de proveedores (incluye fallback "Sin Proveedor")
 * - Clipboard API segura con fallback para entornos no seguros (HTTP/local)
 * - Estilos completamente externalizados a CSS
 * - Mensajes contextualizados por rubro para pedidos
 */

// ============================================================================
// CONSTANTES Y UTILIDADES
// ============================================================================

const FALLBACK_SUPPLIER = 'Sin Proveedor Asignado';

/**
 * Valida y normaliza un valor numérico
 * @param {any} value - Valor a validar
 * @param {number} fallback - Valor por defecto si no es válido
 * @returns {number} - Número válido o fallback
 */
const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Genera el mensaje del pedido contextualizado por rubro
 * @param {string} supplierName - Nombre del proveedor
 * @param {Array} items - Items a pedir
 * @param {string} businessType - Tipo de negocio (restaurante, farmacia, retail, etc.)
 * @returns {string} - Mensaje formateado para copiar
 */
const formatOrderMessage = (supplierName, items, businessType = 'general') => {
  const isRestaurant = businessType?.toLowerCase() === 'restaurante' || 
                       businessType?.toLowerCase() === 'restaurante';
  const isPharmacy = businessType?.toLowerCase() === 'farmacia';
  
  // Determinar unidades prioritarias según rubro
  const getPriorityUnit = (item) => {
    const unit = item.unit?.toLowerCase() || 'pza';
    
    // Restaurante: priorizar unidades de medida críticas (Kg, L, g, ml)
    if (isRestaurant) {
      if (['kg', 'kilo', 'kilos'].includes(unit)) return 'Kg';
      if (['l', 'litro', 'litros'].includes(unit)) return 'L';
      if (['g', 'gramo', 'gramos'].includes(unit)) return 'g';
      if (['ml', 'mililitro', 'mililitros'].includes(unit)) return 'ml';
      return unit;
    }
    
    // Farmacia/Retail: priorizar cajas/piezas
    if (isPharmacy || businessType?.toLowerCase() === 'retail') {
      if (['caja', 'cajas', 'box', 'boxes'].includes(unit)) return 'caja(s)';
      if (['pza', 'pieza', 'piezas', 'unit', 'units'].includes(unit)) return 'pza(s)';
      return unit;
    }
    
    // General: usar unidad del item
    return item.unit || 'pza';
  };

  let header = `📋 *PEDIDO PARA: ${supplierName.toUpperCase()}*`;
  
  // Agregar contexto del rubro en el encabezado
  if (isRestaurant) {
    header += '\n🍽️ *Restaurante - Unidades Críticas*\n';
  } else if (isPharmacy) {
    header += '\n💊 *Farmacia - Control de Lotes*\n';
  } else if (businessType?.toLowerCase() === 'retail') {
    header += '\n🏪 *Retail - Inventario General*\n';
  }
  
  header += '\n';

  const body = items
    .map((item) => {
      const priorityUnit = getPriorityUnit(item);
      return `- ${item.suggestedOrder} ${priorityUnit} de *${item.name}*`;
    })
    .join('\n');

  const footer = '\nGenerado por Lanzo POS';

  return `${header}${body}${footer}`;
};

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export default function RestockSuggestion() {
  // ==========================================================================
  // ESTADO
  // ==========================================================================
  
  const [lowStockItems, setLowStockItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Estado para el modal de fallback del clipboard
  const [showClipboardFallback, setShowClipboardFallback] = useState(false);
  const [clipboardFallbackText, setClipboardFallbackText] = useState('');
  
  // Obtener rubro del negocio desde el store global
  const companyProfile = useAppStore((state) => state.companyProfile);
  const businessType = companyProfile?.business_type || 'general';

  // ==========================================================================
  // FUNCIONES DE CARGA DE DATOS
  // ==========================================================================

  /**
   * Carga el reporte de productos con stock bajo
   * IMPORTANTE: Esta función ahora usa los MISMOS CRITERIOS que el Ticker para garantizar consistencia
   * @param {boolean} isManualSync - Indica si es una sincronización manual
   */
  const loadReport = useCallback(async (isManualSync = false) => {
    if (!isManualSync) {
      setIsLoading(true);
    } else {
      setIsSyncing(true);
    }
    
    setHasError(false);
    setErrorMessage('');

    try {
      const report = await getLowStockProductsReport();
      
      // Validación defensiva de datos
      // ALINEACIÓN CON TICKER: Usar getProductAlerts para detectar stock bajo
      const validatedReport = (report || [])
        .map((item) => {
          // Usar los mismos criterios que el Ticker para detectar alertas
          const { isLowStock, isNearingExpiry, expiryDays } = getProductAlerts(item);
          const availableStock = getAvailableStock(item);
          
          return {
            ...item,
            id: item?.id || `fallback-${Date.now()}-${Math.random()}`,
            name: item?.name || 'Producto sin nombre',
            currentStock: toSafeNumber(availableStock, 0), // Usar stock disponible (sin comprometido)
            availableStock: toSafeNumber(availableStock, 0),
            physicalStock: toSafeNumber(item?.stock, 0),
            minStock: toSafeNumber(item?.minStock, 0),
            suggestedOrder: toSafeNumber(item?.suggestedOrder, 1),
            supplierName: item?.supplierName || FALLBACK_SUPPLIER,
            unit: item?.unit || 'pza',
            isActive: item?.isActive !== false,
            // Flags de alerta sincronizadas con Ticker
            hasLowStock: isLowStock,
            isNearingExpiry,
            expiryDays
          };
        })
        // ALINEACIÓN: Filtrar solo productos que tengan stock bajo (como el Ticker)
        .filter((item) => item.isActive && item.hasLowStock);

      setLowStockItems(validatedReport);
      
      if (isManualSync) {
        showMessageModal(
          `✅ Inventario sincronizado. ${validatedReport.length} productos con stock bajo detectados.`,
          null,
          { type: 'success' }
        );
      }
    } catch (error) {
      Logger.error('Error cargando sugerencias de compra:', error);
      setHasError(true);
      setErrorMessage(error?.message || 'Error desconocido al cargar el inventario');
      
      showMessageModal(
        '⚠️ Error al cargar el inventario. Verifica tu conexión o reintenta.',
        null,
        { type: 'error' }
      );
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
    }
  }, []);

  // Carga inicial del componente
  useEffect(() => {
    let isMounted = true;

    const initialLoad = async () => {
      if (!isMounted) return;
      await loadReport(false);
    };

    initialLoad();

    return () => {
      isMounted = false;
    };
  }, [loadReport]);

  // ==========================================================================
  // AGRUPAMIENTO POR PROVEEDOR (MEMOIZED)
  // ==========================================================================

  const groupedBySupplier = useMemo(() => {
    const groups = {};
    
    lowStockItems.forEach((item) => {
      const supplier = item.supplierName;
      
      if (!groups[supplier]) {
        groups[supplier] = [];
      }
      
      groups[supplier].push({
        ...item,
        // Validación defensiva de números para renderizado
        currentStock: toSafeNumber(item.currentStock, 0),        availableStock: toSafeNumber(item.availableStock, 0),
        physicalStock: toSafeNumber(item.physicalStock, 0),        minStock: toSafeNumber(item.minStock, 0),
        suggestedOrder: toSafeNumber(item.suggestedOrder, 1)
      });
    });

    // Ordenar: "Sin Proveedor Asignado" siempre al final
    const sortedGroups = {};
    const regularSuppliers = Object.keys(groups).filter((s) => s !== FALLBACK_SUPPLIER);
    const hasFallback = groups[FALLBACK_SUPPLIER];

    regularSuppliers.sort().forEach((supplier) => {
      sortedGroups[supplier] = groups[supplier];
    });

    if (hasFallback) {
      sortedGroups[FALLBACK_SUPPLIER] = hasFallback;
    }

    return sortedGroups;
  }, [lowStockItems]);

  // ==========================================================================
  // MANEJO DEL CLIPBOARD (SEGURO PARA ENTORNOS NO SEGUROS)
  // ==========================================================================

  /**
   * Maneja la copia al portapapeles con fallback para entornos no seguros
   * @param {string} supplierName - Nombre del proveedor
   * @param {Array} items - Items del pedido
   */
  const handleCopyList = useCallback((supplierName, items) => {
    // Validación temprana de navigator.clipboard
    const isClipboardAvailable = !!(navigator?.clipboard);
    
    // Generar mensaje contextualizado por rubro
    const orderText = formatOrderMessage(supplierName, items, businessType);

    if (!isClipboardAvailable) {
      // Fallback: mostrar modal con texto seleccionable
      setClipboardFallbackText(orderText);
      setShowClipboardFallback(true);
      return;
    }

    // Intentar usar Clipboard API con manejo de errores
    navigator.clipboard.writeText(orderText)
      .then(() => {
        showMessageModal(
          '✅ Lista copiada al portapapeles. Pégala en WhatsApp o tu sistema de órdenes.',
          null,
          { type: 'success' }
        );
      })
      .catch((error) => {
        Logger.warn('Clipboard API falló:', error);
        
        // Fallback por error en la API (permisos denegados, etc.)
        setClipboardFallbackText(orderText);
        setShowClipboardFallback(true);
      });
  }, [businessType]);

  /**
   * Copia el texto del fallback manualmente (para el textarea)
   */
  const handleManualCopy = useCallback(() => {
    const textarea = document.querySelector('.clipboard-fallback-textarea');
    if (textarea) {
      textarea.select();
      textarea.setSelectionRange(0, 99999); // Para móviles
      
      try {
        document.execCommand('copy');
        showMessageModal(
          '✅ Texto seleccionado. Usa Ctrl+C / Cmd+C para copiar.',
          null,
          { type: 'success' }
        );
      } catch (err) {
        Logger.warn('execCommand falló:', err);
      }
    }
  }, []);

  // ==========================================================================
  // TODO: FUNCIÓN PARA ENVIAR ORDEN DE COMPRA A LA BASE DE DATOS
  // ==========================================================================
  
  /**
   * TODO: Implementar envío de orden de compra a la base de datos
   * 
   * Esta función debe:
   * 1. Recibir el arreglo de items y el proveedor
   * 2. Generar un registro en la tabla de "purchase_orders" o "orden_compra"
   * 3. Incluir metadata: fecha, usuario, rubro, total estimado
   * 4. Retornar el ID de la orden creada
   * 5. Manejar estados de loading y error
   * 
   * @param {string} supplierName - Nombre del proveedor
   * @param {Array} items - Items a ordenar
   * @param {string} businessType - Tipo de negocio
   * @returns {Promise<{success: boolean, orderId?: string, error?: string}>}
   * 
   * Ejemplo de estructura a guardar:
   * {
   *   id: generateID('order'),
   *   supplierName: supplierName,
   *   items: items.map(i => ({ productId: i.id, quantity: i.suggestedOrder, unit: i.unit })),
   *   businessType: businessType,
   *   createdAt: new Date().toISOString(),
   *   createdBy: currentUser?.id,
   *   status: 'pending' // pending, approved, received, cancelled
   * }
   */
  const handleCreatePurchaseOrder = useCallback(async (supplierName, items) => {
    // TODO: Implementar lógica de negocio de Lanzo POS
    // 1. Importar servicio de órdenes de compra: import { createPurchaseOrder } from '../../services/purchaseOrders';
    // 2. Validar permisos del usuario
    // 3. Mostrar modal de confirmación con total estimado
    // 4. Llamar al servicio: const result = await createPurchaseOrder({ supplierName, items, businessType });
    // 5. Notificar resultado: showMessageModal(result.success ? 'Orden creada' : 'Error al crear', null, { type: result.success ? 'success' : 'error' });
    
    Logger.log('[TODO] Crear orden de compra para:', supplierName, items);
    showMessageModal(
      '🚧 Función en desarrollo: La creación de órdenes de compra estará disponible pronto.',
      null,
      { type: 'warning' }
    );
    
    return {
      success: false,
      error: 'NOT_IMPLEMENTED'
    };
  }, [businessType]);

  // ==========================================================================
  // RENDERIZADO
  // ==========================================================================

  // Estado de carga inicial
  if (isLoading) {
    return (
      <div className="restock-loading">
        <RefreshCw className="restock-loading-icon" size={24} />
        <span>Analizando inventario para reabastecimiento...</span>
      </div>
    );
  }

  // Estado de error
  if (hasError) {
    return (
      <div className="restock-error">
        <AlertTriangle className="restock-error-icon" size={48} />
        <h3>Error al cargar el inventario</h3>
        <p>{errorMessage}</p>
        <button className="btn-retry" onClick={() => loadReport(false)}>
          <RefreshCw size={16} />
          Reintentar
        </button>
      </div>
    );
  }

  // Estado vacío (todo en orden)
  if (lowStockItems.length === 0) {
    return (
      <div className="restock-empty">
        <Truck className="restock-empty-icon" size={48} />
        <h3>¡Todo en Orden!</h3>
        <p>
          Tu inventario está saludable. No hay productos por debajo del mínimo.
        </p>
      </div>
    );
  }

  // Estado con datos
  return (
    <div className="restock-container">
      {/* HEADER CON BOTÓN DE SINCRONIZACIÓN */}
      <div className="restock-header">
        <div className="restock-header-content">
          <AlertTriangle className="restock-header-icon" size={20} />
          <div>
            <h3 className="restock-header-title">
              Sugerencias de Compra
            </h3>
            <span className="restock-header-count">
              {lowStockItems.length} productos con stock bajo
            </span>
          </div>
        </div>
        
        <div className="restock-header-actions">
          <button
            className="btn-sync"
            onClick={() => loadReport(true)}
            disabled={isSyncing}
            title="Forzar recarga del inventario"
          >
            <RefreshCw size={16} className="btn-sync-icon" />
            <span className="btn-label">{isSyncing ? 'Sincronizando...' : 'Sincronizar'}</span>
          </button>
        </div>
      </div>

      {/* GRID DE TARJETAS POR PROVEEDOR */}
      <div className="restock-grid">
        {Object.entries(groupedBySupplier).map(([supplier, items]) => (
          <div
            key={supplier}
            className={`supplier-card ${supplier === FALLBACK_SUPPLIER ? 'fallback-supplier' : ''}`}
          >
            {/* Header de la tarjeta */}
            <div className="supplier-card-header">
              <h4 className={`supplier-card-title ${items.length === 0 ? 'no-orders' : ''}`}>
                {supplier}
              </h4>
              <div className="supplier-card-actions">
                {/* TODO: Botón para crear orden de compra real */}
                {/* <button
                  className="btn-create-order"
                  onClick={() => handleCreatePurchaseOrder(supplier, items)}
                  title="Crear orden de compra en el sistema"
                  disabled={items.length === 0}
                >
                  <FileText size={14} />
                  <span className="btn-label">Crear Orden</span>
                </button> */}
                
                <button
                  className="btn-copy-list"
                  onClick={() => handleCopyList(supplier, items)}
                  disabled={items.length === 0}
                  title="Copiar lista para WhatsApp"
                >
                  <Clipboard size={14} />
                  <span className="btn-label">Copiar</span>
                </button>
              </div>
            </div>

            {/* Tabla de productos */}
            {items.length > 0 ? (
              <table className="supplier-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="text-center">Stock</th>
                    <th className="text-right">Pedir</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="product-name">{item.name}</td>
                      <td className="stock-cell">
                        <div className="stock-info">
                          <span className="current-stock">{item.availableStock}</span>
                          {item.physicalStock !== item.availableStock && (
                            <span className="committed-info" title="Stock físico - Stock comprometido">
                              ({item.physicalStock} fís.)
                            </span>
                          )}
                          <span className="stock-min">
                            min: {item.minStock}
                          </span>
                        </div>
                      </td>
                      <td className="order-cell">
                        {item.suggestedOrder} {item.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="supplier-card-title no-orders">
                No hay productos para mostrar
              </p>
            )}
          </div>
        ))}
      </div>

      {/* MODAL DE FALLBACK PARA CLIPBOARD */}
      {showClipboardFallback && (
        <div className="clipboard-fallback-overlay">
          <div className="clipboard-fallback-modal" role="dialog" aria-labelledby="fallback-title">
            <div className="clipboard-fallback-modal-header">
              <AlertTriangle size={20} color="var(--warning-color)" />
              <h4 id="fallback-title">Clipboard no disponible</h4>
            </div>
            
            <div className="clipboard-fallback-modal-body">
              <p style={{ marginBottom: 'var(--spacing-sm)', color: 'var(--text-light)', fontSize: '0.9rem' }}>
                Tu navegador no permite acceso automático al portapapeles (posiblemente por HTTP o permisos).
                Selecciona y copia manualmente:
              </p>
              
              <textarea
                className="clipboard-fallback-textarea"
                value={clipboardFallbackText}
                readOnly
                rows={10}
                onClick={(e) => e.target.select()}
              />
              
              <div className="clipboard-fallback-instructions">
                💡 <strong>Instrucciones:</strong> Haz click en el texto, presiona Ctrl+A (Cmd+A en Mac) para seleccionar todo, luego Ctrl+C (Cmd+C) para copiar.
              </div>
            </div>
            
            <div className="clipboard-fallback-modal-footer">
              <button
                className="btn-close-fallback"
                onClick={() => setShowClipboardFallback(false)}
              >
                Cerrar
              </button>
              <button
                className="btn-copy-list"
                onClick={handleManualCopy}
                style={{ marginLeft: 'var(--spacing-sm)' }}
              >
                <Clipboard size={14} />
                Seleccionar y Copiar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
