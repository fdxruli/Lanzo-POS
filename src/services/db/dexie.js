import Dexie from 'dexie';
import { DB_NAME } from '../../config/dbConfig'; // Usamos tu config existente
// Nota: Dexie maneja el versionado de forma interna y más limpia, 
// pero importamos DB_NAME para mantener consistencia.

/**
 * Mapeo de nombres de Tablas (Stores) para mantener consistencia 
 * con el resto de la aplicación que usa la constante STORES.
 */
export const STORES = {
  MENU: 'menu',
  SALES: 'sales',
  STATS: 'global_stats',
  COMPANY: 'company',
  THEME: 'theme',
  INGREDIENTS: 'ingredients',
  CATEGORIES: 'categories',
  CUSTOMERS: 'customers',
  CAJAS: 'cajas',
  DELETED_MENU: 'deleted_menu',
  DELETED_CUSTOMERS: 'deleted_customers',
  DELETED_SALES: 'deleted_sales',
  DELETED_CATEGORIES: 'deleted_categories',
  MOVIMIENTOS_CAJA: 'movimientos_caja',
  PRODUCT_BATCHES: 'product_batches',
  WASTE: 'waste_logs',
  DAILY_STATS: 'daily_stats',
  PROCESSED_SALES_LOG: 'processed_sales_log',
  TRANSACTION_LOG: 'transaction_log',
  SYNC_CACHE: 'sync_cache',
  IMAGES: 'images',
  LAYAWAYS: 'layaways'
};

class LanzoDatabase extends Dexie {
  constructor() {
    super(DB_NAME);

    // Definición del Esquema (Versión 1)
    // SINTAXIS DEXIE:
    // '++id': Auto-increment (Si usas UUIDs strings, usa solo 'id')
    // '&': Índice Único (Unique)
    // '*': Multi-entry index (para arrays de etiquetas, etc.)
    // '[a+b]': Índice Compuesto
    
    // NOTA IMPORTANTE: Asumo que usas UUIDs (strings) para los IDs basado en tu código anterior (generateID).
    // Por eso uso 'id' y no '++id'. Si alguna tabla usa auto-increment numérico, avísame para cambiarlo.
    
    this.version(1).stores({
      // --- Inventario y Productos ---
      [STORES.MENU]: 'id, barcode, name_lower, categoryId', // Índices simples
      
      [STORES.PRODUCT_BATCHES]: 'id, productId, sku, expiryDate, [productId+isActive], [productId+isActive+createdAt]', 
      // ^ Aquí incluimos tus índices compuestos y el nuevo de caducidad
      
      [STORES.CATEGORIES]: 'id',
      [STORES.INGREDIENTS]: 'id',

      // --- Ventas y Clientes ---
      [STORES.SALES]: 'id, &timestamp, customerId, fulfillmentStatus, [customerId+timestamp]', 
      // ^ &timestamp es único. Agregamos fulfillmentStatus para KDS.

      [STORES.CUSTOMERS]: 'id, phone', 

      // --- Caja y Movimientos ---
      [STORES.CAJAS]: 'id, estado', // Para encontrar caja abierta rápido
      [STORES.MOVIMIENTOS_CAJA]: 'id, caja_id',

      // --- Auditoría y Logs ---
      [STORES.TRANSACTION_LOG]: 'id, status, timestamp', // Para recuperación de transacciones

      // --- Configuración y Varios ---
      [STORES.COMPANY]: 'id',
      [STORES.THEME]: 'id',
      [STORES.STATS]: 'id', // global_stats
      [STORES.DAILY_STATS]: 'id', // Usualmente la fecha es el ID aquí
      
      // --- Papelera ---
      [STORES.DELETED_MENU]: 'id',
      [STORES.DELETED_CUSTOMERS]: 'id',
      [STORES.DELETED_SALES]: 'id',
      [STORES.DELETED_CATEGORIES]: 'id',

      // --- Otros ---
      [STORES.WASTE]: 'id',
      [STORES.PROCESSED_SALES_LOG]: 'id',
      
      // Casos especiales de KeyPath
      [STORES.SYNC_CACHE]: 'key', // Tu código usaba 'key' como primary key
      [STORES.IMAGES]: 'id',       // Almacenamiento de Blobs

      // Esquema de apartados 
      [STORES.LAYAWAYS]: 'id, customerId, status, deadline, [customerId+status]'
    });
    
    // Middleware (Hooks) Opcional: 
    // Aquí podríamos agregar hooks globales para logs o auditoría automática en el futuro.
  }
}

// Instancia Singleton
export const db = new LanzoDatabase();

// Exportar clase por si se necesita instanciar para tests
export { LanzoDatabase };