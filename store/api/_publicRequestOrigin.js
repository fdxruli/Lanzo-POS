import { isIP } from 'node:net';

const FORBIDDEN_HOST_CHARACTERS = /[\u0000-\u0020\u007F-\uFFFF,/?#@\\]/u;
const HOSTNAME_PATTERN = /^[a-z0-9.-]+$/u;

export class PublicRequestOriginError extends TypeError {
  constructor(code) {
    super('El origen público de la solicitud no es válido.');
    this.name = 'PublicRequestOriginError';
    this.code = code;
  }
}

const originError = (code) => new PublicRequestOriginError(code);

function readSingleHeader(headers, name) {
  const value = headers?.get?.(name);
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.includes(',') || /[\r\n]/u.test(value)) {
    throw originError('INVALID_PLATFORM_HEADER');
  }
  return value;
}

function validateHostname(hostname) {
  const normalized = hostname.toLowerCase();
  if (
    !normalized
    || normalized.length > 253
    || !HOSTNAME_PATTERN.test(normalized)
    || normalized.includes('..')
    || normalized.startsWith('.')
    || normalized.endsWith('.')
    || normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || isIP(normalized) !== 0
  ) {
    throw originError('INVALID_PUBLIC_HOST');
  }

  const labels = normalized.split('.');
  if (
    labels.some((label) => (
      !label
      || label.length > 63
      || label.startsWith('-')
      || label.endsWith('-')
    ))
  ) {
    throw originError('INVALID_PUBLIC_HOST');
  }
  return normalized;
}

function originFromHost(hostValue, protocol) {
  if (
    typeof hostValue !== 'string'
    || !hostValue
    || FORBIDDEN_HOST_CHARACTERS.test(hostValue)
  ) {
    throw originError('INVALID_PUBLIC_HOST');
  }
  if (protocol !== 'https:') throw originError('HTTPS_REQUIRED');

  let parsed;
  try {
    parsed = new URL(`https://${hostValue}`);
  } catch {
    throw originError('INVALID_PUBLIC_HOST');
  }
  if (
    parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || (parsed.port && parsed.port !== '443')
  ) {
    throw originError('INVALID_PUBLIC_HOST');
  }

  const hostname = validateHostname(parsed.hostname);
  return `https://${hostname}`;
}

function normalizeAllowedOrigin(value) {
  if (typeof value !== 'string' || value !== value.trim() || !value) {
    throw originError('INVALID_ORIGIN_ALLOWLIST');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw originError('INVALID_ORIGIN_ALLOWLIST');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || (parsed.port && parsed.port !== '443')
  ) {
    throw originError('INVALID_ORIGIN_ALLOWLIST');
  }
  return originFromHost(parsed.host, parsed.protocol);
}

export function parsePublicStoreOrigins(value) {
  if (value == null || value === '') return Object.freeze([]);
  if (typeof value !== 'string' || /[\r\n]/u.test(value)) {
    throw originError('INVALID_ORIGIN_ALLOWLIST');
  }
  const origins = value.split(',').map(normalizeAllowedOrigin);
  if (origins.length === 0 || new Set(origins).size !== origins.length) {
    throw originError('INVALID_ORIGIN_ALLOWLIST');
  }
  return Object.freeze(origins);
}

export function resolvePublicRequestOrigin({
  request,
  allowedOrigins,
} = {}) {
  const requestUrl = typeof request?.url === 'string' ? request.url : '';
  let parsedRequestUrl;
  try {
    parsedRequestUrl = new URL(requestUrl);
  } catch {
    throw originError('INVALID_REQUEST_URL');
  }

  const forwardedHost = readSingleHeader(request.headers, 'x-forwarded-host');
  const host = readSingleHeader(request.headers, 'host');
  const forwardedProtocol = readSingleHeader(request.headers, 'x-forwarded-proto');
  if (forwardedProtocol && forwardedProtocol !== 'https') {
    throw originError('HTTPS_REQUIRED');
  }

  const protocol = forwardedProtocol
    ? 'https:'
    : parsedRequestUrl.protocol;
  const candidate = forwardedHost || host;
  const origin = candidate
    ? originFromHost(candidate, protocol)
    : originFromHost(parsedRequestUrl.host, parsedRequestUrl.protocol);
  const allowlist = Array.isArray(allowedOrigins)
    ? allowedOrigins.map(normalizeAllowedOrigin)
    : parsePublicStoreOrigins(allowedOrigins);

  if (allowlist.length > 0 && !allowlist.includes(origin)) {
    throw originError('ORIGIN_NOT_ALLOWED');
  }
  return origin;
}
