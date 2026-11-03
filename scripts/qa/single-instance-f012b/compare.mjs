import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(process.argv[2] || 'scripts/qa/single-instance-f012b/evidence');
const out = join(root,'pr127'); mkdirSync(out,{recursive:true});
const baseline = '5bfd0693224d92ae8957684bc85bc61ed6cbab90';
const read = (tag,file) => JSON.parse(readFileSync(join(root,tag,file),'utf8'));
const key = (file, name) => `${file.replace(/^.*\/(src|scripts|store|supabase)\//, '$1/')}::${name}`;
const resultMap = result => {
  const sample = result.testResults.find(s => s.name.includes('/src/'));
  const prefix = sample.name.slice(0, sample.name.indexOf('/src/'));
  const normalize = text => text.split(prefix).join('/tmp/lanzo-checkout');
  const map = new Map();
  for(const suite of result.testResults) for(const test of suite.assertionResults) {
    map.set(key(suite.name,normalize(test.fullName)), {status:test.status,firstError:normalize((test.failureMessages||[]).join('\n').split('\n')[0])});
  }
  return map;
};
const reports = {};
for(const file of ['regressions.json','global.json']) {
  const base=read('base',file), candidate=read('candidate',file);
  const a=resultMap(base),b=resultMap(candidate);
  const changed=[...a.keys()].filter(k=>JSON.stringify(a.get(k))!==JSON.stringify(b.get(k)));
  const added=[...b.keys()].filter(k=>!a.has(k)).map(k=>({key:k,...b.get(k)}));
  const counts=d=>Object.fromEntries(['numPassedTests','numFailedTests','numPendingTests','numTotalTests'].map(k=>[k,d[k]]));
  reports[file]={baseline,base:counts(base),candidate:counts(candidate),changed,added};
  assert.equal(changed.length,0); assert(added.every(t=>t.status==='passed'));
}
writeFileSync(join(root,'differential.json'),JSON.stringify(reports,null,2));
// The unmodified PR127 normalizer knows /tmp, /home and CI roots, not /workspace.
// Replace ONLY each checkout's absolute prefix, equally on both sides. Preserve
// statuses, errors, counts and raw files; this is not a failure classification.
const normalization=[];
for(const tag of ['base','candidate']) {
  const value=read(tag,'global.json');
  const suite=value.testResults.find(s=>s.name.includes('/src/'));
  const prefix=suite.name.slice(0,suite.name.indexOf('/src/'));
  const serialized=JSON.stringify(value);
  const normalized=serialized.split(prefix).join('/tmp/lanzo-checkout');
  writeFileSync(join(out,`${tag}.json`),normalized);
  normalization.push({tag,prefix,replacement:'/tmp/lanzo-checkout',replacements:serialized.split(prefix).length-1});
}
writeFileSync(join(out,'normalization.json'),JSON.stringify(normalization,null,2));
if(existsSync(join(out,'phase-one.json')) && !existsSync(join(out,'raw-phase-one.json'))) {
  renameSync(join(out,'phase-one.json'),join(out,'raw-phase-one.json'));
  if(existsSync(join(out,'targets.json')))renameSync(join(out,'targets.json'),join(out,'raw-targets.json'));
}
const commands=[['extract','--candidate',join(out,'candidate.json'),'--base',join(out,'base.json'),'--output',join(out,'phase-one.json')],
 ['classify','--phase',join(out,'phase-one.json'),'--base-focused',join(out,'focused/base'),'--candidate-focused',join(out,'focused/candidate'),'--output',join(out,'final.json')]];
for(const args of commands) {
  const r=spawnSync(process.execPath,['scripts/ci/pr127-global-comparison.mjs',...args],{encoding:'utf8'});
  writeFileSync(join(out,`${args[0]}.log`),`${r.stdout}\n${r.stderr}`);
  assert.equal(r.status,0,`PR127 ${args[0]} failed: ${r.stderr}`);
}
console.log(JSON.stringify(reports));
