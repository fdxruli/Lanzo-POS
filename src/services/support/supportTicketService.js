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
  id: ticket.id,
  subject: ticket.subject || 'Solicitud de soporte',
  category: ticket.category || 'help',
  priority: ticket.priority || 'normal',
  status: ticket.status || 'open',
  last_message_preview: ticket.last_message_preview || '',
  last_message_at: ticket.last_message_at || null,
  created_at: ticket.created_at || null,
  updated_at: ticket.updated_at || null,
  closed_at: ticket.closed_at || null
});

const normalizeMessage = (message = {}) => ({
  id: message.id,
  sender_type: message.sender_type || 'user',
  sender_staff_user_id: message.sender_staff_user_id || null,
  sender_device_fingerprint: message.sender_device_fingerprint || null,
  message: message.message || '',
  attachments_metadata: Array.isArray(message.attachments_metadata)
    ? message.attachments_metadata
    : [],
  metadata: message.metadata || {},
  created_at: message.created_at || null
});

const normalizeListResponse = (data) => {
  const payload = parseRpcPayload(data);
  const tickets = Array.isArray(payload.tickets)
    ? payload.tickets.map(normalizeTicket).filter((ticket) => ticket.id)
    : [];

  return {
    ...payload,
    success: payload.success !== false,
    tickets
  };
};

const normalizeThreadResponse = (data) => {
  const payload = parseRpcPayload(data);

  return {
    ...payload,
    success: payload.success !== false,
    ticket: payload.ticket ? normalizeTicket(payload.ticket) : null,
    messages: Array.isArray(payload.messages)
      ? payload.messages.map(normalizeMessage).filter((message) => message.id)
      : []
  };
};

const normalizeMutationResponse = (data) => {
  const payload = parseRpcPayload(data);

  return {
    ...payload,
    success: payload.success !== false,
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
    p_metadata: metadata || {}
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
