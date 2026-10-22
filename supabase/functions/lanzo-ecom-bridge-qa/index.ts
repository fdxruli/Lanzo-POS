import { createBackend } from './broker.mjs';
import { serverSecrets } from './secrets.mjs';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const backend = createBackend({ url, serviceKey, publicKey: Deno.env.get('SUPABASE_ANON_KEY')!, ...serverSecrets(Deno.env) });
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers });
  // This endpoint authenticates Lanzo credentials itself; verify_jwt=false.
  // Administrative QA controls additionally require exact server service key.
  const administrative = req.headers.get('Authorization') === `Bearer ${serviceKey}`;
  if (Number(req.headers.get('content-length') ?? 0) > 8192) return new Response(null, { status: 413, headers });
  try {
    const raw = await req.text();
    if (raw.length > 8192) return new Response(null, { status: 413, headers });
    const body = JSON.parse(raw);
    if (administrative && body.action === 'collect') return Response.json(await backend.collect(), { headers });
    if (administrative && body.action === 'rotate_vault') return Response.json(await backend.rotateVault(), { headers });
    if (administrative && ['publish', 'revoke'].includes(body.action)) {
      const args = body.action === 'publish' ? { p_id: body.id, p_probe: body.probe } : { p_id: body.id };
      return Response.json(await backend.rpc(body.action, args), { headers });
    }
    const result = await backend.issue(body);
    return Response.json(result.body, { status: result.status, headers });
  } catch {
    return Response.json({ code: 'DENIED' }, { status: 403, headers });
  }
});
