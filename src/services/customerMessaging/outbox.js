import { useAppStore } from '../../store/useAppStore';
import {
  getTenantStorageItem,
  setTenantStorageItem
} from '../tenant/tenantScopedStorage';
import { selectDisplayReference } from './displayReference';
import {
  downloadCustomerMessageImage,
  shareCustomerMessageImage
} from './imageShare';
import { renderCustomerMessageImage } from './imageRenderer';
import { normalizeMexicanPhone } from './normalizers';
import { resolveCustomerMessageTemplate } from './templateRepository';

export const CUSTOMER_MESSAGE_OUTBOX_SCHEMA_VERSION = 1;
export const CUSTOMER_MESSAGE_OUTBOX_STORAGE_KEY = 'customer-message-outbox-v1';

export const CUSTOMER_MESSAGE_OUTBOX_STATUSES = Object.freeze([
  'preparado',
  'compartido',
  'descarga_generada',
  'cancelado_por_usuario',
  'error',
  'reintento_pendiente'
]);

export const CUSTOMER_MESSAGE_OUTBOX_STATUS_LABELS = Object.freeze({
  preparado: 'Preparado',
  compartido: 'Compartido',
  descarga_generada: 'Descarga generada',
  cancelado_por_usuario: 'Cancelado por el usuario',
  error: 'Error',
  reintento_pendiente: 'Reintento pendiente'
});

export const CUSTOMER_MESSAGE_OUTBOX_DEFAULTS = Object.freeze({
  maxAttempts: 3,
  retentionMs: 30 * 24 * 60 * 60 * 1000,
  maxRecords: 120,
  backoffMs: Object.freeze([30_000, 120_000, 600_000])
});

const VALID_STATUSES = new Set(CUSTOMER_MESSAGE_OUTBOX_STATUSES);
const RETRYABLE_CODES = new Set([
  'IMAGE_SHARE_FAILED',
  'IMAGE_DOWNLOAD_FAILED',
  'IMAGE_PNG_EMPTY',
  'IMAGE_RENDER_FAILED',
  'OUTBOX_PERSISTENCE_FAILED'
]);
const PERMANENT_CODES = new Set([
  'IMAGE_RESULT_INVALID',
  'MESSAGE_PAYLOAD_INVALID',
  'MESSAGE_EVENT_UNSUPPORTED',
  'IMAGE_CANVAS_UNAVAILABLE',
  'IMAGE_PNG_EXPORT_UNAVAILABLE',
  'IMAGE_DOWNLOAD_UNSUPPORTED'
]);
const SANITIZED_ERROR_CODES = new Set([
  ...RETRYABLE_CODES,
  ...PERMANENT_CODES,
  'IMAGE_SHARE_CANCELLED',
  'WEB_SHARE_UNAVAILABLE_OR_INCOMPATIBLE',
  'CUSTOMER_PHONE_MISSING',
  'CUSTOMER_PHONE_INVALID',
  'OUTBOX_RECORD_INVALID',
  'OUTBOX_STATUS_INVALID',
  'OUTBOX_TRANSITION_INVALID',
  'OUTBOX_MAX_ATTEMPTS_REACHED',
  'OUTBOX_STORAGE_UNAVAILABLE',
  'OUTBOX_PERSISTENCE_FAILED',
  'OUTBOX_RENDER_FAILED',
  'OUTBOX_SHARE_FAILED',
  'OUTBOX_DOWNLOAD_FAILED'
]);

const ACTION_IN_FLIGHT = new Map();
const PREPARE_IN_FLIGHT = new Map();

const nowIso = (now = Date.now()) => new Date(now).toISOString();

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
};

const stableStringify = (value) => JSON.stringify(stableValue(value));

const hashText = (value) => {
  const text = String(value || '');
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left ^= code;
    left = Math.imul(left, 0x01000193);
    right ^= code + index;
    right = Math.imul(right, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
};

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

const cleanScalar = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
};

const safeItems = (items) => (Array.isArray(items) ? items : []).map((item) => ({
  name: cleanScalar(item?.name) || 'Producto',
  quantity: cleanScalar(item?.quantity),
  price: cleanScalar(item?.price),
  total: cleanScalar(item?.total)
}));

const safeNotes = (notes) => (Array.isArray(notes) ? notes : []).map((note) => ({
  folio: cleanScalar(note?.folio),
  reference: cleanScalar(note?.reference),
  saleFolio: cleanScalar(note?.saleFolio ?? note?.sale_folio),
  saldoPendiente: cleanScalar(note?.saldoPendiente ?? note?.balanceDue ?? note?.currentOwed),
  balanceDue: cleanScalar(note?.balanceDue ?? note?.saldoPendiente ?? note?.currentOwed),
  currentOwed: cleanScalar(note?.currentOwed ?? note?.balanceDue ?? note?.saldoPendiente)
}));

/**
 * The renderer receives only presentation data. Technical ids remain usable
 * while deriving the idempotency hash, but they are deliberately absent from
 * this persisted/rendered snapshot.
 */
export const sanitizeCustomerMessageOutboxPayload = (payload = {}) => ({
  eventType: cleanScalar(payload.eventType),
  customer: {
    name: cleanScalar(payload.customer?.name)
  },
  business: {
    name: cleanScalar(payload.business?.name)
  },
  occurredAt: cleanScalar(payload.occurredAt),
  currency: cleanScalar(payload.currency) || 'MXN',
  reference: cleanScalar(selectDisplayReference(payload.reference, payload.sale, payload.payment, payload.layaway)),
  sale: {
    folio: cleanScalar(selectDisplayReference(payload.sale)),
    items: safeItems(payload.sale?.items),
    subtotal: cleanScalar(payload.sale?.subtotal),
    discount: cleanScalar(payload.sale?.discount),
    total: cleanScalar(payload.sale?.total),
    paymentMethod: cleanScalar(payload.sale?.paymentMethod),
    originalPaymentMethod: cleanScalar(payload.sale?.originalPaymentMethod),
    amountPaid: cleanScalar(payload.sale?.amountPaid),
    receivedAmount: cleanScalar(payload.sale?.receivedAmount),
    changeAmount: cleanScalar(payload.sale?.changeAmount),
    balanceDue: cleanScalar(payload.sale?.balanceDue),
    dueDate: cleanScalar(payload.sale?.dueDate),
    creditStatus: cleanScalar(payload.sale?.creditStatus),
    salesChannel: cleanScalar(payload.sale?.salesChannel),
    ecommerceOrderCode: cleanScalar(payload.sale?.ecommerceOrderCode),
    posFolio: cleanScalar(payload.sale?.posFolio)
  },
  payment: {
    reference: cleanScalar(selectDisplayReference(payload.payment)),
    occurredAt: cleanScalar(payload.payment?.occurredAt),
    method: cleanScalar(payload.payment?.method),
    originalMethod: cleanScalar(payload.payment?.originalMethod),
    previousBalance: cleanScalar(payload.payment?.previousBalance),
    amount: cleanScalar(payload.payment?.amount),
    newBalance: cleanScalar(payload.payment?.newBalance)
  },
  account: {
    cutoffAt: cleanScalar(payload.account?.cutoffAt),
    totalBalance: cleanScalar(payload.account?.totalBalance),
    totalPayments: cleanScalar(payload.account?.totalPayments),
    pendingNotes: safeNotes(payload.account?.pendingNotes),
    noteDetails: safeNotes(payload.account?.noteDetails)
  },
  layaway: {
    reference: cleanScalar(selectDisplayReference(payload.layaway)),
    items: safeItems(payload.layaway?.items),
    total: cleanScalar(payload.layaway?.total),
    initialPayment: cleanScalar(payload.layaway?.initialPayment),
    previousPaid: cleanScalar(payload.layaway?.previousPaid),
    paymentAmount: cleanScalar(payload.layaway?.paymentAmount),
    totalPaid: cleanScalar(payload.layaway?.totalPaid),
    balanceDue: cleanScalar(payload.layaway?.balanceDue),
    deadline: cleanScalar(payload.layaway?.deadline),
    status: cleanScalar(payload.layaway?.status),
    deliveryDate: cleanScalar(payload.layaway?.deliveryDate),
    saleFolio: cleanScalar(payload.layaway?.saleFolio)
  }
});

export const payloadContainsTechnicalIds = (value) => {
  if (Array.isArray(value)) return value.some(payloadContainsTechnicalIds);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => (
    /(^id$|Id$|_id$)/.test(key) || payloadContainsTechnicalIds(nested)
  ));
};

const operationIdentity = (payload = {}) => ({
  eventType: payload.eventType || null,
  occurredAt: payload.occurredAt || null,
  reference: selectDisplayReference(payload.reference, payload.sale, payload.payment, payload.layaway) || null,
  customerId: payload.customer?.id || payload.customerData?.id || null,
  saleId: payload.sale?.id || payload.financialData?.sale?.id || null,
  paymentId: payload.payment?.id || payload.financialData?.payment?.id || null,
  layawayId: payload.layaway?.id || payload.financialData?.layaway?.id || null,
  total: payload.sale?.total ?? payload.layaway?.total ?? null,
  amount: payload.payment?.amount ?? payload.layaway?.paymentAmount ?? null,
  balance: payload.payment?.newBalance ?? payload.account?.totalBalance ?? payload.layaway?.balanceDue ?? null
});

export const buildCustomerMessageOutboxIdempotencyKey = (payload = {}) => (
  `cm_${hashText(stableStringify(operationIdentity(payload)))}`
);

const featureEnabled = (licenseDetails = {}) => Boolean(
  licenseDetails?.features?.customerMessageTemplates
  || licenseDetails?.effective_features?.customerMessageTemplates
  || licenseDetails?.details?.features?.customerMessageTemplates
);

const resolvePlanContext = ({ licenseDetails = {}, actorType = null, templateSource = 'default' } = {}) => ({
  actorType: actorType || 'unknown',
  planCode: cleanScalar(
    licenseDetails?.effective_plan_code
    || licenseDetails?.plan_code
    || licenseDetails?.plan?.code
    || licenseDetails?.details?.plan_code
  ),
  customTemplatesEnabled: featureEnabled(licenseDetails),
  templateSource
});

const contactReadiness = (payload = {}) => {
  const phone = normalizeMexicanPhone(payload.customer?.phone);
  if (phone.status === 'missing') return { status: 'telefono_vacio', code: 'CUSTOMER_PHONE_MISSING' };
  if (phone.status === 'invalid') return { status: 'telefono_invalido', code: 'CUSTOMER_PHONE_INVALID' };
  return { status: 'telefono_valido', code: null };
};

const sanitizeErrorCode = (code, fallback) => {
  const normalized = String(code || '').trim().toUpperCase();
  return SANITIZED_ERROR_CODES.has(normalized) ? normalized : fallback;
};

const backoffForAttempt = (attemptCount, config) => {
  const list = Array.isArray(config.backoffMs) && config.backoffMs.length
    ? config.backoffMs
    : CUSTOMER_MESSAGE_OUTBOX_DEFAULTS.backoffMs;
  return list[Math.min(Math.max(attemptCount - 1, 0), list.length - 1)];
};

const emptyDocument = () => ({ schemaVersion: CUSTOMER_MESSAGE_OUTBOX_SCHEMA_VERSION, records: [] });

export const createCustomerMessageOutboxRepository = ({
  getItem = getTenantStorageItem,
  setItem = setTenantStorageItem,
  now = () => Date.now(),
  config = {}
} = {}) => {
  const effectiveConfig = { ...CUSTOMER_MESSAGE_OUTBOX_DEFAULTS, ...config };

  const readDocument = () => {
    let parsed = emptyDocument();
    try {
      const raw = getItem(CUSTOMER_MESSAGE_OUTBOX_STORAGE_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch {
      return { ...emptyDocument(), readError: 'OUTBOX_STORAGE_UNAVAILABLE' };
    }
    if (parsed?.schemaVersion !== CUSTOMER_MESSAGE_OUTBOX_SCHEMA_VERSION || !Array.isArray(parsed.records)) {
      return emptyDocument();
    }
    const cutoff = now() - effectiveConfig.retentionMs;
    const records = parsed.records
      .filter((record) => Date.parse(record?.updatedAt || record?.createdAt || '') >= cutoff)
      .slice(0, effectiveConfig.maxRecords);
    return { schemaVersion: CUSTOMER_MESSAGE_OUTBOX_SCHEMA_VERSION, records };
  };

  const persistDocument = (document) => {
    const serialized = JSON.stringify(document);
    try {
      setItem(CUSTOMER_MESSAGE_OUTBOX_STORAGE_KEY, serialized);
      return getItem(CUSTOMER_MESSAGE_OUTBOX_STORAGE_KEY) === serialized;
    } catch {
      return false;
    }
  };

  return Object.freeze({
    config: effectiveConfig,
    list() {
      return clone(readDocument().records || []);
    },
    get(idempotencyKey) {
      return clone((readDocument().records || []).find((record) => record.idempotencyKey === idempotencyKey) || null);
    },
    put(record) {
      if (!record?.idempotencyKey || !VALID_STATUSES.has(record.status)) {
        return { ok: false, code: 'OUTBOX_RECORD_INVALID' };
      }
      const document = readDocument();
      const records = (document.records || []).filter((item) => item.idempotencyKey !== record.idempotencyKey);
      records.unshift(clone(record));
      const next = {
        schemaVersion: CUSTOMER_MESSAGE_OUTBOX_SCHEMA_VERSION,
        records: records.slice(0, effectiveConfig.maxRecords)
      };
      if (!persistDocument(next)) return { ok: false, code: 'OUTBOX_PERSISTENCE_FAILED' };
      return { ok: true, record: clone(record) };
    },
    prune() {
      const document = readDocument();
      const next = { schemaVersion: CUSTOMER_MESSAGE_OUTBOX_SCHEMA_VERSION, records: document.records || [] };
      return persistDocument(next)
        ? { ok: true, count: next.records.length }
        : { ok: false, code: 'OUTBOX_PERSISTENCE_FAILED' };
    }
  });
};

export const customerMessageOutboxRepository = createCustomerMessageOutboxRepository();

const transitionMatrix = Object.freeze({
  preparado: new Set(['compartido', 'descarga_generada', 'cancelado_por_usuario', 'error', 'reintento_pendiente']),
  compartido: new Set(['compartido', 'descarga_generada', 'cancelado_por_usuario', 'error', 'reintento_pendiente']),
  descarga_generada: new Set(['compartido', 'descarga_generada', 'cancelado_por_usuario', 'error', 'reintento_pendiente']),
  cancelado_por_usuario: new Set(['compartido', 'descarga_generada', 'cancelado_por_usuario', 'error', 'reintento_pendiente']),
  error: new Set(['compartido', 'descarga_generada', 'cancelado_por_usuario', 'error', 'reintento_pendiente']),
  reintento_pendiente: new Set(['compartido', 'descarga_generada', 'cancelado_por_usuario', 'error', 'reintento_pendiente'])
});

export const canTransitionCustomerMessageOutbox = (from, to) => (
  VALID_STATUSES.has(from) && VALID_STATUSES.has(to) && transitionMatrix[from]?.has(to) === true
);

const persistTransition = ({ repository, record, nextStatus, patch = {} }) => {
  if (!canTransitionCustomerMessageOutbox(record.status, nextStatus)) {
    return { ok: false, code: 'OUTBOX_TRANSITION_INVALID', record };
  }
  const next = { ...record, ...patch, status: nextStatus };
  const persisted = repository.put(next);
  return persisted.ok ? persisted : { ...persisted, record: next };
};

export const prepareCustomerMessageOutbox = async ({
  payload,
  licenseDetails = useAppStore.getState().licenseDetails,
  actorType = useAppStore.getState().currentDeviceRole,
  actorHandle = null,
  resolvedTemplate = null,
  repository = customerMessageOutboxRepository,
  now = () => Date.now()
} = {}) => {
  if (!payload?.eventType) return { ok: false, code: 'MESSAGE_PAYLOAD_INVALID' };

  const idempotencyKey = buildCustomerMessageOutboxIdempotencyKey(payload);
  const existing = repository.get(idempotencyKey);
  if (existing) return { ok: true, record: existing, duplicate: true };

  if (PREPARE_IN_FLIGHT.has(idempotencyKey)) return PREPARE_IN_FLIGHT.get(idempotencyKey);

  const promise = (async () => {
    const safePayload = sanitizeCustomerMessageOutboxPayload(payload);
    if (payloadContainsTechnicalIds(safePayload)) return { ok: false, code: 'OUTBOX_RECORD_INVALID' };

    const templateResolution = resolvedTemplate || await resolveCustomerMessageTemplate({
      eventType: payload.eventType,
      licenseDetails,
      actorHandle
    });
    const timestamp = now();
    const templateSource = templateResolution?.source === 'custom' && templateResolution?.template
      ? 'custom'
      : 'default';
    const record = {
      schemaVersion: CUSTOMER_MESSAGE_OUTBOX_SCHEMA_VERSION,
      idempotencyKey,
      eventType: payload.eventType,
      messageType: payload.eventType,
      channel: 'image',
      humanReference: selectDisplayReference(safePayload.reference, safePayload.sale, safePayload.payment, safePayload.layaway) || null,
      payloadSnapshot: safePayload,
      templateSnapshot: templateSource === 'custom' ? clone(templateResolution.template) : null,
      templateRevision: templateSource === 'custom' ? Number(templateResolution.revision || 0) : 0,
      templateSource,
      planContext: resolvePlanContext({ licenseDetails, actorType, templateSource }),
      contactReadiness: contactReadiness(payload),
      status: 'preparado',
      attemptCount: 0,
      shareAttemptCount: 0,
      retryPolicy: {
        maxAttempts: Number(repository.config.maxAttempts || CUSTOMER_MESSAGE_OUTBOX_DEFAULTS.maxAttempts)
      },
      lastErrorCode: null,
      nextRetryAt: null,
      lastAttemptAt: null,
      createdAt: nowIso(timestamp),
      updatedAt: nowIso(timestamp),
      expiresAt: nowIso(timestamp + repository.config.retentionMs)
    };

    const persisted = repository.put(record);
    return persisted.ok
      ? { ok: true, record: persisted.record, duplicate: false }
      : { ok: false, code: persisted.code || 'OUTBOX_PERSISTENCE_FAILED', record };
  })().finally(() => PREPARE_IN_FLIGHT.delete(idempotencyKey));

  PREPARE_IN_FLIGHT.set(idempotencyKey, promise);
  return promise;
};

const classifyFailure = (code) => {
  const safeCode = sanitizeErrorCode(code, 'OUTBOX_SHARE_FAILED');
  return {
    code: safeCode,
    retryable: RETRYABLE_CODES.has(safeCode),
    permanent: PERMANENT_CODES.has(safeCode)
  };
};

const performOutboxAction = async ({
  record,
  repository,
  action,
  render = renderCustomerMessageImage,
  share = shareCustomerMessageImage,
  download = downloadCustomerMessageImage,
  now = () => Date.now()
}) => {
  if (!record?.idempotencyKey || !VALID_STATUSES.has(record.status)) {
    return { ok: false, code: 'OUTBOX_RECORD_INVALID', record };
  }

  const lockKey = `${action}:${record.idempotencyKey}`;
  if (ACTION_IN_FLIGHT.has(lockKey)) return ACTION_IN_FLIGHT.get(lockKey);

  const promise = (async () => {
    const current = repository.get(record.idempotencyKey) || record;
    const maxAttempts = Number(
      current.retryPolicy?.maxAttempts
      || repository.config.maxAttempts
      || CUSTOMER_MESSAGE_OUTBOX_DEFAULTS.maxAttempts
    );
    const currentShareAttempts = Number(current.shareAttemptCount || 0);
    if (action === 'share' && currentShareAttempts >= maxAttempts) {
      const exhausted = persistTransition({
        repository,
        record: current,
        nextStatus: 'error',
        patch: {
          lastErrorCode: 'OUTBOX_MAX_ATTEMPTS_REACHED',
          nextRetryAt: null,
          updatedAt: nowIso(now())
        }
      });
      return { ok: false, code: 'OUTBOX_MAX_ATTEMPTS_REACHED', record: exhausted.record || current };
    }

    const attemptedAt = now();
    const attemptCount = Number(current.attemptCount || 0) + 1;
    const shareAttemptCount = currentShareAttempts + (action === 'share' ? 1 : 0);
    const imageResult = await render(current.payloadSnapshot, { template: current.templateSnapshot });
    if (!imageResult?.ok) {
      const failure = classifyFailure(imageResult?.code || 'OUTBOX_RENDER_FAILED');
      const nextStatus = failure.retryable && attemptCount < maxAttempts ? 'reintento_pendiente' : 'error';
      const transitioned = persistTransition({
        repository,
        record: current,
        nextStatus,
        patch: {
          attemptCount,
          shareAttemptCount,
          lastAttemptAt: nowIso(attemptedAt),
          updatedAt: nowIso(attemptedAt),
          lastErrorCode: failure.code,
          nextRetryAt: nextStatus === 'reintento_pendiente'
            ? nowIso(attemptedAt + backoffForAttempt(action === 'share' ? shareAttemptCount : attemptCount, repository.config))
            : null
        }
      });
      return { ok: false, code: failure.code, record: transitioned.record || current, imageResult };
    }

    const actionResult = action === 'download'
      ? download(imageResult)
      : await share(imageResult);

    let nextStatus = 'error';
    let lastErrorCode = null;
    let nextRetryAt = null;
    let ok = false;

    if (actionResult?.status === 'shared') {
      nextStatus = 'compartido';
      ok = true;
    } else if (actionResult?.status === 'downloaded') {
      nextStatus = 'descarga_generada';
      lastErrorCode = action === 'share' ? 'WEB_SHARE_UNAVAILABLE_OR_INCOMPATIBLE' : null;
      ok = true;
    } else if (actionResult?.status === 'cancelled') {
      nextStatus = 'cancelado_por_usuario';
      lastErrorCode = 'IMAGE_SHARE_CANCELLED';
    } else {
      const failure = classifyFailure(
        actionResult?.code
        || (action === 'download' ? 'OUTBOX_DOWNLOAD_FAILED' : 'OUTBOX_SHARE_FAILED')
      );
      nextStatus = failure.retryable && (action !== 'share' || shareAttemptCount < maxAttempts) ? 'reintento_pendiente' : 'error';
      lastErrorCode = failure.code;
      if (nextStatus === 'reintento_pendiente') {
        nextRetryAt = nowIso(attemptedAt + backoffForAttempt(action === 'share' ? shareAttemptCount : attemptCount, repository.config));
      }
    }

    const transitioned = persistTransition({
      repository,
      record: current,
      nextStatus,
      patch: {
        attemptCount,
        lastAttemptAt: nowIso(attemptedAt),
        updatedAt: nowIso(attemptedAt),
        lastErrorCode,
        nextRetryAt
      }
    });

    return {
      ok,
      code: lastErrorCode,
      record: transitioned.record || current,
      imageResult,
      actionResult,
      persistenceOk: transitioned.ok
    };
  })().finally(() => ACTION_IN_FLIGHT.delete(lockKey));

  ACTION_IN_FLIGHT.set(lockKey, promise);
  return promise;
};

export const shareCustomerMessageOutbox = async ({
  record,
  repository = customerMessageOutboxRepository,
  ...options
} = {}) => performOutboxAction({ record, repository, action: 'share', ...options });

export const downloadCustomerMessageOutbox = async ({
  record,
  repository = customerMessageOutboxRepository,
  ...options
} = {}) => performOutboxAction({ record, repository, action: 'download', ...options });

export const getCustomerMessageOutboxRecord = (
  idempotencyKey,
  repository = customerMessageOutboxRepository
) => repository.get(idempotencyKey);

export const listCustomerMessageOutbox = (
  repository = customerMessageOutboxRepository
) => repository.list();

export const customerMessageOutboxInternals = Object.freeze({
  classifyFailure,
  contactReadiness,
  hashText,
  operationIdentity,
  resolvePlanContext,
  sanitizeErrorCode,
  stableStringify
});
