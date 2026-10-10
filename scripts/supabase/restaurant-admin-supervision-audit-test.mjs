import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';

// Run only after restaurant-admin-supervision-test.mjs on its disposable DB.
// Baseline must be a fresh pg_get_functiondef/ACL export from the audited project.
assert.ok(process.argv.includes('--isolated-fixture'));
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.PGDATABASE, 'lanzo_admin_supervision_fixture');
assert.ok(process.env.PGPORT && process.env.PSQL_BIN);
const baselinePath = process.argv[process.argv.indexOf('--baseline') + 1];
assert.ok(process.argv.includes('--baseline') && baselinePath);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
assert.equal(baseline.length, 7);
const legacyPath = process.argv[process.argv.indexOf('--legacy') + 1];
assert.ok(process.argv.includes('--legacy') && legacyPath);
const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'));
const args = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
const execute = (query) => {
  writeFileSync('.tmp-critical-audit-query.sql', query);
  return spawnSync(process.env.PSQL_BIN, [...args, '-f', '.tmp-critical-audit-query.sql'], { encoding: 'utf8', windowsHide: true });
};
const sql = (query) => { const r = execute(query); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const rejected = (query, code) => { const r = execute(query); assert.notEqual(r.status, 0); assert.match(r.stderr, new RegExp(code)); };
const run = (query, name) => new Promise(resolve => {
  const child = spawn(process.env.PSQL_BIN, [...args, '-c', query], { env: { ...process.env, PGAPPNAME: name }, windowsHide: true });
  let output = ''; child.stdout.on('data', x => { output += x; }); child.stderr.on('data', x => { output += x; });
  child.on('exit', code => resolve({ code, output }));
});
const license = '00000000-0000-0000-0000-000000000001';
const version = '2026-10-01T00:00:00Z';
const seed = id => sql(`insert into public.pos_restaurant_orders(id,license_id,local_order_id,sale_id,created_by_device_id,created_by_staff_user_id,updated_at,total)
  values('${id}','${license}','${id}','${id}','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000aa','${version}',50)`);
const edit = (id, itemId, expected = true, key = id) => `select public.pos_upsert_restaurant_order_unlimited('fixture-license','A','valid','staff-a',
  '${JSON.stringify({ localOrderId: id, saleId: id, total: 50, ...(expected ? { expectedParentVersion: version } : {}) })}',
  '${JSON.stringify([{ id: itemId, localLineId: 'line', productName: 'Attacker value', quantity: 1, unitPrice: 50, lineTotal: 50 }])}','audit-${key}')`;

const migration = readFileSync('supabase/migrations/20261010013258_restaurant_admin_supervision_r1.sql', 'utf8');
const proposedUpsert = migration.match(/CREATE OR REPLACE FUNCTION public\.pos_upsert_restaurant_order_unlimited[\s\S]*?\$function\$\s*;/i)[0];
seed('audit-legacy-payload');
sql(baseline.find(x => x.proname === 'pos_upsert_restaurant_order_unlimited').definition);
sql(edit('audit-legacy-payload', 'audit-legacy-line', false, 'baseline'));
sql(proposedUpsert);
rejected(edit('audit-legacy-payload', 'audit-legacy-line', false, 'candidate'), 'RESTAURANT_ORDER_VERSION_REQUIRED');

const races = [];
for (const [index, victimLicense] of [license, '00000000-0000-0000-0000-000000000002'].entries()) {
  const attacker = `audit-attacker-${index}`, victim = `audit-victim-${index}`, item = `audit-shared-${index}`;
  seed(attacker);
  const name = `audit-item-owner-${index}`;
  const winner = run(`begin; insert into public.pos_restaurant_order_items(id,license_id,restaurant_order_id,product_name)
    values('${item}','${victimLicense}','${victim}','Victim value'); select pg_sleep(2); commit;`, name);
  let waiting = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    waiting = sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event='PgSleep')`) === 't';
    if (waiting) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok(waiting);
  const loser = run(edit(attacker, item), `audit-item-attacker-${index}`);
  const [a, b] = await Promise.all([winner, loser]);
  assert.equal(a.code, 0, a.output); assert.notEqual(b.code, 0, b.output); assert.match(b.output, /RESTAURANT_TABLE_SCOPE_DENIED/);
  assert.equal(sql(`select product_name from public.pos_restaurant_order_items where id='${item}'`), 'Victim value');
  assert.equal(sql(`select count(*) from private.restaurant_table_interventions where order_id='${attacker}'`), '0');
  races.push({ scope: index === 0 ? 'CROSS_PARENT' : 'CROSS_TENANT', result: 'REJECTED_NO_EFFECT' });
}

// Audit the actual deployed legacy status route, including its current terminal
// trigger helpers. Auth is still the documented fixture; this is not integrated QA.
for (const name of ['is_restaurant_order_status', 'protect_restaurant_pos_cancellation_v1',
  'protect_restaurant_paid_sale_id_v1', 'pos_update_restaurant_order_status_unlimited']) {
  sql(legacy.find(row => row.proname === name).definition);
}
sql(`create trigger audit_pos_cancellation_terminal before update on public.pos_restaurant_orders
  for each row execute function private.protect_restaurant_pos_cancellation_v1();
  create trigger audit_paid_sale_immutable before update of paid_sale_id,payment_status on public.pos_restaurant_orders
  for each row execute function private.protect_restaurant_paid_sale_id_v1();`);
seed('audit-legacy-foreign');
const legacyCancel = JSON.parse(sql(`select public.pos_update_restaurant_order_status_unlimited(
  'fixture-license','A','valid','staff-b','audit-legacy-foreign','cancelled','audit-legacy-cancel')`));
assert.equal(legacyCancel.success, true);
assert.equal(sql("select status from public.pos_restaurant_orders where id='audit-legacy-foreign'"), 'cancelled');
assert.equal(sql("select count(*) from private.restaurant_table_interventions where order_id='audit-legacy-foreign'"), '0');

// Restore all replaced definitions and effective endpoint ACLs in one local txn.
// Keep new tables/audit evidence and revoke the new endpoint. This is a corrective
// containment exercise, not certification of post-settlement production rollback.
let rollback = 'begin;\n';
for (const row of baseline) {
  rollback += row.definition + ';\n';
  const signature = `${row.schema}.${row.proname}(${row.identity_args.replace(/\bp_\w+\s+/g, '')})`;
  rollback += `revoke all on function ${signature} from public,anon,authenticated,service_role;\n`;
  for (const role of ['anon', 'authenticated', 'service_role']) {
    if (row.proacl.includes(`${role}=X/`)) rollback += `grant execute on function ${signature} to ${role};\n`;
  }
}
rollback += 'revoke all on function public.pos_restaurant_table_capabilities_v1(text,text,text,text,text) from public,anon,authenticated,service_role;\ncommit;';
const auditCount = sql('select count(*) from private.restaurant_table_interventions');
sql(rollback);
for (const row of baseline) {
  const signature = `${row.schema}.${row.proname}(${row.identity_args.replace(/\bp_\w+\s+/g, '')})`;
  const restored = JSON.parse(sql(`select json_build_object('definition',pg_get_functiondef('${signature}'::regprocedure),
    'anon',has_function_privilege('anon','${signature}','execute'),
    'authenticated',has_function_privilege('authenticated','${signature}','execute'),
    'service_role',has_function_privilege('service_role','${signature}','execute'))`));
  assert.equal(restored.definition, row.definition);
  for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(restored[role], row.proacl.includes(`${role}=X/`));
}
assert.equal(sql('select count(*) from private.restaurant_table_interventions'), auditCount);
assert.equal(sql("select has_function_privilege('anon','public.pos_restaurant_table_capabilities_v1(text,text,text,text,text)','execute')"), 'f');
sql(edit('audit-legacy-payload', 'audit-legacy-line', false, 'rollback'));
const output = { productionFrontendCompatibility: 'FAIL_LEGACY_UPDATE_REQUIRES_NEW_ARGUMENT', itemIdRaces: races,
  legacyKitchenCancellation: 'FOREIGN_STAFF_CANCELLATION_WITHOUT_INTERVENTION_AUDIT_REPRODUCED',
  rollbackDefinitionsAndAcl: 'PASS_7_OF_7', rollbackDataPreservation: 'PASS',
  rollbackOperationalCertification: 'UNVERIFIED_AFTER_REAL_SETTLEMENT', integratedCompatibility: 'UNVERIFIED',
  authenticationAndFinancialLeaves: 'CONTROLLED_TEST_DOUBLES' };
writeFileSync('.tmp-critical-audit-results.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output));
