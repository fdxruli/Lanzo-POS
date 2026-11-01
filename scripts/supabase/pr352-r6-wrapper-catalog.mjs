import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalizePostgresAcl } from './pr352-r6-canonical-postgres-acl.mjs';

const authenticContract = Object.freeze({
  signature: 'public.pos_upsert_restaurant_order(text,text,text,text,jsonb,jsonb,text)',
  returnType: 'jsonb',
  language: 'plpgsql',
  owner: 'postgres',
  securityDefiner: true,
  config: ['search_path=""'],
  acl: '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}',
  prosrcSha256: '9e7512bfed56993512f48f6f88bdcda1ee89701f01c262af3d1b3a42e191a8c0',
});

export function assertRateLimitedRestaurantUpsertCatalog(rows, expected) {
  assert.equal(expected.signature, authenticContract.signature, 'Wrapper manifest signature must match the reviewed Production function');
  assert.equal(expected.returnType, authenticContract.returnType, 'Wrapper manifest return type must remain jsonb');
  assert.equal(expected.language, authenticContract.language, 'Wrapper manifest language must remain plpgsql');
  assert.equal(expected.owner, authenticContract.owner, 'Wrapper manifest owner must remain postgres');
  assert.equal(expected.securityDefiner, authenticContract.securityDefiner, 'Wrapper manifest must retain SECURITY DEFINER');
  assert.deepEqual(expected.config, authenticContract.config, 'Wrapper manifest search_path must remain empty');
  assert.deepEqual(canonicalizePostgresAcl(expected.acl), canonicalizePostgresAcl(authenticContract.acl),
    'Wrapper manifest ACL must match the reviewed Production ACL');
  assert.equal(expected.prosrcSha256, authenticContract.prosrcSha256, 'Wrapper manifest body fingerprint must remain authentic');

  assert.ok(Array.isArray(rows), 'Wrapper catalog result must be an array');
  assert.equal(rows.length, 1, 'The exact wrapper must exist once in the PostgreSQL catalog');
  const [actual] = rows;
  assert.equal(actual.signature, expected.signature, 'Installed wrapper signature differs from the expected signature');
  assert.equal(actual.returnType, expected.returnType, 'Installed wrapper return type differs from PostgreSQL catalog expectation');
  assert.equal(actual.language, expected.language, 'Installed wrapper language differs from PostgreSQL catalog expectation');
  assert.equal(actual.owner, expected.owner, 'Installed wrapper owner differs from expectation');
  assert.equal(actual.security_definer, expected.securityDefiner, 'Installed wrapper SECURITY DEFINER setting differs from expectation');
  assert.deepEqual(actual.config, expected.config, 'Installed wrapper configuration differs from expectation');
  assert.deepEqual(canonicalizePostgresAcl(actual.acl), canonicalizePostgresAcl(expected.acl),
    'Installed wrapper ACL differs from expectation');
  assert.equal(typeof actual.source, 'string', 'Installed wrapper must expose pg_proc.prosrc');
  const prosrcSha256 = createHash('sha256').update(actual.source).digest('hex');
  assert.equal(prosrcSha256, expected.prosrcSha256, 'Installed wrapper body fingerprint differs from Production');

  return actual;
}
