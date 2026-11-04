import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,statSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
mkdirSync('scripts/qa/single-instance-f012d/evidence',{recursive:true});
const baseline='c20e3538c8be897dc7b3c937429000ac8006f42d';
const allowed=['src/services/sync/posSyncBootstrapAutoCoordinator.js','src/services/sync/posSyncBootstrapCoordinator.js','src/services/sync/posSyncOrchestrator.js','src/services/financial/financialIntentRecoveryCoordinator.js'].sort();
const newSource='src/services/sync/syncExecutionScope.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const rows=execFileSync('git',['ls-tree','-r','--name-only',baseline],{encoding:'utf8'}).trim().split('\n')
 .filter(path=>/^(src|public|store|supabase|\.github)\//.test(path)||/^(package.*json|vite.*|vercel.*)$/.test(path))
 .map(path=>({path,before:hash(execFileSync('git',['show',`${baseline}:${path}`],{maxBuffer:64*1024*1024})),after:hash(readFileSync(path))}));
const changed=rows.filter(row=>row.before!==row.after);assert.deepEqual(changed.map(row=>row.path).sort(),allowed);
const assets=[];
const walk=dir=>{for(const entry of readdirSync(dir)){const path=`${dir}/${entry}`;if(statSync(path).isDirectory())walk(path);else if(/\.(js|html|json)$/.test(path))assets.push(path);}};
for(const dir of ['dist','dist-store','store/dist'])walk(dir);
const violations=assets.filter(path=>/single-instance-f012d|synthetic-sync-|synthetic-f012d|lanzo-pos-administrative-instance|Sync work requires an unstarted factory/.test(readFileSync(path,'utf8')));
assert.deepEqual(violations,[]);
const sizes=assets.map(path=>({path,bytes:statSync(path).size,sha256:hash(readFileSync(path))})).sort((a,b)=>b.bytes-a.bytes);
const report={baseline,files:rows.length,unchanged:rows.length-changed.length,changed,newSource:{path:newSource,sha256:hash(readFileSync(newSource))},bundleFiles:assets.length,fixtureOrCoordinatorViolations:violations,largestAssets:sizes.slice(0,15),sourceContracts:'App/main, Actor Runtime/Storage, M-01/F-02, tenant, financial durable contracts, license/realtime actions, SQL, SW, dependencies, workflows and Ecommerce have identical blobs. Optional scope factory is absent from commercial bundles. This is preservation, not physical QA.'};
writeFileSync('scripts/qa/single-instance-f012d/evidence/preservation.json',JSON.stringify(report,null,2));
writeFileSync('scripts/qa/single-instance-f012d/evidence/tested-sources.json',JSON.stringify([...changed.map(({path,after})=>({path,sha256:after})),report.newSource],null,2));
console.log(JSON.stringify({files:report.files,unchanged:report.unchanged,changed:changed.length,bundleFiles:assets.length,violations:violations.length}));
