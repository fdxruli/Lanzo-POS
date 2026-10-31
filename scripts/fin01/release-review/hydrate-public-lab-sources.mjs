import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const allowed = new Set(['--sources', '--acl', '--fixtures']);
const args = {};
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^(--[a-z-]+)=(.*)$/u);
  if (!match || !allowed.has(match[1]) || Object.hasOwn(args, match[1])) throw new Error(`UNSUPPORTED_ARGUMENT:${arg.split('=')[0]}`);
  args[match[1]] = match[2];
}
for (const key of allowed) if (!args[key]) throw new Error(`REQUIRED_ARGUMENT:${key}`);

const sourceBytes = await fs.readFile(args['--sources']);
const aclBytes = await fs.readFile(args['--acl']);
const publicSourceCommit = 'fd4975ea8b525f2e0b1a812e91142b24fd435dc3';
const expectedInputs = {
  'extra-functions.sql': 'f5759abdf3d8e88c01a16c44f36fcb89352f7503b16c919272b226fa78be6680',
  'fixture-defaults.sql': '5b6b5a12e6b862a0b6e85b0ef233e2d2fcb2eaf1385eb2d8282e81c5d11f1579',
  'isolated-cancel-payment.sql': 'fd74f08a411e7668cbdc3123ece4aa7927aea190dcb50bd281ca2742fe4495fa',
  'fixture-functions.json': '747b271063a3229bba46c7fe67b5f265288cbbf3d09a66bf58e12c9546be4758',
  'fixture-tables.json': 'c4e28e711410351269550ca723db1ccfba79c83692c47339c1d1c7922db88ab7',
  'post-3d14-contract.json': 'b54923a307872964390c65040d1c6ffe7d4c077588d712c3a448f2fbf8c660a6',
  'production-ledger-versions.json': '179e6e10561fcf7c7252076b970d461f6bd0ef13b248101502220bf05f82fb80'
};
const sourceHashes = {
  '02-function-sources.json': 'c4ec8bf02c7e31a7dcd0add10e8ca8a7d32cce57d3b87930fcafb06ae0b835a0',
  '06-function-acl.sql': '9ad2c226eb0abc3907168149cfcb9f3c023576ec69bae41527e974605addf8c5'
};
for (const [name, expected] of Object.entries(sourceHashes)) {
  const bytes = name === '02-function-sources.json' ? sourceBytes : aclBytes;
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `PUBLIC_FUNCTION_SOURCE_SHA256_MISMATCH:${name}`);
}

const fixtureDir = args['--fixtures'];
const sourceFiles = [];
const secretMarkers = [
  /sb_secret_[A-Za-z0-9_-]{20,}/iu,
  /service_role_key\s*[:=]\s*['"][^'"]{20,}/iu,
  /postgres(?:ql)?:\/\/[^\s:@/]+:[^@\s/]+@[^/\s]+/iu,
  /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u
];
for (const [name, bytes] of [['02-function-sources.json', sourceBytes], ['06-function-acl.sql', aclBytes]]) {
  const text = bytes.toString('utf8');
  assert.equal(Buffer.from(text, 'utf8').compare(bytes), 0, `PUBLIC_SOURCE_UTF8_MISMATCH:${name}`);
  for (const marker of secretMarkers) assert.ok(!marker.test(text), `PUBLIC_SOURCE_SECRET_MARKER:${name}:${marker}`);
}
for (const [name, expected] of Object.entries(expectedInputs)) {
  const bytes = await fs.readFile(path.join(fixtureDir, name));
  const actual = createHash('sha256').update(bytes).digest('hex');
  assert.equal(actual, expected, `PUBLIC_FIXTURE_SHA256_MISMATCH:${name}`);
  const text = bytes.toString('utf8');
  assert.equal(Buffer.from(text, 'utf8').compare(bytes), 0, `PUBLIC_FIXTURE_UTF8_MISMATCH:${name}`);
  for (const marker of secretMarkers) assert.ok(!marker.test(text), `PUBLIC_FIXTURE_SECRET_MARKER:${name}:${marker}`);
  sourceFiles.push({ path: name, sha256: actual, bytes: bytes.byteLength });
}

const sources = JSON.parse(sourceBytes.toString('utf8'));
const aclLines = aclBytes.toString('utf8').split(/\r?\n/u);
assert.ok(Array.isArray(sources) && sources.length === 238, 'PUBLIC_FUNCTION_SOURCE_COUNT_MISMATCH');

const pre3d14 = [
  ['public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)', '148918104b257982e3809a880bda7177', ['anon', 'authenticated', 'service_role']],
  ['public.pos_create_cloud_sale_cashier_inventory_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text)', '24843a289bbfdb692b4d18a10880c0b5', ['service_role']],
  ['public.pos_create_cloud_sale_credit_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)', 'c75dff5b4bab23bcb09f0c155df21f44', ['service_role']],
  ['public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)', '6b666116ae23029caef4e0ac373ddd6e', ['service_role']],
  ['public.pos_record_customer_payment(text,text,text,text,text,numeric,text,text,text,jsonb,text)', '134fb85a7b6df787e8c560c51bc7ab55', ['anon', 'authenticated', 'service_role']],
  ['public.pos_create_cloud_sale_cashier(text,text,text,text,jsonb,jsonb,jsonb,text,text)', '653ad817084920aa6adc1a60266ef37c', ['anon', 'authenticated', 'service_role']],
  ['public.pos_create_cloud_sale_cashier_inventory(text,text,text,text,jsonb,jsonb,jsonb,text,text)', '0c9dd22833c208dc20d78dd14bfd005d', ['anon', 'authenticated', 'service_role']],
  ['public.pos_create_cloud_sale_credit(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)', '59977522691c4008711e4361bcb1e0bd', ['anon', 'authenticated', 'service_role']]
];

const extraDependencies = [
  ['private', 'pos_cad6_normalize_text', '32bd67597e4cb10c41d5e283c33dedcb'],
  ['private', 'pos_cad6_product_is_perishable_blocking', '07caa6becc0eb51843ab96999011e525'],
  ['private', 'rest_inv5_modifier_inventory_quantity', '8373416aaed51834c4f5d462db5484a7'],
  ['private', 'rest_inv5_modifier_tracks_inventory', '4aa77b7d471b0134997156602a714549']
];
const md5 = (value) => createHash('md5').update(value.replaceAll('\r', ''), 'utf8').digest('hex');
function uniqueDefinition(hash, name, stage) {
  const matches = sources.filter((definition) => md5(definition) === hash);
  assert.equal(matches.length, 1, `${stage}_SOURCE_HASH_MATCH_COUNT:${name}`);
  const escapedName = name.replaceAll('.', '\\.');
  assert.match(matches[0], new RegExp(`^CREATE OR REPLACE FUNCTION ${escapedName}\\(`, 'u'), `${stage}_SOURCE_NAME_MISMATCH:${name}`);
  return matches[0].trimEnd();
}

const preSqlFunctions = [];
for (const [signature, expectedHash, expectedGrants] of pre3d14) {
  const name = signature.slice(0, signature.indexOf('('));
  const definition = uniqueDefinition(expectedHash, name, 'PRE_3D14');
  const aclMatches = aclLines.filter((line) => line.includes(`FUNCTION "public"."${name.slice('public.'.length)}"(`));
  assert.equal(aclMatches.length, 1, `PRE_3D14_ACL_SOURCE_MISSING:${name}`);
  const aclLine = aclMatches[0].trim();
  assert.match(aclLine, /^REVOKE ALL ON FUNCTION /u, `PRE_3D14_ACL_REVOKE_REQUIRED:${name}`);
  assert.match(aclLine, / FROM PUBLIC, anon, authenticated, service_role;/u, `PRE_3D14_ACL_PUBLIC_REVOKE_REQUIRED:${name}`);
  const grants = [...aclLine.matchAll(/GRANT EXECUTE ON FUNCTION .*? TO "([a-z_]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(grants, expectedGrants, `PRE_3D14_ACL_GRANTS_MISMATCH:${name}`);
  const expectedAcl = `{postgres=X/postgres,${grants.map((role) => `${role}=X/postgres`).join(',')}}`;
  preSqlFunctions.push({ signature, expectedHash, expectedAcl, definition, aclLine });
}

const dependencies = extraDependencies.map(([schema_name, proname, expectedHash]) => ({
  schema_name,
  proname,
  definition: uniqueDefinition(expectedHash, `${schema_name}.${proname}`, 'FIXTURE_DEPENDENCY')
}));

const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const preflightRows = preSqlFunctions.map(({ signature, expectedHash, expectedAcl }) => `(${lit(signature)},${lit(expectedHash)},${lit(expectedAcl)})`).join(',\n');
const verifyPre3d14 = [
  'do $pre_3d14_profile$',
  'declare e record; p pg_proc%rowtype;',
  'begin',
  `  for e in select * from (values\n${preflightRows}\n  ) as expected(signature,body_hash,acl) loop`,
  '    select * into p from pg_proc where oid=to_regprocedure(e.signature);',
  '    if p.oid is null',
  "       or md5(replace(pg_get_functiondef(p.oid),chr(13),'')) is distinct from e.body_hash",
  "       or pg_get_userbyid(p.proowner) is distinct from 'postgres'",
  "       or coalesce(p.proacl::text,'') is distinct from e.acl",
  '       or p.prosecdef is distinct from true',
  `       or not ('search_path=""' = any(coalesce(p.proconfig,array[]::text[])))`,
  "    then raise exception 'PRE_3D14_SOURCE_PROFILE_MISMATCH:%',e.signature using errcode='P0001'; end if;",
  '  end loop;',
  'end;',
  '$pre_3d14_profile$;'
].join('\n');
const preSql = [
  'begin;',
  'set local check_function_bodies = off;',
  'set local search_path = pg_catalog, public, private;',
  ...preSqlFunctions.map(({ definition }) => `${definition};`),
  ...preSqlFunctions.map(({ aclLine }) => aclLine),
  verifyPre3d14,
  'commit;'
].join('\n\n');

await fs.mkdir(args['--fixtures'], { recursive: true });
await fs.writeFile(path.join(args['--fixtures'], 'fixture-final-dependencies.json'), `${JSON.stringify(dependencies, null, 2)}\n`);
await fs.writeFile(path.join(args['--fixtures'], 'pre-3d14-source-functions.sql'), `${preSql}\n`);
const generatedFiles = [];
for (const name of ['fixture-final-dependencies.json', 'pre-3d14-source-functions.sql']) {
  const bytes = await fs.readFile(path.join(args['--fixtures'], name));
  const actual = createHash('sha256').update(bytes).digest('hex');
  const content = bytes.toString('utf8');
  for (const marker of secretMarkers) assert.ok(!marker.test(content), `GENERATED_FIXTURE_SECRET_MARKER:${name}:${marker}`);
  generatedFiles.push({ path: name, sha256: actual, bytes: bytes.byteLength });
}
const summary = {
  result: 'PASS',
  source_commit: publicSourceCommit,
  evidence_commit: '9853236a31d55d9cb6542364c30e9e06be6eddd3',
  evidence_zip_sha256: 'a55890947a22dc3601100e443ad23c278ba53e17a2dc3f35df477f91f7d98fd3',
  source_hashes: sourceHashes,
  fixture_sources: sourceFiles,
  generated_runtime_files: generatedFiles,
  pre_3d14_exact_functions: preSqlFunctions.length,
  support_dependencies: dependencies.length,
  secret_markers: 0
};
await fs.mkdir(path.join(process.cwd(), 'artifacts/fin01'), { recursive: true });
await fs.writeFile(path.join(process.cwd(), 'artifacts/fin01/fixture-source-manifest.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...summary, fixture_sources: sourceFiles.length, generated_runtime_files: generatedFiles.length })}\n`);
