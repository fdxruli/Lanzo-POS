import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const fixturePath = 'docs/reports/fin01-r22/release-review/fixtures/post-3d14-contract.json';
const migrationPath = 'supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql';
const expectedMigrationSha256 = '02eafa69f7a91343890ecc3cb2515cb37d4fcddb1de0f0fe187aa3db9a26a18b';
const migrationBytes = fs.readFileSync(migrationPath);
assert.equal(createHash('sha256').update(migrationBytes).digest('hex'), expectedMigrationSha256, 'CANONICAL_3D14_MIGRATION_SHA256_MISMATCH');

const contract = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
assert.equal(contract['3d14_migration_sha256'], expectedMigrationSha256, '3D14_CONTRACT_MIGRATION_SHA256_MISMATCH');
const profiles = contract.stages?.post_3d14;
assert.ok(profiles && typeof profiles === 'object', 'POST_3D14_PROFILE_REQUIRED');
assert.equal(Object.keys(profiles).length, 10, 'POST_3D14_PROFILE_COUNT_MISMATCH');

const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const rows = Object.entries(profiles).map(([signature, profile]) => {
  assert.match(signature, /^(?:(?:public|private)\.)?[a-z_][a-z0-9_]*\([a-z0-9_, ]+\)$/u, `POST_3D14_SIGNATURE_INVALID:${signature}`);
  assert.match(profile.md5_cr_removed, /^[0-9a-f]{32}$/u, `POST_3D14_HASH_INVALID:${signature}`);
  assert.equal(profile.owner, 'postgres', `POST_3D14_OWNER_INVALID:${signature}`);
  assert.equal(typeof profile.acl, 'string', `POST_3D14_ACL_INVALID:${signature}`);
  assert.equal(typeof profile.security_definer, 'boolean', `POST_3D14_SECURITY_MODE_INVALID:${signature}`);
  assert.ok(Array.isArray(profile.config), `POST_3D14_CONFIG_INVALID:${signature}`);
  return `(${lit(signature)},${lit(profile.md5_cr_removed)},${lit(profile.owner)},${lit(profile.acl)},${profile.security_definer},${lit(JSON.stringify(profile.config))}::jsonb)`;
}).join(',\n');

const sql = `
do $post_3d14_replay_scope$
begin
  if current_database() not like 'fin01_cert_%' then
    raise exception 'SYNTHETIC_DATABASE_REQUIRED' using errcode='P0001';
  end if;
end
$post_3d14_replay_scope$;

do $post_3d14_replay_profile$
declare e record; p pg_proc%rowtype;
begin
  for e in select * from (values
${rows}
  ) as expected(signature,body_hash,owner,acl,security_definer,config) loop
    select * into p from pg_proc where oid=to_regprocedure(e.signature);
    if p.oid is null
       or md5(replace(pg_get_functiondef(p.oid),chr(13),'')) is distinct from e.body_hash
       or pg_get_userbyid(p.proowner) is distinct from e.owner
       or coalesce(p.proacl::text,'') is distinct from e.acl
       or p.prosecdef is distinct from e.security_definer
       or coalesce(to_jsonb(p.proconfig),'[]'::jsonb) is distinct from e.config then
      raise exception 'POST_3D14_REPLAY_PROFILE_MISMATCH:%',e.signature using errcode='P0001';
    end if;
  end loop;
end
$post_3d14_replay_profile$;
`;

process.stdout.write(sql);
