import { db, STORES } from './dexie';
import {
    handleDexieError,
    DatabaseError,
    DB_ERROR_CODES,
    normalizeStock,
    getAvailableStock,
    getCommittedStock,
    getLowStockAlertStatus
} from './utils';
import { generateID } from '../utils';
import { normalizeCustomerDebtCents } from './customerDebtIndex';
import { Money } from '../../utils/moneyMath';
import { SALE_STATUS } from '../sales/financialStats';
import { getExplicitSalePaymentRows, isRestaurantSplitCashPayment } from '../sales/paymentMethodContract';
import Logger from '../Logger';

const LOCAL_STATION_KEY_PREFIX = 'local:device:';
const isLocalStationKey = (value) => (
    typeof value === 'string' && value.trim().startsWith(LOCAL_STATION_KEY_PREFIX)
);
const isCanonicalCashStation = (value) => {
    const normalized = String(value || '').trim();
    return Boolean(normalized && !isLocalStationKey(normalized));
};
const areCashStationsEquivalent = (left, right) => {
    const normalizedLeft = String(left || '').trim();
    const normalizedRight = String(right || '').trim();
    return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const getRealProductId = (item) => item?.parentId || item?.id;
const isCommittedSaleItem = (item) => item?.inventoryReservation?.source === 'table';
const hasBatchDeductions = (item) => Array.isArray(item?.batchesUsed) && item.batchesUsed.length > 0;
const saleHasCashComponent = (sale = {}) => {
    const paymentMethod = String(sale.¶»§q«^