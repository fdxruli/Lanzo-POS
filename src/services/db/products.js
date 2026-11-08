import { db, STORES } from './dexie';
import Dexie from 'dexie';
import {
    handleDexieError,
    validateOrThrow,
    DatabaseError,
    DB_ERROR_CODES,
    getCommittedStock,
    normalizeStock
} from './utils';
import { generateID } from '../utils';
import { productSchema } from '../../schemas/productSchema';
import { normalizeProductComplexFields } from '../products/productMapper';
import Logger from '../Logger';
import { collectBatchRestorations, restoreBatchStock } from '../sales/batchRestoration';
import { searchProductsInTable } from './productSearch';
import { calculateShelfLifeTargetDate } from '../../utils/expirationPolicy';
import { getRecipeIngredientId } from '../../utils/ingredientConfiguration';

const validateInitialBatchForProduct = (batch, product) => {
    if (!batch?.id) {
        throw new DatabaseError(DB_ERROR_CODES.VALIDATION_ERROR, 'El lote inicial no tiene ID.');
    }

    if (batch.productId !== product.id) {
        throw new DatabaseError(DB_ERROR_CODES.VALIDATION_ERROR, 'El lote inicial no pertenece al producto creado.');
    }

    if (batch.stock < 0 || batch.cost < 0 || batch.price < 0) {
        throw new DatabaseError(
            DB_ERROR_CODES.VALIDATION_ERROR,
            'El lote inicial no puede tener stock, costo o precio negativos.'
        );
    }

    if (product.expirationMode === 'STRICT') {
        if (!String(batch.manufacturerBatchId || '').trim()) {
            throw new DatabaseError(
  ¶»§q«^