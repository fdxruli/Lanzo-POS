import { syncOutboxService } from './syncOutboxService';

export const CLOUD_SYNC_CONTRACT_VERSION = 2;
export const CLOUD_SYNC_CONTRACT_RPC = 'pos_fin01_sync_contract_v1';
export const CLOUD_SYNC_CAPABILITIES = Object.freeze([
  'historical_credit_preservation_v1',
  'customer_projection_safe_apply_v1'
]);

const PROJECTION_STATES = new Set([
  'KNOWN_ZERO',
  'KNOWN_POSITIVE',
  'HISTORICAL_PENDING',
  'CONFLICT',
  'NOT_INCLUDED'
]);

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hasText = (value) => typeof value === 'string' && value.trim() !== '';

const moneyToCents = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  const match = text.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0') || 0);
  if (!Number.isSafeInteger(cents)) return null;
  return match[1] === '-' ? -cents : cents;
};

const requireValidMoney = (value, code, { allowNegative = false } = {}) => {
  const cents = moneyToCents(value);
  if (cents === null || (!allowNegative && cents < 0)) throw new Error(code);
  return cents;
};

const validatePayloadCollections = (payload) => {
  for (const key of ['customers', 'ledger_entries', 'cash_movements', 'movements', 'cash_sessions']) {
    if (payload[key] !== undefined && !Array.isArray(payload[key])) {
      throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_PAYLOAD_COLLECTION');
    }
  }
  const assertUniqueIds = (rows, code) => {
    const ids = rows.map((row) => {
      if (!isRecord(row) || !hasText(row.id)) throw new Error(code);
      return row.id;
    });
    if (new Set(ids).size !== ids.length) throw new Error(code);
  };

  const ledgers = payload.ledger_entries || [];
  assertUniqueIds(ledgers, 'CLOUD_SYNC_PROTOCOL_INVALID_LEDGER');
  for (const ledger of ledgers) {
    if (!hasText(ledger.customer_id || ledger.customerId)
      || !hasText(ledger.type)
      || !hasText(ledger.created_at || ledger.createdAt)) {
      throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_LEDGER');
    }
    requireValidMoney(ledger.amount, 'CLOUD_SYNC_PROTOCOL_INVALID_LEDGER');
    requireValidMoney(ledger.balance_after ?? ledger.balanceAfter, 'CLOUD_SYNC_PROTOCOL_INVALID_LEDGER');
    const debtCents = ledger.debt_cents_after ?? ledger.debtCentsAfter;
    if (!Number.isSafeInteger(debtCents) || debtCents < 0 || debtCents > 2147483647) {
      throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_LEDGER');
    }
  }

  const sessions = payload.cash_sessions || [];
  assertUniqueIds(sessions, 'CLOUD_SYNC_PROTOCOL_INVALID_CASH_SESSION');
  for (const session of sessions) {
    const stationId = session.cash_station_id || session.cashStationId
      || session.metadata?.cash_station_id || session.metadata?.cashStationId;
    if (!hasText(session.status || session.estado)
      || !hasText(session.actor_key || session.actorKey || session.staff_user_id || session.staffUserId)
      || !hasText(stationId)) {
      throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_CASH_SESSION');
    }
    for (const key of ['opening_amount', 'opening_counted_amount', 'opening_suggested_amount', 'opening_difference', 'closing_counted_amount', 'next_shift_fund', 'cash_sales_total', 'customer_payments_total', 'cash_entries_total', 'cash_exits_total', 'expected_cash_total', 'cash_difference']) {
      if (session[key] !== undefined && session[key] !== null) {
        requireValidMoney(session[key], 'CLOUD_SYNC_PROTOCOL_INVALID_CASH_SESSION', { allowNegative: key.endsWith('difference') });
      }
    }
  }

  const movements = payload.cash_movements || payload.movements || [];
  assertUniqueIds(movements, 'CLOUD_SYNC_PROTOCOL_INVALID_CASH_MOVEMENT');
  for (const movement of movements) {
    const stationId = movement.cash_station_id || movement.cashStationId
      || movement.metadata?.cash_station_id || movement.metadata?.cashStationId;
    if (!hasText(movement.cash_session_id || movement.cashSessionId)
      || !hasText(movement.type || movement.tipo)
      || !hasText(movement.actor_key || movement.actorKey || movement.staff_user_id || movement.staffUserId)
      || !hasText(stationId)) {
      throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_CASH_MOVEMENT');
    }
    requireValidMoney(movement.amount ?? movement.monto, 'CLOUD_SYNC_PROTOCOL_INVALID_CASH_MOVEMENT');
  }
};

const parseJson = (value, code) => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(code);
    }
  }
  return value;
};

const makeUpdateRequiredError = (family, cause = null) => {
  const error = new Error('CLOUD_CLIENT_UPDATE_REQUIRED');
  error.name = 'CloudSyncProtocolError';
  error.code = 'CLOUD_CLIENT_UPDATE_REQUIRED';
  error.family = family;
  error.recoverable = true;
  error.retryable = false;
  if (cause) error.cause = cause;
  return error;
};

const isUnavailableRpcError = (error, rpcName) => {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || error?.details || '').toLowerCase();
  return ['PGRST202', 'PGRST204', '42883'].includes(code)
    || (message.includes('schema cache') && message.includes(String(rpcName).toLowerCase()))
    || (message.includes('function')
      && message.includes(String(rpcName).toLowerCase())
      && (message.includes('does not exist') || message.includes('not found')));
};

const reportUpdateRequired = (family) => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const EventConstructor = window.CustomEvent || globalThis.CustomEvent;
  if (typeof EventConstructor !== 'function') return;
  window.dispatchEvent(new EventConstructor('lanzo:cloud-protocol-update-required', {
    detail: { family, code: 'CLOUD_CLIENT_UPDATE_REQUIRED' }
  }));
};

const reportCompatible = (family) => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const EventConstructor = window.CustomEvent || globalThis.CustomEvent;
  if (typeof EventConstructor !== 'function') return;
  window.dispatchEvent(new EventConstructor('lanzo:cloud-protocol-compatible', {
    detail: { family, contractVersion: CLOUD_SYNC_CONTRACT_VERSION }
  }));
};

const parseProjection = (projection) => {
  if (!isRecord(projection)) throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_PROJECTION');
  const customerId = projection.customer_id ?? projection.customerId;
  const state = projection.status;
  const debtCents = Object.prototype.hasOwnProperty.call(projection, 'debt_cents')
    ? projection.debt_cents
    : projection.debtCents;
  const source = projection.source;
  const version = projection.projection_version ?? projection.projectionVersion;

  if (typeof customerId !== 'string' || customerId.trim() === '' || !PROJECTION_STATES.has(state)) {
    throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_PROJECTION');
  }
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_PROJECTION');
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_PROJECTION');
  }

  if (state === 'KNOWN_POSITIVE'
    && (!Number.isSafeInteger(debtCents) || debtCents < 1 || debtCents > 2147483647)) {
    throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_PROJECTION');
  }
  if (state === 'KNOWN_ZERO' && debtCents !== 0) {
    throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_PROJECTION');
  }
  if (['HISTORICAL_PENDING', 'CONFLICT', 'NOT_INCLUDED'].includes(state) && debtCents !== null) {
    throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_PROJECTION');
  }

  return {
    customerId,
    status: state,
    debtCents,
    source,
    projectionVersion: version
  };
};

const findCustomerRecords = (payload) => {
  for (const collectionName of ['results', 'changes']) {
    if (Array.isArray(payload[collectionName])
      && payload[collectionName].some((row) => !isRecord(row))) {
      throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_PAYLOAD_ROW');
    }
  }

  const records = new Map();
  const pending = [{ value: payload, customerField: false, depth: 0 }];
  const visited = new Set();

  while (pending.length > 0) {
    const current = pending.pop();
    const value = current.value;
    if (!isRecord(value) && !Array.isArray(value)) {
      if (current.customerField && value !== null && value !== undefined) {
        throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_CUSTOMER');
      }
      continue;
    }
    if (visited.has(value)) continue;
    visited.add(value);

    if (current.customerField && !Array.isArray(value)) {
      if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim() === '') {
        throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_CUSTOMER');
      }
      records.set(value.id, value);
    } else if (isRecord(value)
      && typeof value.id === 'string'
      && value.id.trim() !== ''
      && hasText(value.name)
      && (Object.prototype.hasOwnProperty.call(value, 'credit_limit')
        || Object.prototype.hasOwnProperty.call(value, 'creditLimit'))) {
      records.set(value.id, value);
    }

    if (current.depth >= 32) continue;
    const children = Array.isArray(value)
      ? value.map((child) => ({ value: child, customerField: current.customerField, depth: current.depth + 1 }))
      : Object.entries(value).map(([key, child]) => ({
        value: child,
        customerField: key === 'customer' || (key === 'customers' && Array.isArray(child)),
        depth: current.depth + 1
      }));
    pending.push(...children);
  }

  return [...records.values()];
};

const attachProjections = (payload, projections) => {
  const customers = findCustomerRecords(payload);
  const ids = new Set(customers.map((customer) => customer.id));
  const byId = new Map();

  for (const rawProjection of projections) {
    const projection = parseProjection(rawProjection);
    if (!ids.has(projection.customerId) || byId.has(projection.customerId)) {
      throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_PROJECTION_IDENTITY');
    }
    byId.set(projection.customerId, projection);
  }
  for (const customer of customers) {
    const creditLimit = customer.credit_limit ?? customer.creditLimit;
    if (!hasText(customer.name)
      || !hasText(customer.created_at || customer.createdAt)
      || !hasText(customer.updated_at || customer.updatedAt)
      || !Number.isSafeInteger(customer.server_version ?? customer.serverVersion)
      || (customer.server_version ?? customer.serverVersion) < 1
      || moneyToCents(creditLimit) === null
      || moneyToCents(creditLimit) < 0) {
      throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_CUSTOMER');
    }
    const projection = byId.get(customer.id);
    if (!projection) throw new Error('CLOUD_SYNC_PROTOCOL_PROJECTION_MISSING');
    const currentCents = Object.prototype.hasOwnProperty.call(customer, 'debt_cents')
      ? customer.debt_cents
      : customer.debtCents;
    if (['KNOWN_ZERO', 'KNOWN_POSITIVE'].includes(projection.status)) {
      if (currentCents !== undefined && currentCents !== null
        && (!Number.isSafeInteger(Number(currentCents)) || Number(currentCents) !== projection.debtCents)) {
        throw new Error('CLOUD_SYNC_PROTOCOL_PROJECTION_VALUE_MISMATCH');
      }
      if (customer.debt !== undefined && customer.debt !== null
        && (!Number.isFinite(Number(customer.debt))
          || Math.round(Number(customer.debt) * 100) !== projection.debtCents)) {
        throw new Error('CLOUD_SYNC_PROTOCOL_PROJECTION_VALUE_MISMATCH');
      }
      customer.debt_cents = projection.debtCents;
      customer.debt = projection.debtCents / 100;
    } else {
      delete customer.debt_cents;
      delete customer.debtCents;
      delete customer.debt;
    }
    customer.financialProjectionStatus = projection.status;
    customer.financial_projection = {
      status: projection.status,
      debt_cents: projection.debtCents,
      source: projection.source,
      projection_version: projection.projectionVersion
    };
  }

  return payload;
};

export const validateCloudSyncV2Envelope = (rawEnvelope, {
  expectedTenantId,
  expectedEndpoint,
  expectedFamily,
  expectedCustomerId = null,
  expectedBatchId = null,
  expectedIdempotencyKey = null,
  expectedRequestHash = null,
  requireCursor = false,
  expectedOffset = null,
  expectedChangeSeq = null
} = {}) => {
  const envelope = parseJson(rawEnvelope, 'CLOUD_SYNC_PROTOCOL_INVALID_JSON');
  if (!isRecord(envelope)) throw new Error('CLOUD_SYNC_PROTOCOL_INVALID_ENVELOPE');
  if (envelope.contract_version !== CLOUD_SYNC_CONTRACT_VERSION) {
    throw makeUpdateRequiredError(expectedFamily || 'unknown');
  }
  if (envelope.endpoint !== expectedEndpoint || envelope.family !== expectedFamily) {
    throw new Error('CLOUD_SYNC_PROTOCOL_ENDPOINT_MISMATCH');
  }
  if (typeof expectedTenantId !== 'string' || envelope.tenant_id !== expectedTenantId) {
    throw new Error('CLOUD_SYNC_PROTOCOL_TENANT_MISMATCH');
  }
  if (!isRecord(envelope.payload)) throw new Error('CLOUD_SYNC_PROTOCOL_PAYLOAD_MISSING');
  if (!Array.isArray(envelope.customer_projections)) {
    throw new Error('CLOUD_SYNC_PROTOCOL_PROJECTION_MISSING');
  }

  validatePayloadCollections(envelope.payload);
  const payload = attachProjections(envelope.payload, envelope.customer_projections);
  if (envelope.cursor) {
    const cursor = envelope.cursor;
    const responseSeq = payload.latest_change_seq ?? payload.latestChangeSeq;
    const responseHasMore = payload.has_more ?? payload.hasMore;
    if (cursor.change_seq !== undefined && responseSeq !== undefined
      && Number(responseSeq) !== cursor.change_seq) {
      throw new Error('CLOUD_SYNC_PROTOCOL_CURSOR_MISMATCH');
    }
    if (responseHasMore !== undefined && Boolean(responseHasMore) !== cursor.has_more) {
      throw new Error('CLOUD_SYNC_PROTOCOL_CURSOR_MISMATCH');
    }
    if (cursor.change_seq !== undefined) payload.latest_change_seq = cursor.change_seq;
    if (cursor.offset !== undefined) payload.offset = cursor.offset;
    payload.has_more = cursor.has_more;
    payload.hasMore = cursor.has_more;
  }
  if (expectedCustomerId) {
    const responseIds = findCustomerRecords(payload).map((customer) => customer.id);
    const declaredId = envelope.customer_id ?? envelope.operation?.customer_id ?? null;
    if ((declaredId && declaredId !== expectedCustomerId)
      || responseIds.some((customerId) => customerId !== expectedCustomerId)) {
      throw new Error('CLOUD_SYNC_PROTOCOL_CUSTOMER_MISMATCH');
    }
  }

  if (expectedBatchId && envelope.operation?.batch_id !== expectedBatchId) {
    throw new Error('CLOUD_SYNC_PROTOCOL_OPERATION_MISMATCH');
  }

  if (expectedIdempotencyKey || expectedRequestHash) {
    const identity = envelope.operation;
    if (!isRecord(identity)
      || (expectedIdempotencyKey && identity.idempotency_key !== expectedIdempotencyKey)
      || (expectedRequestHash && identity.request_hash !== expectedRequestHash)) {
      throw new Error('CLOUD_SYNC_PROTOCOL_OPERATION_MISMATCH');
    }
  }

  if (requireCursor) {
    const cursor = envelope.cursor;
    if (!isRecord(cursor) || typeof cursor.has_more !== 'boolean') {
      throw new Error('CLOUD_SYNC_PROTOCOL_CURSOR_MISSING');
    }
    const cursorValue = cursor.change_seq ?? cursor.offset ?? null;
    if (cursorValue === null || !Number.isSafeInteger(cursorValue) || cursorValue < 0) {
      throw new Error('CLOUD_SYNC_PROTOCOL_CURSOR_INVALID');
    }
    if (expectedOffset !== null && cursor.offset !== expectedOffset) {
      throw new Error('CLOUD_SYNC_PROTOCOL_CURSOR_MISMATCH');
    }
    if (expectedChangeSeq !== null && cursor.change_seq < expectedChangeSeq) {
      throw new Error('CLOUD_SYNC_PROTOCOL_CURSOR_MISMATCH');
    }
    if (cursor.offset !== undefined) {
      if (!Number.isSafeInteger(cursor.offset) || cursor.offset < 0
        || (cursor.next_offset !== undefined
          && (!Number.isSafeInteger(cursor.next_offset) || cursor.next_offset < cursor.offset))
        || (cursor.has_more && cursor.next_offset !== undefined && cursor.next_offset <= cursor.offset)) {
        throw new Error('CLOUD_SYNC_PROTOCOL_CURSOR_INVALID');
      }
      if (expectedOffset !== null && cursor.has_more && cursor.next_offset === undefined) {
        throw new Error('CLOUD_SYNC_PROTOCOL_CURSOR_INVALID');
      }
      const pageRows = Array.isArray(payload.customers)
        ? payload.customers
        : (Array.isArray(payload.results) ? payload.results : null);
      if (pageRows && cursor.next_offset !== undefined
        && cursor.next_offset !== cursor.offset + pageRows.length) {
        throw new Error('CLOUD_SYNC_PROTOCOL_CURSOR_MISMATCH');
      }
    }
    if (cursor.change_seq !== undefined && (!Number.isSafeInteger(cursor.change_seq) || cursor.change_seq < 0
      || (cursor.has_more && expectedChangeSeq !== null && cursor.change_seq <= expectedChangeSeq))) {
      throw new Error('CLOUD_SYNC_PROTOCOL_CURSOR_INVALID');
    }
    if (cursor.next_cursor !== undefined && cursor.next_cursor !== null
      && (typeof cursor.next_cursor !== 'string' || cursor.next_cursor.length === 0)) {
      throw new Error('CLOUD_SYNC_PROTOCOL_CURSOR_INVALID');
    }
  }

  return {
    ...payload,
    cloudSyncEnvelope: {
      contractVersion: envelope.contract_version,
      tenantId: envelope.tenant_id,
      endpoint: envelope.endpoint,
      family: envelope.family,
      cursor: envelope.cursor || null,
      operation: envelope.operation || null,
      customerProjections: envelope.customer_projections.map(parseProjection)
    }
  };
};

const normalizeContract = (rawContract, { family, rpcName, requestedCapabilities }) => {
  const contract = parseJson(rawContract, 'CLOUD_SYNC_PROTOCOL_INVALID_DISCOVERY');
  if (!isRecord(contract)) throw makeUpdateRequiredError(family);
  if (contract.success === false && contract.code === 'CLOUD_CLIENT_UPDATE_REQUIRED') {
    throw makeUpdateRequiredError(family);
  }
  if (contract.contract_version !== CLOUD_SYNC_CONTRACT_VERSION
    || contract.server_status !== 'SUPPORTED'
    || typeof contract.tenant_id !== 'string'
    || contract.tenant_id.trim() === '') {
    throw makeUpdateRequiredError(family);
  }

  const serverCapabilities = Array.isArray(contract.capabilities) ? contract.capabilities : [];
  if (requestedCapabilities.some((capability) => !serverCapabilities.includes(capability))) {
    throw makeUpdateRequiredError(family);
  }
  const families = Array.isArray(contract.endpoint_families) ? contract.endpoint_families : [];
  if (!families.includes(family)) throw makeUpdateRequiredError(family);
  const endpoints = Array.isArray(contract.endpoints) ? contract.endpoints : [];
  if (!endpoints.includes(rpcName)) throw makeUpdateRequiredError(family);

  return contract;
};

export const callCloudSyncV2Rpc = async ({
  client,
  rpcName,
  authArgs,
  params = {},
  family = 'customer_directory',
  expectedCustomerId = null,
  expectedBatchId = null,
  expectedIdempotencyKey = null,
  expectedRequestHash = null,
  requireCursor = false,
  expectedOffset = null,
  expectedChangeSeq = null,
  actorHandle = null
}) => {
  if (!client?.rpc || typeof rpcName !== 'string' || !isRecord(authArgs)) {
    throw new Error('CLOUD_SYNC_PROTOCOL_CLIENT_INVALID');
  }
  actorHandle?.assertCurrent?.();
  const requestedCapabilities = CLOUD_SYNC_CAPABILITIES;
  const { data: discoveryData, error: discoveryError } = await client.rpc(CLOUD_SYNC_CONTRACT_RPC, {
    ...authArgs,
    p_requested_contract: CLOUD_SYNC_CONTRACT_VERSION,
    p_capabilities: requestedCapabilities
  });
  actorHandle?.assertCurrent?.();
  if (discoveryError) {
    if (isUnavailableRpcError(discoveryError, CLOUD_SYNC_CONTRACT_RPC)
      || discoveryError?.code === 'CLOUD_CLIENT_UPDATE_REQUIRED') {
      reportUpdateRequired(family);
      throw makeUpdateRequiredError(family, discoveryError);
    }
    throw discoveryError;
  }

  const contract = normalizeContract(discoveryData, { family, rpcName, requestedCapabilities });
  actorHandle?.assertCurrent?.();
  const syncContract = {
    contract_version: CLOUD_SYNC_CONTRACT_VERSION,
    capabilities: requestedCapabilities
  };
  const { data, error } = await client.rpc(rpcName, {
    ...authArgs,
    ...params,
    p_sync_contract: syncContract
  });
  actorHandle?.assertCurrent?.();
  if (error) {
    if (isUnavailableRpcError(error, rpcName) || error?.code === 'CLOUD_CLIENT_UPDATE_REQUIRED') {
      reportUpdateRequired(family);
      throw makeUpdateRequiredError(family, error);
    }
    throw error;
  }

  try {
    const validated = validateCloudSyncV2Envelope(data, {
      expectedTenantId: contract.tenant_id,
      expectedEndpoint: rpcName,
      expectedFamily: family,
      expectedCustomerId,
      expectedBatchId,
      expectedIdempotencyKey,
      expectedRequestHash,
      requireCursor,
      expectedOffset,
      expectedChangeSeq
    });
    actorHandle?.assertCurrent?.();
    const licenseKey = authArgs.p_license_key;
    let outboxResumed = true;
    if (licenseKey) {
      try {
        await syncOutboxService.resumeUpdateRequired(family, { licenseKey });
      } catch {
        // A confirmed contract remains valid even if local queue maintenance is
        // temporarily unavailable. Keep paused rows intact and retry recovery
        // on the next successful v2 request.
        outboxResumed = false;
      }
      actorHandle?.assertCurrent?.();
    }
    if (outboxResumed) reportCompatible(family);
    return validated;
  } catch (errorValidation) {
    if (errorValidation?.code === 'CLOUD_CLIENT_UPDATE_REQUIRED') reportUpdateRequired(family);
    throw errorValidation;
  }
};

export const isCloudClientUpdateRequired = (error) => error?.code === 'CLOUD_CLIENT_UPDATE_REQUIRED';
