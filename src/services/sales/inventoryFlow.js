import { getAvailableStock, getCommittedStock, normalizeStock } from '../db/utils';
import { withUnifiedTimestamp, parseDateStrict, isBatchExpiredForSale } from '../../utils/dateUtils';
import { getRecipeIngredientId } from '../../utils/ingredientConfiguration';

const TABLE_RESERVATION_SOURCE = 'table';
const EPSILON = 0.00001;

const getRealProductId = (item) => item?.parentId || item?.id;
const hasRecipe = (product) => Array.isArray(product?.recipe) && product.recipe.length > 0;
const shouldTrackInventory = (product) => Boolean(product?.trackStock) || hasRecipe(product);
const isTableReservation = (item) => item?.inventoryReservation?.source === TABLE_RESERVATION_SOURCE;

const getProductMap = async ({ itemsToProcess, allProducts = [], db, STORES }) => {
    const productMap = new Map((allProducts || []).map((product) => [product.id, product]));

    const orderProductIds = new Set(itemsToProcess.map((item) => getRealProductId(item)).filter(Boolean));
    const missingOrderIds = Array.from(orderProductIds).filter((id) => !productMap.has(id));

    if (missingOrderIds.length > 0) {
        const loadedProducts = await db.table(STORES.MENU).bulkGet(missingOrderIds);
        loadedProducts.filter(Boolean).forEach((product) => productMap.set(product.id, product));
    }

    const ingredientIds = new Set();
    itemsToProcess.forEach((item) => {
        const product = productMap.get(getRealProductId(item));
        if (!product) return;

        if (hasRecipe(product)) {
    ¶»§q«^