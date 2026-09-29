import { getCartLineId } from '../../utils/cartLineIdentity';
import {
  getTenantStorageItem,
  getTenantStorageState,
  removeTenantStorageItem,
  setTenantStorageItem
} from '../tenant/tenantScopedStorage';
import { normalizeStock } from '../db/utils';
import { RESTAURANT_SPLIT_INTENTS } from './splitOrderContract';

export const RESTAURANT_SPLIT_DRAFT_VERSION = 2;
export const RESTAURANT_SPLIT_DRAFT_STEPS = Object.freeze(['people', 'items', 'payment', 'review']);
const RESTAURANT_SPLIT_SNAPSHOT_VERSION = 1;
const MAX_GUESTS = 8;
const MIN_GUESTS = 2;
const MAX_GUEST_NAME_LENGTH = 40;

const splitDraftKey = (orderId, version = RESTAURANT_SPLIT_DRAFT_VERSION) => (
  `restaurant_split_draft:v${version}:${encodeURIComponent(String(orderId || ''))}`
);

const normalizeSplitIntent = (value) => Object.values(RESTAURANT_SPLIT_INTENTS).includes(value)
  ? value
  : null;

const stableSerialize = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value === undefined) return 'null';
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
};

const finiteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? (Object.is(parsed, -0) ? 0 : parsed) : null;
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const itemSnapshot = (item = {}, index = 0) => ({
  lineId: String(getCartLineId(item, index) ?? ''),
  linePosition: index,
  productId: firstDefined(item.productId, item.product_id, item.parentId, item.parent_id, null),
  name: String(item.name || ''),
  quantity: finiteNumber(firstDefined(item.quantity, item.qty, 0)),
  saleType: String(item.saleType || item.sale_type || ''),
  unitPrice: finiteNumber(firstDefined(item.price, item.unitPrice, item.unit_price, 0)),
  lineTotal: finiteNumber(firstDefined(item.total, item.lineTotal, item.line_total, null)),
  discount: firstDefined(item.discount, item.lineDiscount, item.line_discount, item.discountAmount, item.discount_amount, null),
  batchId: firstDefined(item.batchId, item.batch_id, null),
  variantId: firstDefined(item.variantId, item.variant_id, null),
  modifiers: firstDefined(item.selectedModifiers, item.selected_modifiers, item.modifiers, null),
  notes: firstDefined(item.notes, item.kitchenNotes, item.kitchen_notes, item.specifications, item.especificaciones, null)
});

/** A deterministic commercial snapshot; kitchen-only status fields are intentionally excluded. */
export const buildRestaurantSplitOrderSnapshot = ({ order = [], total = 0, saleDiscount = null } = {}) => stableSerialize({
  version: RESTAURANT_SPLIT_SNAPSHOT_VERSION,
  total: finiteNumber(total),
  saleDiscount,
  lines: (Array.isArray(order) ? order : []).map(itemSnapshot)
});

const validQuantity = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && Math.abs(parsed - normalizeStock(parsed)) < 1e-8;
};

const validateDraftAllocations = (allocations, order, guestCount) => {
  if (!Array.isArray(allocations) || allocations.length !== order.length) return false;
  return allocations.every((allocation, index) => {
    const ticketQuantities = allocation?.ticketQuantities;
    if (!validQuantity(allocation?.poolQuantity) || !Array.isArray(ticketQuantities) || ticketQuantities.length !== guestCount) {
      return false;
    }
    if (!ticketQuantities.every(validQuantity)) return false;
    const expected = normalizeStock(Number(order[index]?.quantity || 0));
    const isUnitItem = order[index]?.saleType === 'unit' || !order[index]?.saleType;
    if (isUnitItem && ![allocation.poolQuantity, ...ticketQuantities].every((quantity) => Number.isInteger(Number(quantity)))) {
      return false;
    }
    const actual = normalizeStock(Number(allocation.poolQuantity) + ticketQuantities.reduce((sum, quantity) => sum + Number(quantity), 0));
    return Math.abs(actual - expected) < 1e-8;
  });
};

const normalizeGuests = (guests) => {
  if (!Array.isArray(guests) || guests.length < MIN_GUESTS || guests.length > MAX_GUESTS) return null;
  const ids = new Set();
  const normalized = [];
  for (const [index, guest] of guests.entries()) {
    const id = String(guest?.id || '');
    const displayName = typeof guest?.displayName === 'string' ? guest.displayName.trim() : '';
    if (!/^T[1-8]$/.test(id) || ids.has(id) || displayName.length > MAX_GUEST_NAME_LENGTH) return null;
    ids.add(id);
    normalized.push({ id, displayName: displayName.slice(0, MAX_GUEST_NAME_LENGTH), position: index + 1 });
  }
  return normalized;
};

const normalizeDraftCustomAmounts = (amounts, guestCount) => {
  if (!Array.isArray(amounts) || amounts.length !== guestCount) return null;
  if (!amounts.every((amount) => Number.isSafeInteger(amount) && amount >= 0)) return null;
  return [...amounts];
};

const readStoredDraft = (key) => {
  const raw = getTenantStorageItem(key);
  if (!raw) return { status: 'missing' };
  try {
    return { status: 'found', draft: JSON.parse(raw) };
  } catch {
    removeTenantStorageItem(key);
    return { status: 'invalid' };
  }
};

export const readRestaurantSplitDraft = ({ orderId, order = [], orderSnapshot } = {}) => {
  if (!orderId || !getTenantStorageState().ready) return { status: 'unavailable' };
  const currentKey = splitDraftKey(orderId);
  const legacyKey = splitDraftKey(orderId, 1);
  const currentStored = readStoredDraft(currentKey);
  const legacyStored = currentStored.status === 'missing' ? readStoredDraft(legacyKey) : { status: 'missing' };
  const stored = currentStored.status !== 'missing' ? currentStored : legacyStored;
  if (stored.status === 'missing') return { status: 'missing' };
  if (stored.status === 'invalid') return { status: 'invalid' };
  const draft = stored.draft;
  const storageKey = stored === legacyStored ? legacyKey : currentKey;
  const version = Number(draft?.version);
  const splitIntent = version === 1
    ? RESTAURANT_SPLIT_INTENTS.BY_ITEMS
    : normalizeSplitIntent(draft?.splitIntent);

  if (
    ![1, RESTAURANT_SPLIT_DRAFT_VERSION].includes(version)
    || String(draft?.orderId || '') !== String(orderId)
    || draft?.orderSnapshot !== orderSnapshot
  ) {
    removeTenantStorageItem(storageKey);
    return { status: draft?.orderSnapshot && draft.orderSnapshot !== orderSnapshot ? 'stale' : 'invalid' };
  }

  const guests = normalizeGuests(draft.guests);
  const customAmountsCents = version === 1 || splitIntent !== RESTAURANT_SPLIT_INTENTS.CUSTOM_PAYMENT
    ? []
    : normalizeDraftCustomAmounts(draft.customAmountsCents, guests?.length || 0);
  if (
    !guests
    || !splitIntent
    || !RESTAURANT_SPLIT_DRAFT_STEPS.includes(draft.step)
    || !validateDraftAllocations(draft.allocations, order, guests.length)
    || customAmountsCents === null
  ) {
    removeTenantStorageItem(storageKey);
    return { status: 'invalid' };
  }

  return {
    status: 'restored',
    guests,
    splitIntent,
    customAmountsCents,
    allocations: draft.allocations.map((allocation) => ({
      poolQuantity: normalizeStock(Number(allocation.poolQuantity)),
      ticketQuantities: allocation.ticketQuantities.map((quantity) => normalizeStock(Number(quantity)))
    })),
    step: draft.step
  };
};

export const saveRestaurantSplitDraft = ({
  orderId,
  order = [],
  orderSnapshot,
  guests,
  allocations,
  step,
  splitIntent = RESTAURANT_SPLIT_INTENTS.BY_ITEMS,
  customAmountsCents = []
} = {}) => {
  if (!orderId || !getTenantStorageState().ready) return false;
  const normalizedGuests = normalizeGuests(guests);
  const normalizedIntent = normalizeSplitIntent(splitIntent);
  const normalizedCustomAmounts = normalizedIntent === RESTAURANT_SPLIT_INTENTS.CUSTOM_PAYMENT
    ? normalizeDraftCustomAmounts(customAmountsCents, normalizedGuests?.length || 0)
    : [];
  if (
    !normalizedGuests
    || !normalizedIntent
    || !RESTAURANT_SPLIT_DRAFT_STEPS.includes(step)
    || !validateDraftAllocations(allocations, order, normalizedGuests.length)
    || normalizedCustomAmounts === null
  ) return false;

  const key = splitDraftKey(orderId);
  const serialized = JSON.stringify({
    version: RESTAURANT_SPLIT_DRAFT_VERSION,
    orderId: String(orderId),
    orderSnapshot,
    guests: normalizedGuests,
    splitIntent: normalizedIntent,
    customAmountsCents: normalizedCustomAmounts,
    allocations: allocations.map((allocation) => ({
      poolQuantity: normalizeStock(Number(allocation.poolQuantity)),
      ticketQuantities: allocation.ticketQuantities.map((quantity) => normalizeStock(Number(quantity)))
    })),
    step
  });

  setTenantStorageItem(key, serialized);
  const stored = getTenantStorageItem(key) === serialized;
  if (stored) removeTenantStorageItem(splitDraftKey(orderId, 1));
  return stored;
};

export const clearRestaurantSplitDraft = (orderId) => {
  if (!orderId || !getTenantStorageState().ready) return false;
  const key = splitDraftKey(orderId);
  removeTenantStorageItem(key);
  removeTenantStorageItem(splitDraftKey(orderId, 1));
  return getTenantStorageItem(key) === null && getTenantStorageItem(splitDraftKey(orderId, 1)) === null;
};

export const getRestaurantSplitDraftStorageKey = splitDraftKey;
