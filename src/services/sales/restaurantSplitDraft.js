import { getCartLineId } from '../../utils/cartLineIdentity';
import {
  getTenantStorageItem,
  getTenantStorageState,
  removeTenantStorageItem,
  setTenantStorageItem
} from '../tenant/tenantScopedStorage';
import { normalizeStock } from '../db/utils';

export const RESTAURANT_SPLIT_DRAFT_VERSION = 1;
export const RESTAURANT_SPLIT_DRAFT_STEPS = Object.freeze(['people', 'items', 'payment', 'review']);
const MAX_GUESTS = 8;
const MIN_GUESTS = 2;
const MAX_GUEST_NAME_LENGTH = 40;

const splitDraftKey = (orderId) => (
  `restaurant_split_draft:v1:${encodeURIComponent(String(orderId || ''))}`
);

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
  version: RESTAURANT_SPLIT_DRAFT_VERSION,
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

export const readRestaurantSplitDraft = ({ orderId, order = [], orderSnapshot } = {}) => {
  if (!orderId || !getTenantStorageState().ready) return { status: 'unavailable' };
  const key = splitDraftKey(orderId);
  const raw = getTenantStorageItem(key);
  if (!raw) return { status: 'missing' };

  let draft;
  try {
    draft = JSON.parse(raw);
  } catch {
    removeTenantStorageItem(key);
    return { status: 'invalid' };
  }

  if (
    draft?.version !== RESTAURANT_SPLIT_DRAFT_VERSION
    || String(draft?.orderId || '') !== String(orderId)
    || draft?.orderSnapshot !== orderSnapshot
  ) {
    removeTenantStorageItem(key);
    return { status: draft?.orderSnapshot && draft.orderSnapshot !== orderSnapshot ? 'stale' : 'invalid' };
  }

  const guests = normalizeGuests(draft.guests);
  if (
    !guests
    || !RESTAURANT_SPLIT_DRAFT_STEPS.includes(draft.step)
    || !validateDraftAllocations(draft.allocations, order, guests.length)
  ) {
    removeTenantStorageItem(key);
    return { status: 'invalid' };
  }

  return {
    status: 'restored',
    guests,
    allocations: draft.allocations.map((allocation) => ({
      poolQuantity: normalizeStock(Number(allocation.poolQuantity)),
      ticketQuantities: allocation.ticketQuantities.map((quantity) => normalizeStock(Number(quantity)))
    })),
    step: draft.step
  };
};

export const saveRestaurantSplitDraft = ({ orderId, order = [], orderSnapshot, guests, allocations, step } = {}) => {
  if (!orderId || !getTenantStorageState().ready) return false;
  const normalizedGuests = normalizeGuests(guests);
  if (
    !normalizedGuests
    || !RESTAURANT_SPLIT_DRAFT_STEPS.includes(step)
    || !validateDraftAllocations(allocations, order, normalizedGuests.length)
  ) return false;

  const key = splitDraftKey(orderId);
  const serialized = JSON.stringify({
    version: RESTAURANT_SPLIT_DRAFT_VERSION,
    orderId: String(orderId),
    orderSnapshot,
    guests: normalizedGuests,
    allocations: allocations.map((allocation) => ({
      poolQuantity: normalizeStock(Number(allocation.poolQuantity)),
      ticketQuantities: allocation.ticketQuantities.map((quantity) => normalizeStock(Number(quantity)))
    })),
    step
  });

  setTenantStorageItem(key, serialized);
  return getTenantStorageItem(key) === serialized;
};

export const clearRestaurantSplitDraft = (orderId) => {
  if (!orderId || !getTenantStorageState().ready) return false;
  const key = splitDraftKey(orderId);
  removeTenantStorageItem(key);
  return getTenantStorageItem(key) === null;
};

export const getRestaurantSplitDraftStorageKey = splitDraftKey;
