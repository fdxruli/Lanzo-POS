// Server-only HTTP boundary. Administrative QA controls have a dedicated
// capability; valid alternate Supabase service keys are not compared as strings.
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
async function boundedJson(req) {
  if (Number(req.headers.get('content-length') ?? 0) > 8192) throw new RangeError('BODY_SIZE');
  const reader = req.body?.getReader();
  if (!reader) throw new SyntaxError('BODY_REQUIRED');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new RangeError('BODY_SIZE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SyntaxError('BODY_OBJECT');
  return body;
}
export function createHandler(backend, { controlToken } = {}) {
  return async req => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return new Response(null, { status: 405, headers });
    const administrative = typeof controlToken === 'string' && controlToken.length >= 43
      && req.headers.get('x-lanzo-qa-control') === controlToken;
    try {
      const body = await boundedJson(req);
      if (['collect', 'rotate_vault', 'publish', 'revoke', 'approve_pilot', 'kill_switch', 'revoke_pilot'].includes(body.action)) {
        if (!administrative) return Response.json({ code: 'DENIED' }, { status: 403, headers });
        if (body.action === 'collect') return Response.json(await backend.collect(), { headers });
        if (body.action === 'rotate_vault') return Response.json(await backend.rotateVault(), { headers });
        if (body.action === 'approve_pilot') return Response.json(await backend.rpc('approve_pilot', {
          p_license_id: body.license_id,
          p_tenant_id: body.tenant_id,
          p_device_id: body.device_id,
          p_expires_at: body.expires_at,
          p_qa_run_id: body.qa_run_id,
          p_authorized_by: body.authorized_by,
          p_approval_ref: body.approval_ref
        }), { headers });
        if (body.action === 'kill_switch') {
          if (typeof body.active !== 'boolean') return Response.json({ code: 'DENIED' }, { status: 400, headers });
          return Response.json(await backend.rpc('set_kill_switch', {
            p_active: body.active,
            p_reason: body.reason
          }), { headers });
        }
        const args = body.action === 'publish'
          ? { p_id: body.id, p_probe: body.probe }
          : { p_id: body.id };
        const rpcName = body.action === 'revoke_pilot' ? 'revoke_pilot' : body.action;
        return Response.json(await backend.rpc(rpcName, args), { headers });
      }
      const result = await backend.issue(body);
      return Response.json(result.body, { status: result.status, headers });
    } catch (error) {
      if (error instanceof RangeError) return new Response(null, { status: 413, headers });
      return Response.json({ code: 'DENIED' }, { status: 403, headers });
    }
  };
}
