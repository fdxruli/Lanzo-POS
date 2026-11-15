import {
  formatEcommerceDeliveryAddress,
  isEcommerceDeliveryAddressRecord,
  normalizeEcommerceDeliveryAddress
} from '../../utils/ecommerceDeliveryAddress';
import Big from 'big.js';

const ATTEMPT_VERSION = 1;
const MAX_IDEMPOTENCY_KEY_LENGTH = 160;
const CONFIGURATION_REVISION_PATTERN = /^[a-f0-9]{64}$/;

export class EcommerceCheckoutIdempotencyError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'EcommerceCheckoutIdempotencyError';
    this.code = code;
    this.cause = cause;
  }
}

const asText = (value, maxLength = Number.POSITIVE_INFINITY) => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);
const asArray = (value) => (Array.isArray(value) ? value : []);
const uniqueSorted = (values) => Array.from(new Set(values.filter(Boolean)))
  .sort((left, right) => left.localeCompare(right));
const normalizeConfigurationRevision = (value) => {
  const revision = asText(value, 64).toLowerCase();
  return CONFIGURATION_REVISION_PATTERN.test(revision) ? revision : '';
};
const normalizeSelections = (selections) => asArray(selections)
  .map((selection) => ({
    groupId: asText(selection?.groupId, 80),
    optionIds: uniqueSorted(asArray(selection?.optionIds)
      .map((optionId) => asText(optionId, 80)))
  }))
  .filter((selection) => selection.groupId)
  .sort((left, right) => left.groupId.localeCompare(right.groupId));
const normalizeAcceptedMoney = (value) => {
  try {
    return new Big(value ?? 0).round(2).toFixed(2);
  } catch {
    return '0.00';
  }
};
const normalizeAcceptedPricing = (pricing) => {
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) return null;
  return {
    pricingMode: pricing.pricingMode === 'wholesale' ? 'wholesale' : 'standard',
    baseUnitPrice: normalizeAcceptedMoney(pricing.baseUnitPrice),
    wholesaleBaseUnitPrice: pricing.wholesaleBaseUnitPrice === null
      || pricing.wholesaleBaseUnitPrice === undefined
      ? null
      : normalizeAcceptedMoney(pricing.wholesaleBaseUnitPrice),
    appliedUnitPrice: normalizeAcceptedMoney(pricing.appliedUnitPrice),
    wholesaleTierRef: asText(pricing.wholesaleTierRef, 160) || null,
    wholesaleMinQuantity: pricing.wholesaleMinQuantity !== null
      && pricing.wholesaleMinQuantity !== undefined
      && Number.isInteger(Number(pricing.wholesaleMinQuantity))
      ? Number(pricing.wholesaleMinQuantity)
      : null,
    variantAdjustment: normalizeAcceptedMoney(pricing.variantAdjustment),
    optionsAdjustment: normalizeAcceptedMoney(pricing.optionsAdjustment),
    lineTotal: normalizeAcceptedMoney(pricing.lineTotal)
  };
};

export function getCheckoutAttemptStorageKey(slug) {
  return `lanzo:ecommerce:checkout-attempt:${asText(slug).toLowerCase() || 'unknown'}:v1`;
}

export function normalizeCheckoutPayload({ slug, customer, items }) {
  const fulfillmentMethod = asText(customer?.fulfillmentMethod, 20).toLowerCase();
  const hasStructuredAddress = Object.prototype.hasOwnProperty.call(customer || {}, 'deliveryAddress');
  const deliveryAddress = fulfillmentMethod === 'delivery' && hasStructuredAddress
    ? (isEcommerceDeliveryAddressRecord(customer.deliveryAddress)
      ? normalizeEcommerceDeliveryAddress(customer.deliveryAddress)
      : null)
    : null;
  const normalizedItems = asArray(items)
    .map((item) => {
      const productId = asText(item?.productId || item?.product?.id, 80);
      const quantity = Number(item?.quantity);
      const variantId = asText(item?.variantId, 80);
      const selections = normalizeSelections(item?.selections);
      const configurationRevision = normalizeConfigurationRevision(item?.configurationRevision);
      const acceptedPricing = normalizeAcceptedPricing(item?.acceptedPricing);
      const configured = Boolean(variantId || selections.length || configurationRevision);
      const normalized = configured ? {
        productId,
        quantity,
        variantId: variantId || null,
        selections,
        configurationVersion: Math.max(1, Math.floor(Number(item?.configurationVersion) || 1)),
        configurationRevision
      } : { productId, quantity };
      return acceptedPricing ? { ...normalized, acceptedPricing } : normalized;
    })
    .sort((left, right) => (
      left.productId.localeCompare(right.productId)
      || String(left.variantId || '').localeCompare(String(right.variantId || ''))
      || JSON.stringify(left.selections || []).localeCompare(JSON.stringify(right.selections || []))
      || String(left.configurationRevision || '').localeCompare(String(right.configurationRevision || ''))
      || left.quantity - right.quantity
    ));

  return {
    slug: asText(slug, 160).toLowerCase(),
    customer: {
      name: asText(customer?.name, 120),
      phone: asText(customer?.phone, 40),
      address: fulfillmentMethod === 'delivery'
        ? deliveryAddress
          ? formatEcommerceDeliveryAddress(deliveryAddress)
          : asText(customer?.address, 500)
        : '',
      notes: asText(customer?.notes, 1000),
      fulfillmentMethod,
      ...(fulfillmentMethod === 'delivery' && hasStructuredAddress
        ? { deliveryAddress }
        : {})
    },
    items: normalizedItems
  };
}

function getCrypto(cryptoImpl = globalThis.crypto) {
  if (
    !cryptoImpl
    || typeof cryptoImpl.getRandomValues !== 'function'
    || !cryptoImpl.subtle
    || typeof cryptoImpl.subtle.digest !== 'function'
  ) {
    throw new EcommerceCheckoutIdempotencyError(
      'ECOMMERCE_SECURE_RANDOM_UNAVAILABLE',
      'Este navegador no permite enviar el pedido de forma segura.'
    );
  }
  return cryptoImpl;
}

function bytesToUuid(bytes) {
  const copy = new Uint8Array(bytes);
  copy[6] = (copy[6] & 0x0f) | 0x40;
  copy[8] = (copy[8] & 0x3f) | 0x80;
  const hex = Array.from(copy, (value) => value.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}

export function createCheckoutIdempotencyKey(cryptoImpl = globalThis.crypto) {
  const cryptoApi = getCrypto(cryptoImpl);
  const uuid = typeof cryptoApi.randomUUID === 'function'
    ? cryptoApi.randomUUID()
    : bytesToUuid(cryptoApi.getRandomValues(new Uint8Array(16)));
  const key = `web-${uuid}`;
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new EcommerceCheckoutIdempotencyError(
      'ECOMMERCE_IDEMPOTENCY_KEY_REQUIRED',
      'No se pudo preparar el envío seguro del pedido.'
    );
  }
  return key;
}

export async function hashCheckoutPayload(payload, cryptoImpl = globalThis.crypto) {
  const cryptoApi = getCrypto(cryptoImpl);
  const normalized = normalizeCheckoutPayload(payload);
  const encoded = new TextEncoder().encode(JSON.stringify(normalized));
  const digest = await cryptoApi.subtle.digest('SHA-256', encoded);
  return Array.from(
    new Uint8Array(digest),
    (value) => value.toString(16).padStart(2, '0')
  ).join('');
}

function readAttempt(storage, storageKey) {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed?.version !== ATTEMPT_VERSION
      || typeof parsed.idempotencyKey !== 'string'
      || !parsed.idempotencyKey.startsWith('web-')
      || parsed.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
      || typeof parsed.payloadHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(parsed.payloadHash)
      || typeof parsed.createdAt !== 'string'
      || (parsed.status !== undefined && !['pending', 'ambiguous'].includes(parsed.status))
      || (parsed.acceptedItems !== undefined && !Array.isArray(parsed.acceptedItems))
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAttempt(storage, storageKey, attempt) {
  try {
    storage.setItem(storageKey, JSON.stringify(attempt));
  } catch (error) {
    throw new EcommerceCheckoutIdempotencyError(
      'ECOMMERCE_CHECKOUT_STORAGE_UNAVAILABLE',
      'No se pudo conservar el intento seguro del pedido en esta sesión.',
      error
    );
  }
}

export async function getOrCreateCheckoutAttempt(slug, payload, {
  storage = globalThis.sessionStorage,
  cryptoImpl = globalThis.crypto,
  now = new Date()
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new EcommerceCheckoutIdempotencyError(
      'ECOMMERCE_CHECKOUT_STORAGE_UNAVAILABLE',
      'No se pudo conservar el intento seguro del pedido en esta sesión.'
    );
  }

  const normalizedPayload = normalizeCheckoutPayload({ ...payload, slug });
  const payloadHash = await hashCheckoutPayload(normalizedPayload, cryptoImpl);
  const storageKey = getCheckoutAttemptStorageKey(slug);
  const existing = readAttempt(storage, storageKey);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);

  if (existing && existing.payloadHash === payloadHash) {
    return {
      idempotencyKey: existing.idempotencyKey,
      payloadHash,
      createdAt: existing.createdAt,
      reused: true
    };
  }

  if (existing) {
    throw new EcommerceCheckoutIdempotencyError(
      'ECOMMERCE_CHECKOUT_RESULT_UNCERTAIN',
      'El envío anterior todavía puede haberse registrado. Reintenta el mismo pedido antes de cambiarlo.'
    );
  }

  const attempt = {
    version: ATTEMPT_VERSION,
    idempotencyKey: createCheckoutIdempotencyKey(cryptoImpl),
    payloadHash,
    createdAt: new Date(nowMs).toISOString(),
    status: 'pending',
    acceptedItems: normalizedPayload.items
  };
  writeAttempt(storage, storageKey, attempt);

  return {
    idempotencyKey: attempt.idempotencyKey,
    payloadHash,
    createdAt: attempt.createdAt,
    reused: false
  };
}

export function getStoredCheckoutAttempt(slug, {
  storage = globalThis.sessionStorage
} = {}) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  return readAttempt(storage, getCheckoutAttemptStorageKey(slug));
}

export function markCheckoutAttemptAmbiguous(slug, expectedIdempotencyKey = '', {
  storage = globalThis.sessionStorage
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return false;
  }
  const storageKey = getCheckoutAttemptStorageKey(slug);
  const current = readAttempt(storage, storageKey);
  if (!current || (expectedIdempotencyKey && current.idempotencyKey !== expectedIdempotencyKey)) {
    return false;
  }
  try {
    writeAttempt(storage, storageKey, { ...current, status: 'ambiguous' });
    return true;
  } catch {
    return false;
  }
}

export function clearCheckoutAttempt(slug, expectedIdempotencyKey = '', {
  storage = globalThis.sessionStorage
} = {}) {
  if (!storage || typeof storage.removeItem !== 'function') return false;
  const storageKey = getCheckoutAttemptStorageKey(slug);

  try {
    if (expectedIdempotencyKey) {
      const current = readAttempt(storage, storageKey);
      if (current?.idempotencyKey !== expectedIdempotencyKey) return false;
    }
    storage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

export function isAmbiguousCheckoutError(error) {
  return [
    'ECOMMERCE_PUBLIC_TIMEOUT',
    'ECOMMERCE_PUBLIC_NETWORK_ERROR',
    'ECOMMERCE_ORDER_CREATE_FAILED',
    'ECOMMERCE_CHECKOUT_RESULT_UNCERTAIN',
    'ECOMMERCE_IDEMPOTENCY_CONFLICT',
    'IDEMPOTENCY_CONFLICT',
    'ORDER_ALREADY_PROCESSING'
  ].includes(error?.code);
}
