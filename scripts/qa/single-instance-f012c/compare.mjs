import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]||'scripts/qa/single-instance-f012c/evidence');
const read=(tag,name)=>JSON.parse(readFileSync(join(root,tag,name),'utf8'));
const baseline='d007bfe1cc2569391a2959ddff73bb2ed1e9c8ff';
const normalization=[];
const normalized=(d,tag)=>{
 const sample=d.testResults.find(s=>s.name.includes('/src/'));const prefix=sample.name.slice(0,sample.name.indexOf('/src/'));
 const raw=JSON.stringify(d);normalization.push({tag,prefix,replacement:'/tmp/lanzo-checkout',replacements:raw.split(prefix).length-1});
 return JSON.parse(raw.split(prefix).join('/tmp/lanzo-checkout'));
};
const map=d=>new Map(d.testResults.flatMap(s=>s.assertionResults.map(t=>[`${s.name}::${t.fullName}`,{status:t.status,error:(t.failureMessages||[]).join('\n').split('\n')[0]}])));
const reports={};
for(const name of ['regressions.json','global.json']){
 const a=normalized(read('base',name),`base/${name}`),b=normalized(read('candidate',name),`candidate/${name}`),am=map(a),bm=map(b);
 const changed=[...am].filter(([k,v])=>JSON.stringify(v)!==JSON.stringify(bm.get(k)));const added=[...bm].filter(([k])=>!am.has(k));
 const counts=d=>Object.fromEntries(['numPassedTests','numFailedTests','numPendingTests','numTotalTests'].map(k=>[k,d[k]]));
 reports[name]={baseline,base:counts(a),candidate:counts(b),changed,added};
 writeFileSync(join(root,'differential.json'),JSON.stringify(reports,null,2));
 assert.equal(changed.length,0,`Changed baseline results in ${name}`);assert(added.every(([,v])=>v.status==='passed'));
 if(name==='global.json'){
  const out=join(root,'pr127');mkdirSync(out,{recursive:true});writeFileSync(join(out,'base.json'),JSON.stringify(a));writeFileSync(join(out,'candidate.json'),JSON.stringify(b));
 }
}
writeFileSync(join(root,'normalization.json'),JSON.stringify(normalization,null,2));
const out=join(root,'pr127');
for(const args of [['extract','--candidate',join(out,'candidate.json'),'--base',join(out,'base.json'),'--output',join(out,'phase-one.json')],['classify','--phase',join(out,'phase-one.json'),'--base-focused',join(out,'focused/base'),'--candidate-focused',join(out,'focused/candidate'),'--output',join(out,'final.json')]]){
 const r=spawnSync(process.execPath,['scripts/ci/pr127-global-comparison.mjs',...args],{encoding:'utf8'});writeFileSync(join(out,`${args[0]}.log`),`${r.stdout}\n${r.stderr}`);assert.equal(r.status,0,`${args[0]} failed; inspect preserved log`);
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(reports).map(([k,v])=>[k,{base:v.base,candidate:v.candidate,changed:v.changed.length,added:v.added.length}]))));
