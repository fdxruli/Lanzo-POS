import { createClient } from 'jsr:@supabase/supabase-js@2';

const ENTITLEMENT_SCHEMA_VERSION = 1;
const DEFAULT_TTL_SECONDS = 72 * 60 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_BODY_BYTES = 32 * 1024;

const CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

type EntitlementRequest = {
  license_key?: unknown;
  device_fingerprint?: unknown;
  security_token?: unknown;
  actor_session_token?: unknown;
  // Compatibility name used by the existing shared-terminal clients.
  staff_session_token?: unknown;
};

type RpcResult = {
  data: Record<string, unknown> | null;
  error: { message?: string } | null;
};

function allowedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const configured = (Deno.env.get('OFFLINE_ENTITLEMENT_ALLOWED_ORIGINS') || '*')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!origin) return '*';
  if (configured.includes('*')) return '*';
  return configured.includes(origin) ? origin : 'null';
}

function response(request: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Access-Control-Allow-Origin': allowedOrigin(request) }
  });
}

function fail(request: Request, code: string, status = 400) {
  return response(request, status, { success: false, code });
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  const clean = value.trim();
  return clean.length > 0 && clean.length <= maxLength ? clean : '';
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function decodeBase64Url(value: string) {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function encodeBase64Url(value: ArrayBuffer) {
  let binary = '';
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function loadSigningKey() {
  const encoded = cleanText(Deno.env.get('OFFLINE_ENTITLEMENT_PRIVATE_KEY'), 4096);
  const bytes = encoded ? decodeBase64Url(encoded) : null;
  if (!bytes || bytes.byteLength < 32) return null;

  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      bytes,
      { name: 'Ed25519' },
      false,
      ['sign']
    );
  } catch {
    return null;
  }
}

function getTtlSeconds() {
  const configured = Number(Deno.env.get('OFFLINE_ENTITLEMENT_TTL_SECONDS'));
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.trunc(configured), MAX_TTL_SECONDS);
}

async function readJson(request: Request): Promise<EntitlementRequest | null> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return null;

  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body as EntitlementRequest : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      status: 204,
      headers: { ...CORS_HEADERS, 'Access-Control-Allow-Origin': allowedOrigin(request) }
    });
  }
  if (request.method !== 'POST') return fail(request, 'METHOD_NOT_ALLOWED', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const signingKey = await loadSigningKey();
  if (!supabaseUrl || !serviceRoleKey || !signingKey) {
    console.error('[offline-entitlement] signer not configured');
    return fail(request, 'OFFLINE_ENTITLEMENT_NOT_CONFIGURED', 503);
  }

  const body = await readJson(request);
  if (!body) return fail(request, 'INVALID_REQUEST');

  const licenseKey = cleanText(body.license_key, 160);
  const deviceFingerprint = cleanText(body.device_fingerprint, 256);
  const securityToken = cleanText(body.security_token, 512);
  const actorSessionToken = cleanText(
    body.actor_session_token ?? body.staff_session_token,
    512
  );
  if (!licenseKey || !deviceFingerprint || !securityToken || !actorSessionToken) {
    return fail(request, 'ACTOR_SESSION_REQUIRED', 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const rateLimit = await supabase.rpc('enforce_pos_rpc_rate_limit_v2', {
    p_license_key: licenseKey,
    p_device_fingerprint: deviceFingerprint,
    p_staff_session_token: actorSessionToken,
    p_rpc_name: 'issue_offline_entitlement',
    p_scope: 'AUTH_LICENSE',
    p_max_attempts: 12,
    p_window_seconds: 600,
    p_block_seconds: 900,
    p_code: 'OFFLINE_ENTITLEMENT_RATE_LIMITED',
    p_metadata: {}
  }) as RpcResult;
  if (rateLimit.error) {
    console.error('[offline-entitlement] rate-limit RPC failed');
    return fail(request, 'OFFLINE_ENTITLEMENT_UNAVAILABLE', 503);
  }
  if (rateLimit.data?.allowed === false) {
    return fail(request, 'OFFLINE_ENTITLEMENT_RATE_LIMITED', 429);
  }

  const actorContext = await supabase.rpc('validate_pos_rpc_rate_limit_context', {
    p_license_key: licenseKey,
    p_device_fingerprint: deviceFingerprint,
    p_security_token: securityToken,
    p_staff_session_token: actorSessionToken
  }) as RpcResult;
  if (
    actorContext.error
    || actorContext.data?.success !== true
    || actorContext.data?.allowed !== true
  ) {
    return fail(request, String(actorContext.data?.code || 'ACTOR_SESSION_INVALID'), 403);
  }

  const licenseId = cleanText(actorContext.data?.license_id, 80);
  const { data: license, error: licenseError } = await supabase
    .from('licenses')
    .select('status, expires_at')
    .eq('id', licenseId)
    .maybeSingle();
  if (licenseError || !license || license.status !== 'active') {
    return fail(request, 'LICENSE_NOT_ACTIVE', 403);
  }

  const now = Date.now();
  const subscriptionExpiresAt = license.expires_at ? Date.parse(String(license.expires_at)) : null;
  if (subscriptionExpiresAt && subscriptionExpiresAt <= now) {
    return fail(request, 'LICENSE_EXPIRED', 403);
  }

  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(Math.min(
    now + getTtlSeconds() * 1000,
    subscriptionExpiresAt || Number.MAX_SAFE_INTEGER
  )).toISOString();
  const payload = {
    schema_version: ENTITLEMENT_SCHEMA_VERSION,
    license_key: licenseKey,
    device_fingerprint: deviceFingerprint,
    plan_code: actorContext.data.plan_code || 'unknown',
    issued_at: issuedAt,
    expires_at: expiresAt
  };
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    signingKey,
    new TextEncoder().encode(stableStringify(payload))
  );

  return response(request, 200, {
    success: true,
    offline_entitlement: { ...payload, signature: encodeBase64Url(signature) }
  });
});
