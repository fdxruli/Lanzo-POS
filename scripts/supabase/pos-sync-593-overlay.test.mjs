import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { run, validate } from './pos-sync-593-overlay.mjs';
const sha = v => createHash('sha256').update(v).digest('hex');
const old='20260101000000', extra='20260102000000', next='20260103000000';
const historic=old+'_old.sql', remote=extra+'_remote.sql', candidate=next+'_candidate.sql';
const expected=next;
const spec={count:2,last:extra,versionHash:sha(old+'\n'+extra+'\n'),remoteOnly:[extra],excluded:{},candidates:{[candidate]:sha('select 3;')}};
const historical=[{name:historic,version:old,sha256:sha('select 1;')},{name:remote,version:extra,sha256:sha('select 2;')}];
const canonical=[historical[0],{name:candidate,version:next,sha256:sha('select 3;')}];
const args={historical,canonical,expected,spec,gitBlob:()=>''};
test('pins remote baseline and exact candidate hashes',()=>{
  assert.deepEqual(validate(args),[candidate]);
  assert.throws(()=>validate({...args,expected:old}),/expected_versions/);
  assert.throws(()=>validate({...args,historical:historical.slice(0,1)}),/baseline/);
  assert.throws(()=>validate({...args,canonical:[...canonical,{name:'20260104000000_unrelated.sql',version:'20260104000000'}]}),/pending/);
  assert.throws(()=>validate({...args,canonical:[canonical[0],{...canonical[1],sha256:'bad'}]}),/hash mismatch/);
  assert.throws(()=>validate({...args,canonical:[...canonical,historical[1]]}),/remote-only/);
});
test('pins deliberately excluded file',()=>{
  const name='20251231000000_excluded.sql';
  const a={...args,canonical:[{name,version:'20251231000000'},...canonical],spec:{...spec,excluded:{[name]:'pinned'}},gitBlob:()=> 'pinned'};
  assert.deepEqual(validate(a),[candidate]);
  assert.throws(()=>validate({...a,gitBlob:()=> 'changed'}),/excluded file changed/);
});
test('copies only approved file and detects overlay drift',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pos593-test-'));
  try {
    const fetched=path.join(root,'fetched'), local=path.join(root,'repo','supabase','migrations'), snapshot=path.join(root,'snapshot.json');
    fs.mkdirSync(fetched);fs.mkdirSync(local,{recursive:true});
    fs.writeFileSync(path.join(fetched,historic),'select 1;');fs.writeFileSync(path.join(fetched,remote),'select 2;');
    fs.writeFileSync(path.join(local,historic),'select 1;');fs.writeFileSync(path.join(local,candidate),'select 3;');
    assert.deepEqual(run('prepare',fetched,local,snapshot,expected,spec),{historicalCount:2,pending:[candidate]});
    assert.equal(run('verify',fetched,local,snapshot,expected,spec).snapshotUnchanged,true);
    fs.writeFileSync(path.join(fetched,candidate),'select 4;');
    assert.throws(()=>run('verify',fetched,local,snapshot,expected,spec),/overlay changed/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
