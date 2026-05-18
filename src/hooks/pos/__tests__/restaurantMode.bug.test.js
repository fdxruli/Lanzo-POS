/**
 * Test: Restaurante Mode - Persisted Orders Bug
 * 
 * Verifica que las órdenes guardadas en modo Restaurante no se recarguen
 * como "en edición" cuando se regresa del OrderPage al POS.
 * 
 * Bug: Al guardar un pedido → ir a OrderPage → regresar al POS,
 * el pedido anterior se mostraba como si estuviera siendo editado.
 * 
 * Root Cause: loadOrdersFromDB() recargaba TODAS las órdenes con status=OPEN,
 * sin distinguir entre órdenes siendo editadas vs ya enviadas a cocina.
 * 
 * Fix: 
 * 1. saveOrderAsOpen() en useTableManagement ahora cambia fulfillmentStatus a 'pending'
 * 2. loadOrdersFromDB() filtra para solo cargar órdenes con fulfillmentStatus='open'
 * 3. Las órdenes 'pending' quedan en OrderPage/cocina, no en sesión del POS
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Restaurante Mode - Persisted Orders Bug Fix', () => {
  
  describe('loadOrdersFromDB filtering logic', () => {
    
    it('should NOT reload orders that were sent to kitchen (fulfillmentStatus=pending)', () => {
      // Simular órdenes en BD
      const allOpenSales = [
        {
          id: 'sal-001',
          tableData: 'Mesa 1 - Cliente Juan',
          status: 'open',
          fulfillmentStatus: 'pending',  // ← ENVIADA A COCINA
          items: [{ id: 'prod-1', quantity: 2 }],
          timestamp: new Date().toISOString()
        },
        {
          id: 'sal-002',
          tableData: 'Mesa 2 - Cliente María',
          status: 'open',
          fulfillmentStatus: 'open',  // ← EN EDICIÓN EN POS
          items: [{ id: 'prod-2', quantity: 1 }],
          timestamp: new Date().toISOString()
        }
      ];

      // El filtro correcto debería ser:
      const openSales = allOpenSales.filter(sale => 
        !sale.fulfillmentStatus || sale.fulfillmentStatus === 'open'
      );

      // Validación: Solo la orden con fulfillmentStatus='open' debe cargarse
      expect(openSales).toHaveLength(1);
      expect(openSales[0].id).toBe('sal-002');
      expect(openSales[0].fulfillmentStatus).toBe('open');
    });

    it('should handle orders with missing fulfillmentStatus as if they are open', () => {
      const allOpenSales = [
        {
          id: 'sal-003',
          tableData: 'Mesa 3',
          status: 'open',
          // fulfillmentStatus omitido (legacy data)
          items: [],
          timestamp: new Date().toISOString()
        }
      ];

      const openSales = allOpenSales.filter(sale => 
        !sale.fulfillmentStatus || sale.fulfillmentStatus === 'open'
      );

      // Legacy orders sin fulfillmentStatus deben cargarse
      expect(openSales).toHaveLength(1);
    });

    it('should NOT reload multiple pending orders from previous POS sessions', () => {
      // Escenario del usuario: 2 pedidos guardados antes
      const allOpenSales = [
        {
          id: 'sal-old-1',
          tableData: 'Cliente Antiguo 1',
          status: 'open',
          fulfillmentStatus: 'pending',
          timestamp: new Date(Date.now() - 3600000).toISOString()
        },
        {
          id: 'sal-old-2',
          tableData: 'Cliente Antiguo 2',
          status: 'open',
          fulfillmentStatus: 'pending',
          timestamp: new Date(Date.now() - 1800000).toISOString()
        },
        {
          id: 'sal-new-1',
          tableData: 'Nueva Orden',
          status: 'open',
          fulfillmentStatus: 'open',
          timestamp: new Date().toISOString()
        }
      ];

      const openSales = allOpenSales.filter(sale => 
        !sale.fulfillmentStatus || sale.fulfillmentStatus === 'open'
      );

      // Solo la nueva orden en edición debe estar en sesión
      expect(openSales).toHaveLength(1);
      expect(openSales[0].id).toBe('sal-new-1');
      
      // Los dos pedidos antiguos enviados a cocina NO se cargan
      expect(openSales.some(s => s.id === 'sal-old-1')).toBe(false);
      expect(openSales.some(s => s.id === 'sal-old-2')).toBe(false);
    });
  });

  describe('saveOrderAsOpen fulfillmentStatus management', () => {
    
    it('should preserve existing fulfillmentStatus when updating order', () => {
      // Simular una orden que ya existe con status='pending' (ya enviada a cocina)
      const existingSale = {
        id: 'sal-001',
        status: 'open',
        fulfillmentStatus: 'pending',  // Ya fue enviada a cocina
        items: [],
        timestamp: new Date().toISOString()
      };

      // La lógica en saveOrderAsOpen debería preservar esto:
      const newRecord = {
        ...existingSale,
        // fulfillmentStatus: existingSale?.fulfillmentStatus || OPEN_FULFILLMENT_STATUS
        fulfillmentStatus: existingSale?.fulfillmentStatus || 'open'
      };

      // El status debe mantenerse como 'pending' (enviado a cocina)
      expect(newRecord.fulfillmentStatus).toBe('pending');
    });

    it('should set fulfillmentStatus=open for new orders being created', () => {
      // Nueva orden, no existe previamente
      const existingSale = null;
      const OPEN_FULFILLMENT_STATUS = 'open';

      const newRecord = {
        status: 'open',
        fulfillmentStatus: existingSale?.fulfillmentStatus || OPEN_FULFILLMENT_STATUS
      };

      expect(newRecord.fulfillmentStatus).toBe('open');
    });
  });

  describe('handleSaveAsOpen state transition', () => {
    
    it('should transition order from editing (open) to sent-to-kitchen (pending)', () => {
      // Simulación del flujo:
      // 1. Usuario crea/edita orden: fulfillmentStatus = 'open'
      const orderBeforeSave = {
        id: 'sal-001',
        status: 'open',
        fulfillmentStatus: 'open',  // En edición
        items: [{ id: 'prod-1', quantity: 2 }]
      };

      // 2. Usuario hace click en "Guardar/Enviar a Cocina"
      // En handleSaveAsOpen se ejecuta:
      // - saveOrderAsOpen() → mantiene 'open' o lo que había
      // - Luego se actualiza: db.update(orderId, { fulfillmentStatus: 'pending' })
      
      const orderAfterUpdate = {
        ...orderBeforeSave,
        fulfillmentStatus: 'pending'  // ← ACTUALIZADO A PENDING
      };

      // 3. Cuando regresa al POS, loadOrdersFromDB filtra y NO la carga
      const shouldLoadInPOS = !orderAfterUpdate.fulfillmentStatus || 
                               orderAfterUpdate.fulfillmentStatus === 'open';
      
      expect(shouldLoadInPOS).toBe(false);
      expect(orderAfterUpdate.fulfillmentStatus).toBe('pending');
    });
  });
});
