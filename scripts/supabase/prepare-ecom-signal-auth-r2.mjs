import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Generates SQL only. No credentials, network connection, CLI push or deploy.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const project = args[args.indexOf('--project-ref') + 1];
if (!args.includes('--project-ref') || project !== 'odlrhijtfyavryeqivaa') {
  throw new Error('Explicit authorized production ref required: --project-ref odlrhijtfyavryeqivaa');
}
const candidateDir = resolve(root, 'supabase/candidates/ecom-signal-auth-r2');
const candidate = readFileSync(resolve(candidateDir, '20261020220455_ecom_signal_authorization_qa_foundation_r2.sql'), 'utf8');
const tests = readFileSync(resolve(root, 'supabase/tests/ecom_signal_authorization_qa_r2_test.sql'), 'utf8');
const proposal = args.includes('--with-acl-proposal');
const acl = proposal ? readFileSync(resolve(candidateDir, 'public-rpc-acl-proposal.sql'), 'utf8') : '';
const verifyAcl = proposal ? `
do $verify$
declare remaining integer; retained integer;
begin
  select count(*) into remaining from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and has_function_privilege('lanzo_ecom_signal_receiver',p.oid,'EXECUTE');
  select count(*) into retained from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('admin_list_staff_users','admin_create_staff_user',
    'admin_update_staff_user','pos_get_cash_station_state','pos_admin_close_cash_session','pos_admin_adopt_legacy_cash_session')
    and has_function_privilege('anon',p.oid,'EXECUTE')
    and has_function_privilege('authenticated',p.oid,'EXECUTE')
    and has_function_privilege('service_role',p.oid,'EXECUTE');
  perform pg_temp.ecom_check('PROPOSAL-no-privileged-rpc-execute',remaining=0);
  perform pg_temp.ecom_check('PROPOSAL-six-existing-consumers-retained',retained=6);
end;
$verify$;
select jsonb_build_object('sql_only',true,'acl_proposal_rolled_back',true,
  'results',(select jsonb_agg(to_jsonb(r) order by id) from ecom_r2_results r)) as qa_proposal;
` : '';
const sql = `-- Authorized project: ${project}; NEVER remove final ROLLBACK.
begin;
set local statement_timeout='25s';
set local lock_timeout='2s';
${candidate}
${tests}
${acl}
${verifyAcl}
rollback;
`;
const out = resolve(root, '.tmp/ecom-signal-auth-r2', proposal ? 'transaction-with-acl-proposal.sql' : 'transaction.sql');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, sql.replace(/\r\n/g, '\n'));
console.log(JSON.stringify({ project, out, sqlOnly: true, executed: false, sharedAclProposal: proposal }));
