import { db, STORES } from './dexie';
import { handleDexieError, validateOrThrow, DatabaseError, DB_ERROR_CODES } from './utils';
import { generateID } from '../utils';
import { buildPhoneBuckets, summarizePhoneConflictGroups, toIndexedPhoneKey } from './customerPhoneUtils';

// Importamos los esquemas de validacion existentes
import { productSchema } from '../../schemas/productSchema';
import { customerSchema } from '../../schemas/customerSchema';

const SCHEMAS = {
  [STORES.MENU]: productSchema,
  [STORES.CUSTOMERS]: customerSchema
};

const PHONE_FIELD = 'phone';

const buildPhoneConstraintError = (message, details = {}) => {
  return new DatabaseError(DB_ERROR_CODES.CONSTRAINT_VIOLATION, message, {
    field: PHONE_FIELD,
    actionable: 'CHECK_FORM',
    ...details
  });
};

const getPhonePolicyContext = (customers = []) => {
  const buckets = buildPhoneBuckets(customers);
  const conflictGroups = Array.from(buckets.entries())
    .filter(([, records]) => records.length > 1)
    .map(([phoneKey, records]) => ({ phoneKey, records }));

  const conflictRecordIds = new Set();
  conflictGroups.forEach((group) => {
    group.records.forEach((record) => conflictRecordIds.add(record.id));
  });

  return { buckets, conflictGroups, conflictRecordIds };
};

const applyCustomerWriteMetadata = (dataToSave, existingRecord) => {
  const now = new Date().toISOString();

  if (!dataToSave.createdAt) {
    dataToSave.createdAt = existingRecord?.createdAt || now;
  }

  dataToSave.updatedAt = now;
};

const applyCustomerPhonePolicy = async (dataToSave, existingRecord) => {
  const allCustomers = await db.table(STORES.CUSTOMERS).toArray();
  const { buckets, conflictGroups, conflictRecordIds } = getPhonePolicyContext(allCustomers);

  const currentId = dataToSave.id || existingRecord?.id || null;
  const incomingPhone = dataToSave.phone !== undefined
    ? dataToSave.phone
    : (existingRecord?.phone || '');
  const incomingPhoneKey = toIndexedPhoneKey(incomingPhone);

  const hasHistoricalConflicts = conflictGroups.length > 0;
  const isCurrentRecordInConflict = currentId ? conflictRecordIds.has(currentId) : false;

  if (hasHistoricalConflicts && !isCurrentRecordInConflict) {
    const conflictPreview = summarizePhoneConflictGroups(conflictGroups);

    throw buildPhoneConstraintError(
      'Se detectaron telefonos duplicados historicos. Resuelve esos conflictos antes de crear o editar otros clientes.',
      {
        actionable: 'RESOLVE_PHONE_CONFLICTS',
        conflictPreview
      }
    );
  }

  if (!incomingPhoneKey) {
    delete dataToSave.phoneKey;
    return;
  }

  const samePhoneRecords = (buckets.get(incomingPhoneKey) || [])
    .filter((customer) => customer.id !== currentId);

  if (samePhoneRecords.length > 0) {
    const message = hasHistoricalConflicts
      ? 'Este telefono sigue en conflicto. Asigna un telefono unico o dejalo vacio temporalmente para resolver.'
      : 'El telefono ya esta registrado para otro cliente.';

    throw buildPhoneConstraintError(message, {
      actionable: hasHistoricalConflicts ? 'RESOLVE_PHONE_CONFLICTS' : 'CHECK_FORM'
    });
  }

  dataToSave.phoneKey = incomingPhoneKey;
};

/**
 * Repositorio Generico para operaciones CRUD basicas.
 * Incluye validacion Zod automatica y manejo de errores estandarizado.
 */
export const generalRepository = {
  async getAll(storeName) {
    try {
      return await db.table(storeName).toArray();
    } catch (error) {
      if (error?.name === 'DatabaseError') throw error;
      throw handleDexieError(error, `Get All ${storeName}`);
    }
  },

  async getById(storeName, id) {
    try {
      return await db.table(storeName).get(id);
    } catch (error) {
      if (error?.name === 'DatabaseError') throw error;
      throw handleDexieError(error, `Get By ID ${storeName}`);
    }
  },

  async save(storeName, data) {
    try {
      const dataToSave = { ...data };
      const existingRecord = data?.id
        ? await db.table(storeName).get(data.id)
        : null;

      if (storeName === STORES.MENU && dataToSave.name) {
        dataToSave.name_lower = dataToSave.name.toLowerCase();
      }

      if (storeName === STORES.MENU && dataToSave.committedStock === undefined) {
        dataToSave.committedStock = existingRecord?.committedStock ?? 0;
      }

      if (storeName === STORES.PRODUCT_BATCHES && dataToSave.committedStock === undefined) {
        dataToSave.committedStock = existingRecord?.committedStock ?? 0;
      }

      if (storeName === STORES.CUSTOMERS) {
        applyCustomerWriteMetadata(dataToSave, existingRecord);
        await applyCustomerPhonePolicy(dataToSave, existingRecord);
      }

      const schema = SCHEMAS[storeName];
      const validatedData = validateOrThrow(schema, dataToSave, `Save ${storeName}`);

      if (data?.id && existingRecord) {
        await db.table(storeName).update(data.id, validatedData);
      } else {
        await db.table(storeName).put(validatedData);
      }

      return { success: true };
    } catch (error) {
      if (error?.name === 'DatabaseError') throw error;
      throw handleDexieError(error, `Save ${storeName}`);
    }
  },

  async saveBulk(storeName, dataArray) {
    try {
      const schema = SCHEMAS[storeName];

      const validItems = dataArray.map((item, index) => {
        const processed = { ...item };

        if (storeName === STORES.MENU && processed.name) {
          processed.name_lower = processed.name.toLowerCase();
        }

        if (storeName === STORES.MENU && processed.committedStock === undefined) {
          processed.committedStock = 0;
        }

        if (storeName === STORES.PRODUCT_BATCHES && processed.committedStock === undefined) {
          processed.committedStock = 0;
        }

        if (storeName === STORES.CUSTOMERS) {
          const phoneKey = toIndexedPhoneKey(processed.phone);
          if (phoneKey) {
            processed.phoneKey = phoneKey;
          } else {
            delete processed.phoneKey;
          }

          const now = new Date().toISOString();
          processed.createdAt = processed.createdAt || now;
          processed.updatedAt = now;
        }

        return validateOrThrow(schema, processed, `Bulk Save ${storeName} (Index ${index})`);
      });

      await db.table(storeName).bulkPut(validItems);
      return { success: true };
    } catch (error) {
      if (error?.name === 'DatabaseError') throw error;
      throw handleDexieError(error, `Bulk Save ${storeName}`);
    }
  },

  async delete(storeName, id) {
    try {
      await db.table(storeName).delete(id);
      return { success: true };
    } catch (error) {
      if (error?.name === 'DatabaseError') throw error;
      throw handleDexieError(error, `Delete ${storeName}`);
    }
  },

  async recycle(sourceStore, trashStore, id, reason = 'Eliminado por usuario') {
    try {
      await db.transaction('rw', [sourceStore, trashStore], async () => {
        const item = await db.table(sourceStore).get(id);

        if (!item) {
          throw new Error('ItemNotFound');
        }

        const deletedItem = {
          ...item,
          deletedTimestamp: new Date().toISOString(),
          deletedReason: reason,
          originalStore: sourceStore
        };

        await db.table(trashStore).put(deletedItem);
        await db.table(sourceStore).delete(id);
      });

      return { success: true };
    } catch (error) {
      if (error.message === 'ItemNotFound') {
        return { success: false, message: 'El item ya no existe' };
      }
      if (error?.name === 'DatabaseError') throw error;
      throw handleDexieError(error, `Recycle ${sourceStore}`);
    }
  },

  async findByIndex(storeName, indexName, value) {
    try {
      return await db.table(storeName).where(indexName).equals(value).toArray();
    } catch (error) {
      if (error?.name === 'DatabaseError') throw error;
      throw handleDexieError(error, `Find By Index ${storeName}`);
    }
  },

  async getMultiple(storeName, ids) {
    try {
      return await db.table(storeName).bulkGet(ids);
    } catch (error) {
      if (error?.name === 'DatabaseError') throw error;
      throw handleDexieError(error, `Bulk Get ${storeName}`);
    }
  }
};

export const categoriesRepository = {
  async saveCategory(categoryData) {
    const isNew = !categoryData.id;

    const displayName = categoryData.name.trim();
    const comparisonName = displayName.replace(/\s+/g, '').toLowerCase();

    const existing = await db.table(STORES.CATEGORIES)
      .filter(c => c.name.replace(/\s+/g, '').toLowerCase() === comparisonName && c.isActive !== false)
      .first();

    if (existing && existing.id !== categoryData.id) {
      throw new DatabaseError(DB_ERROR_CODES.CONSTRAINT_VIOLATION, 'Ya existe una categoria activa con este nombre.');
    }

    const payload = {
      id: categoryData.id || generateID('cat'),
      name: displayName,
      color: categoryData.color || '#cccccc',
      sortOrder: Number(categoryData.sortOrder) || 0,
      isActive: true,
      updatedAt: new Date().toISOString(),
      ...(isNew && { createdAt: new Date().toISOString() })
    };

    await db.table(STORES.CATEGORIES).put(payload);
    return payload;
  },

  async softDeleteCategory(categoryId) {
    const category = await db.table(STORES.CATEGORIES).get(categoryId);
    if (!category) return { success: false, message: 'Categoria no encontrada' };

    await db.table(STORES.CATEGORIES).update(categoryId, {
      isActive: false,
      deletedAt: new Date().toISOString()
    });

    return { success: true };
  },

  async getActiveCategories() {
    const categories = await db.table(STORES.CATEGORIES)
      .filter(c => c.isActive !== false)
      .toArray();

    return categories.sort((a, b) => a.sortOrder - b.sortOrder);
  }
};
