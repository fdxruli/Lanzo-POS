// TEMPORARY TEST HARNESS ONLY, never deploy with an empty QA_DRIVER_TOKEN.
// The run injects a random capability into the bundle in memory, not source Git.
import { createBackend } from './broker.mjs';
import { serverSecrets } from './secrets.mjs';
const capability = Deno.env.get('QA_DRIVER_TOKEN');
const backend = createBackend({ url: Deno.env.get('SUPABASE_URL')!,
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, publicKey: Deno.env.get('SUPABASE_ANON_KEY')!, ...serverSecrets(Deno.env) });
Deno.serve(async req => {
  if (!capability || req.headers.get('x-lanzo-qa') !== capability || req.method !== 'POST') return new Response(null, { status: 403 });
  try {
    const body = await req.json();
    if (body.action === 'race') return Response.json(await backend.rpc('race', { p_id: body.id, p_probe: body.probe, p_action: body.operation }));
    if (body.action === 'fail_binding') {
      const faulty = createBackend({ url: Deno.env.get('SUPABASE_URL')!, serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        publicKey: Deno.env.get('SUPABASE_ANON_KEY')!, ...serverSecrets(Deno.env), fetcher: (url, init) => String(url).endsWith('/rpc/lanzo_ecom_bridge_qa_finish')
          ? Promise.resolve(new Response('{}', { status: 403 })) : fetch(url, init) });
      const r = await faulty.issue(body.capture);
      return Response.json({ status: r.status, code: r.body.code });
    }
    if (body.action === 'collect') return Response.json(await backend.collect());
    if (body.action === 'publish') return Response.json(await backend.rpc('publish', { p_id: body.id, p_probe: body.probe }));
    if (body.action === 'revoke') return Response.json(await backend.rpc('revoke', { p_id: body.id }));
    return new Response(null, { status: 403 });
  } catch { return Response.json({ code: 'QA_FAILED' }, { status: 500 }); }
});
