import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import {
  getNotificationCapabilities,
  getSupportChannel,
  isSupportCenterEnabled
} from '../notifications/notificationCapabilities';

const EMPTY_SUPPORT_TICKETS = Object.freeze({
  success: true,
  tickets: [],
  skipped: true
});

const EMPTY_SUPPORT_THREAD = Object.freeze({
  success: true,
  ticket: null,
  messages: [],
  skipped: true
});

const SUPPORT_DISABLED = Object.freeze({
  success: false,
  code: 'SUPPORT_CENTER_DISABLED',
  message: 'Este plan no incluye soporte interno.'
});

const clampLimit = (limit) => Math.min(Math.max(Number(limit) || 20, 1), 100);
const clampOffset = (offset) => Math.max(Number(offset) || 0, 0);
const ALLOWED_TICKET_METADATA_SOURCES = new Set(['notification_center']);
const SAFE_RPC_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,79}$/;
const boundedString = (value, fallback = '', maxLength = 160) => (
  typeof value === 'string' ? value.slice(0, maxLength) : fallback
);

const parseRpcPayload = (data) => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return { success: false, code: 'INVALID_RPC_RESPONSE' };
    }
  }

  return data || {};
};

const getLicenseKey = (licenseDetails = {}) => (
  licenseDetails.license_key ||
  licenseDetails.licenseKey ||
  licenseDetails.details?.license_key ||
  licenseDetails.details?.licenseKey ||
  null
);

const canUseSupportTickets = (licenseDetails = {}) => {
  const capabilities = getNotificationCapabilities(licenseDetails);

  return (
    isSupportCenterEnabled(licenseDetails) &&
    getSupportChannel(licenseDetails) === 'in_app' &&
    capabilities.support_tickets === true
  );
};

const normalizeTicket = (ticket = {}) => ({
  id: boundedString(ticket.id, '', 128),
  subject: boundedString(ticket.subject, 'Solicitud de soporte'),
  category: boundedString(ticket.category, 'help', 40),
  priority: boundedString(ticket.priority, 'normal', 24),
  status: boundedString(ticket.status, 'open', 24),
  last_message_preview: boundedString(ticket.last_message_preview, '', 240),
  last_message_at: boundedString(ticket.last_message_at, '', 40) || null,
  created_at: boundedString(ticket.created_at, '', 40) || null,
  updated_at: boundedString(ticket.updated_at, '', 40) || null,
  closed_at: boundedString(ticket.closed_at, '', 40) || null
});

const normalizeMessage = (message = {}) => ({
  id: boundedString(message.id, '', 128),
  sender_type: ['user', 'staff'].includes(message.sender_type) ? message.sender_type : 'user',
  message: boundedString(message.message, '', 4_000),
  created_at: boundedString(message.created_at, '', 40) || null
});

const normalizeRpcCode = (payload) => (
  typeof payload?.code === 'string' && SAFE_RPC_CODE_PATTERN.test(payload.code)
    ? payload.code
    : undefined
);

const normalizeTicketMetadata = (metadata) => {
  try {
    const source = metadata?.source;
    return typeof source === 'string' && ALLOWED_TICKET_METADATA_SOURCES.has(source)
      ? { source }
      : {};
  } catch {
    return {};
  }
};

const normalizeListResponse = (data) => {
  const payload = parseRpcPayload(data);
  const tickets = Array.isArray(payload.tickets)
    ? payload.tickets.map(normalizeTicket).filter((ticket) => ticket.id)
    : [];

  return {
    success: payload.success !== false,
    ...(normalizeRpcCode(payload) ? { code: normalizeRpcCode(payload) } : {}),
    tickets
  };
};

const normalizeThreadResponse = (data) => {
  const payload = parseRpcPayload(data);

  return {
    success: payload.success !== false,
    ...(normalizeRpcCode(payload) ? { code: normalizeRpcCode(payload) } : {}),
    ticket: payload.ticket ? normalizeTicket(payload.ticket) : null,
    messages: Array.isArray(payload.messages)
      ? payload.messages.map(normalizeMessage).filter((message) => message.id)
      : []
  };
};

const normalizeMutationResponse = (data) => {
  const payload = parseRpcPayload(data);

  return {
    success: payload.success !== false,
    ...(normalizeRpcCode(payload) ? { code: normalizeRpcCode(payload) } : {}),
    ticket: payload.ticket ? normalizeTicket(payload.ticket) : null
  };
};

const buildRpcAuthArgs = async (licenseDetails = {}) => {
  const licenseKey = getLicenseKey(licenseDetails);

  if (!licenseKey) {
    throw new Error('LICENSE_KEY_REQUIRED');
  }

  const authContext = await buildPosSyncAuthContext({ licenseKey });

  if (!authContext.deviceFingerprint || !authContext.securityToken) {
    throw new Error('POS_SUPPORT_AUTH_CONTEXT_INCOMPLETE');
  }

  return {
    p_license_key: authContext.licenseKey,
    p_device_fingerprint: authContext.deviceFingerprint,
    p_security_token: authContext.securityToken,
    p_staff_session_token: authContext.staffSessionToken || null
  };
};

const ensureRpcAvailable = (licenseDetails = {}, { empty = false } = {}) => {
  if (!canUseSupportTickets(licenseDetails)) {
    return empty ? 'empty' : 'disabled';
  }

  if (!supabaseClient) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  return 'enabled';
};

export async function createSupportTicket({
  licenseDetails,
  subject,
  category = 'help',
  priority = 'normal',
  message,
  metadata = {}
} = {}) {
  const availability = ensureRpcAvailable(licenseDetails);
  if (availability === 'disabled') return { ...SUPPORT_DISABLED };

  const authArgs = await buildRpcAuthArgs(licenseDetails);
  const { data, error } = await supabaseClient.rpc('create_support_ticket', {
    ...authArgs,
    p_subject: subject,
    p_category: category,
    p_priority: priority,
    p_message: message,
    p_metadata: normalizeTicketMetadata(metadata)
  });

  if (error) throw error;

  return normalizeMutationResponse(data);
}

export async function listSupportTickets({
  licenseDetails,
  limit = 20,
  offset = 0,
  includeClosed = false
} = {}) {
  const availability = ensureRpcAvailable(licenseDetails, { empty: true });
  if (availability === 'empty') return { ...EMPTY_SUPPORT_TICKETS };

  const authArgs = await buildRpcAuthArgs(licenseDetails);
  const { data, error } = await supabaseClient.rpc('list_support_tickets', {
    ...authArgs,
    p_limit: clampLimit(limit),
    p_offset: clampOffset(offset),
    p_include_closed: Boolean(includeClosed)
  });

  if (error) throw error;

  return normalizeListResponse(data);
}

export async function getSupportTicketThread({
  licenseDetails,
  ticketId
} = {}) {
  const availability = ensureRpcAvailable(licenseDetails, { empty: true });
  if (availability === 'empty') return { ...EMPTY_SUPPORT_THREAD };

  if (!ticketId) {
    return { success: false, code: 'TICKET_ID_REQUIRED', messages: [] };
  }

  const authArgs = await buildRpcAuthArgs(licenseDetails);
  const { data, error } = await supabaseClient.rpc('get_support_ticket_thread', {
    ...authArgs,
    p_ticket_id: ticketId
  });

  if (error) throw error;

  return normalizeThreadResponse(data);
}

export async function replySupportTicket({
  licenseDetails,
  ticketId,
  message
} = {}) {
  const availability = ensureRpcAvailable(licenseDetails);
  if (availability === 'disabled') return { ...SUPPORT_DISABLED };

  if (!ticketId) {
    return { success: false, code: 'TICKET_ID_REQUIRED' };
  }

  const authArgs = await buildRpcAuthArgs(licenseDetails);
  const { data, error } = await supabaseClient.rpc('reply_support_ticket', {
    ...authArgs,
    p_ticket_id: ticketId,
    p_message: message
  });

  if (error) throw error;

  return normalizeMutationResponse(data);
}

export async function closeSupportTicket({
  licenseDetails,
  ticketId
} = {}) {
  const availability = ensureRpcAvailable(licenseDetails);
  if (availability === 'disabled') return { ...SUPPORT_DISABLED };

  if (!ticketId) {
    return { success: false, code: 'TICKET_ID_REQUIRED' };
  }

  const authArgs = await buildRpcAuthArgs(licenseDetails);
  const { data, error } = await supabaseClient.rpc('close_support_ticket', {
    ...authArgs,
    p_ticket_id: ticketId
  });

  if (error) throw error;

  return normalizeMutationResponse(data);
}
