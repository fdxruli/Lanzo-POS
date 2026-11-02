// Focused deployment tests adapted from the existing R5 overlay contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { metadataFingerprint, validateAndOverlay, verifySnapshot } from './pr352-prepare-production-ledger-overlay.mjs';
import { assertCanonicalLedger } from './verify-canonical-migration-ledger.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const release=JSON.parse(await readFile(path.join(root,'docs/fixtures/restaurant-backend-release.json')));
const sha=x=>createHash('sha256').update(x).digest('hex');
const versions=release.candidates.map(c=>c.file.slice(0,14));

async function fixture(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'pr352-release-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const canonicalDirectory=path.join(dir,'supabase/migrations');
  const fetchedDirectory=path.join(dir,'private-release/migrations');
  await mkdir(canonicalDirectory,{recursive:true}); await mkdir(fetchedDirectory,{recursive:true});
  execFileSync('git',['init','--quiet',dir]);
  execFileSync('git',['-C',dir,'config','core.autocrlf','false']);
  await writeFile(path.join(dir,'.gitattributes'),'*.sql text eol=lf\n');
  const threeD14='20261026214837_restaurant_sale_dispatcher_guard_3d14.sql';
  const rows=[];
  for(const [file,bytes,remoteOnly] of [
    ['20261021045416_synthetic_qa_history.sql',Buffer.from('select 42;\n'),true],
    ['20261026214820_synthetic_prior.sql',Buffer.from('select 1;\n'),false],
    [threeD14,await readFile(path.join(root,'supabase/migrations',threeD14)),false],
  ]) {
    await writeFile(path.join(fetchedDirectory,file),bytes);
    if(!remoteOnly)await writeFile(path.join(canonicalDirectory,file),bytes);
    rows.push({file,version:file.slice(0,14),name:file.slice(15,-4),bytes:bytes.length,sha256:sha(bytes)});
  }
  const excluded='20261008180000_preview_only.sql';
  await writeFile(path.join(canonicalDirectory,excluded),'-- excluded synthetic Preview\n');
  const gitBlob=execFileSync('git',['-C',dir,'hash-object','--no-filters',path.join(canonicalDirectory,excluded)],{encoding:'utf8'}).trim();
  for(const c of release.candidates)await writeFile(path.join(canonicalDirectory,c.file),await readFile(path.join(root,'supabase/migrations',c.file)));
  const manifest={...release,baseline:{...release.baseline,count:3,metadataSha256:metadataFingerprint(rows)},
    historicalRemoteOnly:[{version:rows[0].version,name:rows[0].name,fetchSqlSha256:rows[0].sha256}],
    excludedCanonicalFiles:[{file:excluded,gitBlob}]};
  const manifestPath=path.join(dir,'manifest.json'),snapshotPath=path.join(dir,'snapshot.json');
  await writeFile(manifestPath,JSON.stringify(manifest));
  return {manifestPath,snapshotPath,canonicalDirectory,fetchedDirectory,expectedVersions:versions.join(','),manifest,rows,excluded};
}

test('private fetched overlay selects exactly archive and bridge, without historical or Preview replay',async t=>{
  const f=await fixture(t);
  const result=await validateAndOverlay(f);
  assert.deepEqual(result.pending,release.candidates.map(c=>c.file));
  assert.equal(result.historicalFiles,3); assert.equal(result.historicalSqlExecuted,false);
  assert.equal((await readdir(f.fetchedDirectory)).length,5);
  assert.equal((await readdir(f.fetchedDirectory)).includes(f.excluded),false);
  assert.deepEqual(assertCanonicalLedger({local:[...f.rows.map(r=>r.version),...versions],remote:f.rows.map(r=>r.version),expected:versions}),
    {pending:versions,remoteOnly:[]});
  assert.deepEqual(assertCanonicalLedger({local:[...f.rows.map(r=>r.version),...versions],remote:[...f.rows.map(r=>r.version),...versions],expected:versions,afterApply:true}),
    {pending:[],remoteOnly:[]});
  assert.equal((await verifySnapshot(f)).snapshotUnchanged,true);
});

test('aggregate fingerprint pins every identity, byte length and individual SQL hash',()=>{
  const rows=[{version:'20000101000000',name:'a',bytes:1,sha256:'a'.repeat(64)}];
  assert.equal(metadataFingerprint(rows),sha('20000101000000|a|1|'+'a'.repeat(64)+'\n'));
  for(const field of ['version','name','bytes','sha256'])assert.notEqual(metadataFingerprint([{...rows[0],[field]:field==='bytes'?2:'changed'}]),metadataFingerprint(rows));
});

test('rejects changed, missing, extra or duplicated fetched historical entries before overlay',async t=>{
  for(const mutation of ['changed','missing','extra','duplicate']) {
    const f=await fixture(t),file=path.join(f.fetchedDirectory,f.rows[0].file);
    if(mutation==='changed')await writeFile(file,'select 99;\n');
    if(mutation==='missing')await rm(file);
    if(mutation==='extra')await writeFile(path.join(f.fetchedDirectory,'20261026214838_unknown.sql'),'select 0;');
    if(mutation==='duplicate')await writeFile(path.join(f.fetchedDirectory,'20261021045416_another.sql'),'select 0;');
    await assert.rejects(validateAndOverlay(f),/fingerprint|duplicate fetched version/);
    for(const c of release.candidates)assert.equal((await readdir(f.fetchedDirectory)).includes(c.file),false);
  }
});

test('rejects candidate drift and a changed explicitly excluded historical source',async t=>{
  for(const file of [release.candidates[0].file,release.candidates[1].file,'excluded']) {
    const f=await fixture(t); await writeFile(path.join(f.canonicalDirectory,file==='excluded'?f.excluded:file),'select changed;');
    await assert.rejects(validateAndOverlay(f),/candidate fingerprint mismatch|excluded historical file changed/);
  }
});

test('unknown canonical pending migrations and v2 cannot enter the package',async t=>{
  const f=await fixture(t);
  await writeFile(path.join(f.canonicalDirectory,'20990101000000_supervision_v2.sql'),'select 2;');
  await assert.rejects(validateAndOverlay(f),/unexpected canonical pending migration/);
});

test('only exact expected versions are admitted, not subsets or NONE',async t=>{
  const f=await fixture(t);
  for(const expectedVersions of ['NONE',versions[0],versions[1],[...versions].reverse().join(','),versions.join(',')+',20990101000000'])
    await assert.rejects(validateAndOverlay({...f,expectedVersions}),/expected_versions must be exactly/);
});

test('missing or additional historical exceptions and changed 3D.14 fail closed',async t=>{
  const f=await fixture(t);
  await writeFile(f.manifestPath,JSON.stringify({...f.manifest,historicalRemoteOnly:[]}));
  await assert.rejects(validateAndOverlay(f),/explicitly verified historical/);
  await writeFile(f.manifestPath,JSON.stringify(f.manifest));
  await writeFile(path.join(f.canonicalDirectory,'20261026214837_restaurant_sale_dispatcher_guard_3d14.sql'),'select changed;');
  await assert.rejects(validateAndOverlay(f),/historical 3D.14 changed/);
});

test('rechecks all overlay bytes, manifest and source candidates immediately before apply',async t=>{
  for(const mutation of ['overlay','manifest','source']) {
    const f=await fixture(t); await validateAndOverlay(f);
    if(mutation==='overlay')await writeFile(path.join(f.fetchedDirectory,release.candidates[1].file),'select changed;');
    if(mutation==='manifest')await writeFile(f.manifestPath,JSON.stringify({...f.manifest,note:'changed'}));
    if(mutation==='source')await writeFile(path.join(f.canonicalDirectory,release.candidates[1].file),'select changed;');
    await assert.rejects(verifySnapshot(f),/overlay changed|manifest changed|candidate fingerprint mismatch/);
  }
});

test('release SQL keeps exactly the accepted archive and bridge bodies and v1/Admin OFF contract',async()=>{
  assert.equal(release.candidates[0].sha256,'9e89b368be660dd31a975a5afd87082944bb0601f045c33be6e134476e2cf5ab');
  assert.equal(release.candidates[1].sha256,'555c718c18da25e0fb6d7ed02ff68f16f04129530707ff7f9b81ab4534e9c97f');
  for(const c of release.candidates){const bytes=await readFile(path.join(root,'supabase/migrations',c.file));assert.equal(sha(bytes),c.sha256);assert.equal(bytes.length,c.bytes);}
  const bridge=await readFile(path.join(root,'supabase/migrations',release.candidates[1].file),'utf8');
  assert.match(bridge,/contract_version integer not null default 1/);
  assert.match(bridge,/legacyWritesAllowed.*contract_version=1/);
  for(const name of ['pos_restaurant_cloud_contract_v1','pos_restaurant_transition_table_capabilities_v1','pos_upsert_restaurant_order_versioned_v1'])assert.ok(bridge.includes('function public.'+name+'('));
  assert.doesNotMatch(bridge,/staff_session_id'[^\n]*is distinct from/);
  assert.doesNotMatch(bridge,/update private\.restaurant_cloud_contract_state set contract_version\s*=\s*2/);
  assert.equal(release.candidates[1].generatedByCli,'2.79.0');
});

test('existing production workflow retains manual approval, exact main, project and ledger guards',async()=>{
  const workflow=await readFile(path.join(root,'.github/workflows/supabase-production-migrations.yml'),'utf8');
  assert.match(workflow,/workflow_dispatch:/); assert.doesNotMatch(workflow,/^  push:/m);
  for(const text of ['contents: read','environment: production','refs/heads/main','odlrhijtfyavryeqivaa','APPLY ${EXPECTED_VERSIONS}',
    'migration fetch --linked','verify-canonical-migration-ledger.mjs','db push --dry-run --linked','after-apply','snapshot.private.json'])assert.ok(workflow.includes(text),text);
  assert.doesNotMatch(workflow,/migration repair|--include-all|--include-seed|--include-roles|upload-artifact/);
  assert.ok(workflow.includes('DRY_RUN NONE did not prove zero migrations to apply'));
  assert.ok(workflow.indexOf('Remove private historical SQL')>workflow.indexOf('Verify final canonical ledger'));
});
