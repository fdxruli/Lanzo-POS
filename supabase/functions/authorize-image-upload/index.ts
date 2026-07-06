import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'images';
const PUBLIC_PREFIX = 'public_uploads';
const SERVER_KEY_ENV = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');

const PURPOSE_LIMITS: Record<string, number> = {
  'business-logo': 2 * 1024 * 1024,
  'business-cover': 5 * 1024 * 1024,
  'product-image': 4 * 1024 * 1024,
  'category-image': 4 * 1024 * 1024,
  'restaurant-item-image': 4 * 1024 * 1024,
  'profile-image': 2 * 1024 * 1024,
  'misc': 4 * 1024 * 1024
};

const ALLOWED_PURPOSES = new Set(Object.keys(PURPOSE_LIMITS));
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const MIME_EXTENSION_COMPATIBILITY: Record<string, Set<string>> = {
  'image/jpeg': new Set(['jpg', 'jpeg']),
  'image/png': new Set(['png']),
  'image/webp': new Set(['webp']),
  'image/gif': new Set(['gif'])
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const FRIENDLY_MESSAGES: Record<string, string> = {
  STORAGE_UPLOAD_RATE_LIMITED: 'Demasiados intentos al subir imágenes. Espera unos minutos e intenta de nuevo.',
  INVALID_IMAGE_TYPE: 'El archivo debe ser una imagen JPG, PNG, WEBP o GIF.',
  IMAGE_TOO_LARGE: 'La imagen es demasiado grande. Reduce el tamaño e intenta de nuevo.',
  INVALID_IMAGE_PATH: 'No se pudo preparar la ruta segura de la imagen.',
  STORAGE_UPLOAD_NOT_ALLOWED: 'No tienes permiso para subir esta imagen.',
  STORAGE_UPLOAD_FAILED: 'No se pudo subir la imagen. Revisa tu conexión e intenta de nuevo.',
  INVALID_REQUEST: 'No se pudo procesar la imagen. Intenta de nuevo.'
};

type UploadRequest = {
  license_key?: string;
  device_fingerprint?: string;
  security_token?: string;
  staff_session_token?: string | null;
  purpose?: string;
  filename?: string;
  mime_type?: string;
  size_bytes?: number;
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

function fail(code: string, status = 400, extra: Record<string, unknown> = {}) {
  return jsonResponse(status, {
    success: false,
    code,
    message: FRIENDLY_MESSAGES[code] || FRIENDLY_MESSAGES.STORAGE_UPLOAD_FAILED,
    ...extra
  });
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasUnsafePathContent(value: string) {
  const lower = value.toLowerCase();
  return (
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\') ||
    lower.includes('%2f') ||
    lower.includes('%5c') ||
    lower.includes('%00') ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    /\s/u.test(value)
  );
}

function getExtension(filename: string) {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/u);
  return match?.[1] || '';
}

async function sha256Hex(value: string | null | undefined) {
  const clean = cleanText(value || '');
  if (!clean) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function writeAudit(
  supabase: ReturnType<typeof createClient>,
  request: UploadRequest,
  payload: { status: string; code?: string; objectPath?: string; metadata?: Record<string, unknown> }
) {
  try {
    const [licenseHash, deviceHash, staffHash] = await Promise.all([
      sha256Hex(request.license_key),
      sha256Hex(request.device_fingerprint),
      sha256Hex(request.staff_session_token || undefined)
    ]);

    if (!licenseHash) return;

    await supabase.from('storage_upload_audit').insert({
      license_key_hash: licenseHash,
      device_fingerprint_hash: deviceHash,
      staff_session_hash: staffHash,
      purpose: cleanText(request.purpose || 'misc') || 'misc',
      bucket_id: BUCKET,
      object_path: payload.objectPath || '',
      mime_type: cleanText(request.mime_type || '').toLowerCase() || null,
      size_bytes: Number.isFinite(request.size_bytes) ? Math.trunc(Number(request.size_bytes)) : null,
      status: payload.status,
      code: payload.code || null,
      metadata: payload.metadata || {}
    });
  } catch (error) {
    console.warn('[SEC.3] storage upload audit failed', error);
  }
}

function validateRequest(input: UploadRequest) {
  const licenseKey = cleanText(input.license_key);
  const deviceFingerprint = cleanText(input.device_fingerprint);
  const securityToken = cleanText(input.security_token);
  const staffSessionToken = cleanText(input.staff_session_token || '');
  const purpose = cleanText(input.purpose || 'misc').toLowerCase();
  const filename = cleanText(input.filename);
  const mimeType = cleanText(input.mime_type).toLowerCase();
  const sizeBytes = Number(input.size_bytes);
  const extension = getExtension(filename);

  if (!licenseKey || !deviceFingerprint || !securityToken) return { ok: false as const, code: 'STORAGE_UPLOAD_NOT_ALLOWED' };
  if (!ALLOWED_PURPOSES.has(purpose)) return { ok: false as const, code: 'INVALID_IMAGE_PATH' };
  if (!filename || filename.length > 180 || hasUnsafePathContent(filename)) return { ok: false as const, code: 'INVALID_IMAGE_PATH' };
  if (!ALLOWED_EXTENSIONS.has(extension) || !ALLOWED_MIME_TYPES.has(mimeType)) return { ok: false as const, code: 'INVALID_IMAGE_TYPE' };
  if (!MIME_EXTENSION_COMPATIBILITY[mimeType]?.has(extension)) return { ok: false as const, code: 'INVALID_IMAGE_TYPE' };

  const maxSizeBytes = PURPOSE_LIMITS[purpose];
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxSizeBytes) {
    return { ok: false as const, code: 'IMAGE_TOO_LARGE', maxSizeBytes };
  }

  return {
    ok: true as const,
    licenseKey,
    deviceFingerprint,
    securityToken,
    staffSessionToken: staffSessionToken || null,
    purpose,
    mimeType,
    sizeBytes: Math.trunc(sizeBytes),
    extension,
    maxSizeBytes
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return fail('INVALID_REQUEST', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serverKey = Deno.env.get(SERVER_KEY_ENV);

  if (!supabaseUrl || !serverKey) return fail('STORAGE_UPLOAD_FAILED', 500);

  const supabase = createClient(supabaseUrl, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let body: UploadRequest;
  try {
    body = await req.json();
  } catch {
    return fail('INVALID_REQUEST', 400);
  }

  const validation = validateRequest(body);
  if (!validation.ok) {
    await writeAudit(supabase, body, { status: 'rejected', code: validation.code });
    return fail(validation.code, validation.code === 'IMAGE_TOO_LARGE' ? 413 : 400, { max_size_bytes: validation.maxSizeBytes || null });
  }

  const rateLimit = await supabase.rpc('enforce_pos_rpc_rate_limit_v2', {
    p_license_key: validation.licenseKey,
    p_device_fingerprint: validation.deviceFingerprint,
    p_staff_session_token: validation.staffSessionToken,
    p_rpc_name: 'authorize_image_upload',
    p_scope: 'STORAGE_UPLOAD',
    p_max_attempts: 30,
    p_window_seconds: 600,
    p_block_seconds: 900,
    p_code: 'STORAGE_UPLOAD_RATE_LIMITED',
    p_metadata: { purpose: validation.purpose, mime_type: validation.mimeType, size_bytes: validation.sizeBytes }
  });

  if (rateLimit.error) {
    console.warn('[SEC.3] rate limit RPC failed', rateLimit.error);
    await writeAudit(supabase, body, { status: 'error', code: 'STORAGE_UPLOAD_FAILED' });
    return fail('STORAGE_UPLOAD_FAILED', 500);
  }

  if (rateLimit.data?.allowed === false) {
    await writeAudit(supabase, body, { status: 'rate_limited', code: 'STORAGE_UPLOAD_RATE_LIMITED' });
    return fail('STORAGE_UPLOAD_RATE_LIMITED', 429, { retry_after_seconds: rateLimit.data?.retry_after_seconds || null });
  }

  const licenseValidation = await supabase.rpc('verify_device_license_unified', {
    p_license_key: validation.licenseKey,
    p_device_fingerprint: validation.deviceFingerprint,
    p_security_token: validation.securityToken
  });

  if (licenseValidation.error || licenseValidation.data?.valid !== true) {
    await writeAudit(supabase, body, {
      status: 'rejected',
      code: 'STORAGE_UPLOAD_NOT_ALLOWED',
      metadata: { reason: licenseValidation.data?.reason || licenseValidation.error?.code || null }
    });
    return fail('STORAGE_UPLOAD_NOT_ALLOWED', 403);
  }

  if (licenseValidation.data?.device_role === 'staff' && !validation.staffSessionToken) {
    await writeAudit(supabase, body, {
      status: 'rejected',
      code: 'STORAGE_UPLOAD_NOT_ALLOWED',
      metadata: { reason: 'STAFF_SESSION_REQUIRED' }
    });
    return fail('STORAGE_UPLOAD_NOT_ALLOWED', 403);
  }

  if (validation.staffSessionToken) {
    const staffValidation = await supabase.rpc('verify_staff_session', {
      p_license_key: validation.licenseKey,
      p_device_fingerprint: validation.deviceFingerprint,
      p_staff_session_token: validation.staffSessionToken
    });

    if (staffValidation.error || staffValidation.data?.valid !== true) {
      await writeAudit(supabase, body, {
        status: 'rejected',
        code: 'STORAGE_UPLOAD_NOT_ALLOWED',
        metadata: { reason: staffValidation.data?.code || staffValidation.error?.code || null }
      });
      return fail('STORAGE_UPLOAD_NOT_ALLOWED', 403);
    }
  }

  const licenseHash = await sha256Hex(validation.licenseKey);
  if (!licenseHash) {
    await writeAudit(supabase, body, { status: 'rejected', code: 'STORAGE_UPLOAD_NOT_ALLOWED' });
    return fail('STORAGE_UPLOAD_NOT_ALLOWED', 403);
  }

  const objectPath = `${PUBLIC_PREFIX}/${licenseHash}/${validation.purpose}/${crypto.randomUUID()}.${validation.extension}`;
  const signedUpload = await supabase.storage.from(BUCKET).createSignedUploadUrl(objectPath);

  if (signedUpload.error || !signedUpload.data?.token) {
    console.warn('[SEC.3] signed upload URL failed', signedUpload.error);
    await writeAudit(supabase, body, { status: 'error', code: 'STORAGE_UPLOAD_FAILED', objectPath });
    return fail('STORAGE_UPLOAD_FAILED', 500);
  }

  await writeAudit(supabase, body, {
    status: 'authorized',
    objectPath,
    metadata: { signed_upload: true, path_contract: `${PUBLIC_PREFIX}/{license_hash}/{purpose}/{uuid}.${validation.extension}` }
  });

  return jsonResponse(200, {
    success: true,
    bucket: BUCKET,
    path: objectPath,
    public_url_path: objectPath,
    token: signedUpload.data.token,
    signed_url: signedUpload.data.signedUrl || null,
    max_size_bytes: validation.maxSizeBytes,
    mime_type: validation.mimeType,
    purpose: validation.purpose
  });
});
