import { createBackend } from './broker.mjs';
import { serverSecrets } from './secrets.mjs';
import { applicationKeysFromEnvironment, createHandler } from './handler.mjs';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const backend = createBackend({ url, serviceKey, publicKey: Deno.env.get('SUPABASE_ANON_KEY')!, ...serverSecrets(Deno.env) });
const applicationKeys = applicationKeysFromEnvironment(Deno.env);
// Lanzo credentials authenticate issuance/recovery; no global Auth hook.
Deno.serve(createHandler(backend, { controlToken: Deno.env.get('LANZO_ECOM_QA_CONTROL_TOKEN'), applicationKeys }));
