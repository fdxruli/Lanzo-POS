import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { queryLoopbackPostgres } from './loopback-postgres-client.mjs';
assert.ok(process.argv.includes('--isolated-fixture'));
const q=sql=>queryLoopbackPostgres(sql,'fin01_cert_compatibility');
const dir='docs/reports/customer-payment-sale-allocations-v1/installation';
const manifest=JSON.parse(await fs.readFile(`${dir}/manifest.json`,'utf8'));
// Same ledger row type as the read-only Production catalog; synthetic rows only.
await q('create schema if not exists supabase_migrations;create table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text,idempotency_key text,rollback text[])');
const original=await fs.readFile(`${dir}/restore-original-functions.sql.txt`,'utf8');
await q(original);
const pre=await fs.readFile(`${dir}/preflight.sql`,'utf8');
assert.equal(JSON.parse(await q(pre)).all_ok,true);
const money=()=>q("select md5(string_agg(to_jsonb(l)::text,',' order by id)) from public.pos_customer_ledger l");
const before=await money();
const packet=await fs.readFile(`${dir}/apply-exact-version.sql`,'utf8');
// Inject a mismatching expected AFTER hash only; real candidate DDL executes
// before the in-transaction postflight aborts, proving complete rollback.
const badHash=manifest.expected_after[0].sha256;
await assert.rejects(()=>q(packet.replace(badHash,'0'.repeat(64))),/CUSTOMER_ALLOCATION_POSTFLIGHT_FAILED/);
assert.equal(JSON.parse(await q(pre)).all_ok,true,'failed install must restore all original definitions and leave no ledger row');
assert.equal(await money(),before,'installation must never modify historical financial rows');
await q(packet);
assert.equal(JSON.parse(await q(await fs.readFile(`${dir}/postflight.sql`,'utf8'))).all_ok,true);
assert.equal(await money(),before);
await assert.rejects(()=>q(packet),/CUSTOMER_ALLOCATION_PREFLIGHT_FAILED/);
await fs.writeFile('work/sql-compatibility/installation-results.json',JSON.stringify({negative_postflight_rollback:'PASS',exact_version_registration:'PASS',duplicate_install_rejected:'PASS',historical_ledger_unchanged:'PASS'},null,2));
console.log('PASS install packet: atomic postflight rollback, exact version, duplicate rejection, unchanged financial rows');
