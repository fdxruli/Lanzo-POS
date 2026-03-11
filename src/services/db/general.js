import { db, STORES } from './dexie';
import { handleDexieError, validateOrThrow,DatabaseError, DB_ERROR_CODES, } from './utils';
import { generateID } from '../utils'

// Importamos los esquemas de validación existentes
// Asegúrate de que las rutas sean correctas respecto a la nueva ubicación
import { productSchema } from '../../schemas/productSchema';
import { customerSchema } from '../../schemas/customerSchema';

// Mapeo de Esquemas para validación automática
const SCHEMAS = {
  [STORES.MENU]: productSchema,
  [STORES.CUSTOMERS]: customerSchema,
  // Agrega aquí otros esquemas futuros (ej: categorySchema)
};

/**
 * Repositorio Genérico para operaciones CRUD básicas.
 * Incluye validación Zod automática y manejo de errores estandarizado.
 */
export const generalRepository = {

  /**
   * Obtiene todos los registros de una tienda.
   * @param {string} storeName - Nombre de la tienda (usar constantes STORES).
   * @returns {Promise<Array>}
   */
  async getAll(storeName) {
    try {
      return await db.table(storeName).toArray();
    } catch (error) {
      throw handleDexieError(error, `Get All ${storeName}`);
    }
  },

  /**
   * Obtiene un registro por su ID (o clave primaria).
   * @param {string} storeName 
   * @param {string|number} id 
   */
  async getById(storeName, id) {
    try {
      return await db.table(storeName).get(id);
    } catch (error) {
      throw handleDexieError(error, `Get By ID ${storeName}`);
    }
  },

  /**
   * Guarda o actualiza un registro (Upsert).
   * Valida automáticamente si existe un esquema asociado.
   * @param {string} storeName 
   * @param {object} data 
   */
  async save(storeName, data) {
    try {
      // 1. Normalización
      const dataToSave = { ...data };
      if (storeName === STORES.MENU && dataToSave.name) {
        dataToSave.name_lower = dataToSave.name.toLowerCase();
      }

      // 2. Validación Zod
      const schema = SCHEMAS[storeName];
      const validatedData = validateOrThrow(schema, dataToSave, `Save ${storeName}`);

      // 3. Guardado Inteligente (Update vs Put) CORREGIDO
      if (data.id) {
        // Consultar si realmente existe el registro en la BD
        const existingRecord = await db.table(storeName).get(data.id);

        if (existingRecord) {
          // Si existe, hacemos update para no destruir campos ocultos (merge superficial)
          await db.table(storeName).update(data.id, validatedData);
        } else {
          // Tiene ID pre-generado pero es un registro nuevo en la BD
          await db.table(storeName).put(validatedData);
        }
      } else {
        // Por precaución, si llegara un dato sin ID
        await db.table(storeName).put(validatedData);
      }

      return { success: true };

    } catch (error) {
      throw handleDexieError(error, `Save ${storeName}`);
    }
  },

  /**
   * Guarda múltiples registros en una sola operación (Bulk Upsert).
   * Ideal para importaciones o sincronizaciones.
   * @param {string} storeName 
   * @param {Array} dataArray 
   */
  async saveBulk(storeName, dataArray) {
    try {
      const schema = SCHEMAS[storeName];

      // 1. Validar y Normalizar todo el array antes de tocar la BD
      const validItems = dataArray.map((item, index) => {
        const processed = { ...item };
        if (storeName === STORES.MENU && processed.name) {
          processed.name_lower = processed.name.toLowerCase();
        }
        // validateOrThrow lanzará error con el contexto si falla
        return validateOrThrow(schema, processed, `Bulk Save ${storeName} (Index ${index})`);
      });

      // 2. Bulk Put (Muy rápido en Dexie)
      await db.table(storeName).bulkPut(validItems);
      return { success: true };

    } catch (error) {
      throw handleDexieError(error, `Bulk Save ${storeName}`);
    }
  },

  /**
   * Elimina un registro por ID.
   */
  async delete(storeName, id) {
    try {
      await db.table(storeName).delete(id);
      return { success: true };
    } catch (error) {
      throw handleDexieError(error, `Delete ${storeName}`);
    }
  },

  /**
   * Mueve un item a la papelera (Soft Delete) de forma Transaccional.
   * @param {string} sourceStore - Tienda origen (ej: 'menu')
   * @param {string} trashStore - Tienda destino (ej: 'deleted_menu')
   * @param {string} id - ID del item
   * @param {string} reason 
   */
  async recycle(sourceStore, trashStore, id, reason = "Eliminado por usuario") {
    try {
      // Usamos una transacción Read-Write para atomicidad
      await db.transaction('rw', [sourceStore, trashStore], async () => {
        const item = await db.table(sourceStore).get(id);

        if (!item) {
          throw new Error('ItemNotFound'); // Salimos de la transacción
        }

        const deletedItem = {
          ...item,
          deletedTimestamp: new Date().toISOString(),
          deletedReason: reason,
          originalStore: sourceStore
        };

        // En Dexie, las operaciones dentro de transaction se "encolan"
        await db.table(trashStore).put(deletedItem);
        await db.table(sourceStore).delete(id);
      });

      return { success: true };

    } catch (error) {
      if (error.message === 'ItemNotFound') {
        return { success: false, message: 'El item ya no existe' };
      }
      throw handleDexieError(error, `Recycle ${sourceStore}`);
    }
  },

  /**
   * Búsqueda simple por índice.
   * @param {string} storeName 
   * @param {string} indexName - Nombre del campo indexado (ej: 'categoryId')
   * @param {any} value - Valor a buscar
   */
  async findByIndex(storeName, indexName, value) {
    try {
      return await db.table(storeName).where(indexName).equals(value).toArray();
    } catch (error) {
      throw handleDexieError(error, `Find By Index ${storeName}`);
    }
  },

  async getMultiple(storeName, ids) {
    try {
      // Dexie bulkGet es infinitamente más rápido que N llamadas get()
      // Ejecuta una sola transacción readonly.
      return await db.table(storeName).bulkGet(ids);
    } catch (error) {
      throw handleDexieError(error, `Bulk Get ${storeName}`);
    }
  }
};



export const categoriesRepository = {
  /**
   * Guarda o actualiza una categoría validando que el nombre no exista.
   */
  async saveCategory(categoryData) {
    const isNew = !categoryData.id;

    // 1. El nombre real para guardar (solo limpiamos los extremos)
    const displayName = categoryData.name.trim();

    // 2. El nombre sanitizado SOLO para comparación
    const comparisonName = displayName.replace(/\s+/g, '').toLowerCase();

    const existing = await db.table(STORES.CATEGORIES)
      .filter(c => c.name.replace(/\s+/g, '').toLowerCase() === comparisonName && c.isActive !== false)
      .first();

    if (existing && existing.id !== categoryData.id) {
      throw new DatabaseError(DB_ERROR_CODES.CONSTRAINT_VIOLATION, 'Ya existe una categoría activa con este nombre.');
    }

    // Preparar el payload usando el nombre legible (displayName)
    const payload = {
      id: categoryData.id || generateID('cat'),
      name: displayName, // <-- AQUÍ USAMOS EL LEGIBLE
      color: categoryData.color || '#cccccc',
      sortOrder: Number(categoryData.sortOrder) || 0,
      isActive: true,
      updatedAt: new Date().toISOString(),
      ...(isNew && { createdAt: new Date().toISOString() })
    };

    await db.table(STORES.CATEGORIES).put(payload);
    return payload;
  },

  /**
   * Soft Delete: Mantiene la categoría para reportes históricos, pero la oculta de la UI.
   */
  async softDeleteCategory(categoryId) {
    const category = await db.table(STORES.CATEGORIES).get(categoryId);
    if (!category) return { success: false, message: 'Categoría no encontrada' };

    await db.table(STORES.CATEGORIES).update(categoryId, {
      isActive: false,
      deletedAt: new Date().toISOString()
    });

    return { success: true };
  },

  /**
   * Obtiene solo categorías activas ordenadas por sortOrder.
   */
  async getActiveCategories() {
    const categories = await db.table(STORES.CATEGORIES)
      .filter(c => c.isActive !== false)
      .toArray();

    return categories.sort((a, b) => a.sortOrder - b.sortOrder);
  }
};