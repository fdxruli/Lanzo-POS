import fs from 'node:fs';

const fixturePath = 'docs/reports/fin01-r22/release-review/fixtures/production-ledger-versions.json';
const { versions } = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
if (versions.length !== 333 || new Set(versions).size !== 333) throw new Error('SYNTHETIC_VERSION_SNAPSHOT_INVALID');
if (Math.max(...versions.map(Number)).toString() !== '20261026214837') throw new Error('SYNTHETIC_VERSION_MAX_INVALID');
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const rows = versions.map((version) => `(${literal(version)},'historical-synthetic-fixture',ARRAY[]::text[])`).join(',\n');

process.stdout.write(`
-- Synthetic version-only copy of the read-only 2026-10-30 ledger snapshot.
-- It contains no migration bodies or business rows.
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
  version text not null,
  statements text[] null,
  name text null,
  created_by text null,
  idempotency_key text null,
  rollback text[] null,
  constraint schema_migrations_pkey primary key (version),
  constraint schema_migrations_idempotency_key_key unique (idempotency_key)
);
insert into supabase_migrations.schema_migrations(version,name,statements) values
${rows};
create schema fin01_lab;
create table fin01_lab.identity(identity_key text primary key, project_id text, baseline_sha text);
insert into fin01_lab.identity(identity_key,project_id,baseline_sha) values
  ('project','fin01-synthetic-replay','1a0d758d09310f2914c475c37d358c4cf885cc01'),
  ('base','fin01-synthetic-replay','1a0d758d09310f2914c475c37d358c4cf885cc01');
`);
