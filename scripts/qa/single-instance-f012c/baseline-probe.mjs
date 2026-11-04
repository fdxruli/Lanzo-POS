import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const baseline=resolve(process.argv[2]),out=resolve('scripts/qa/single-instance-f012c/evidence');
assert.equal(spawnSync('git',['rev-parse','HEAD'],{cwd:baseline,encoding:'utf8'}).stdout.trim(),'d007bfe1cc2569391a2959ddff73bb2ed1e9c8ff');
let source=readFileSync('scripts/qa/single-instance-f012c/background-lifetime.test.js','utf8').split("it('BGX-01")[0];
source=source.replace("const dir='scripts/qa/single-instance-f012c/evidence'",`const dir=${JSON.stringify(out)}`).replace('bgx-traces.json','baseline-probe-traces.json');
source+=`
it('CE-PROFILE-ACTOR-01 baseline old response writes after actor change',async()=>{
 const x=setup(),d=deferred();m.rpc.mockReturnValue(d.promise);const p=x.load();await tick();m.actor={...m.actor,actorId:'admin-B',generation:2};d.resolve(response('Old'));await p;expect(x.get().companyProfile.name).toBe('Old');expect(m.writes).toHaveLength(2);expect(m.writes[0].actor.actorId).toBe('admin-B');
});
it('CE-PROFILE-RAW-03 baseline public profile timeout leaves raw outside direct scope',async()=>{
 const x=setup(),s=scopes(),d=deferred();m.rpc.mockReturnValue(d.promise);const p=x.load({lifecycle:s});await advance(8000);await p;expect(m.rpc).toHaveBeenCalledTimes(1);expect(s.getSnapshot().pending).toBe(0);await s.drain();d.resolve(response('Late'));await tick();expect(x.get().companyProfile).toBeNull();
});
it('CE-SHARED-OWNER-02 baseline observed owner still gives consumer UNKNOWN',async()=>{
 const owner=scopes(),consumer=scopes(),d=deferred();m.rpc.mockReturnValue(d.promise);const a=revalidateLicense('counterexample-shared',{bootstrapLifecycle:owner});await tick();const b=revalidateLicense('counterexample-shared',{bootstrapLifecycle:consumer});expect(consumer.getSnapshot().unknown).toContain('shared_license_revalidation_owner');d.resolve({data:{valid:false,reason:'synthetic'},error:null});await Promise.all([a,b]);
});
it('CE-TOKEN-04 baseline token recovery writes old credential before context rejection',async()=>{
 const d=deferred();localStorage.setItem('lanzo_license',JSON.stringify({data:{license_key:'baseline-token',new_security_token:'synthetic-old-token'}}));m.load.mockImplementation(async(_store,key)=>key==='device_security_token'?d.promise:null);m.rpc.mockResolvedValue({data:{valid:false,reason:'synthetic'},error:null});const p=revalidateLicense('baseline-token');const a=expect(p).rejects.toThrow('LICENSE_VALIDATION_CONTEXT_STALE');await tick();m.actor={...m.actor,generation:2,actorId:'admin-B'};d.resolve(null);await a;expect(m.save).toHaveBeenCalledWith('sync_cache',{key:'device_security_token',value:'synthetic-old-token'});
});

`;
const dir=join(baseline,'scripts/qa/single-instance-f012c');mkdirSync(dir,{recursive:true});const test=join(dir,'baseline-probe.test.js');writeFileSync(test,source);
try{
 const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',test,'--maxWorkers=1','--reporter=json',`--outputFile=${join(out,'baseline-probe.json')}`],{cwd:baseline,encoding:'utf8',maxBuffer:20*1024*1024});writeFileSync(join(out,'baseline-probe.log.gz'),gzipSync(`${r.stdout}\n${r.stderr}`));writeFileSync(join(out,'baseline-probe-exit.json'),JSON.stringify({baseline,exitCode:r.status,scope:'PASS means reproduction of the baseline limitations, not safety approval.'},null,2));process.exitCode=r.status??1;
}finally{unlinkSync(test);}
