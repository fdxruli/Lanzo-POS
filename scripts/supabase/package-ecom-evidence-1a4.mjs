// Whitelist only redacted outputs. Never copy private-* or fixture SQL/tokens.
import { readFileSync,writeFileSync,readdirSync,mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const source='.tmp/ecom-native-1a4',target='docs/reports/evidence/ecom-realtime-auth-1a4';
mkdirSync(target,{recursive:true});
function unpack(response){
 const envelope=JSON.parse(response.content[0].text);
 if(typeof envelope.result!=='string')return envelope.result??envelope;
 return JSON.parse(envelope.result.match(/<untrusted-data[^>]*>\n([\s\S]*?)\n<\/untrusted-data/)[1]);
}
for(const name of readdirSync(source).filter(n=>/^hosted-.*\.json$/.test(n)||['lint-summary.json'].includes(n)))
 writeFileSync(`${target}/${name}`,readFileSync(`${source}/${name}`));
for(const name of ['node-focal.log','node-all-candidate.log','node-all-base.log','react-final.log','react-doctor.log','lint-focal.log','deno.log'])
 writeFileSync(`${target}/${name}.gz`,gzipSync(readFileSync(`${source}/${name}`)));
const react=JSON.parse(readFileSync(`${source}/react-final.json`));
writeFileSync(`${target}/react-summary.json`,JSON.stringify({total:react.numTotalTests,passed:react.numPassedTests,failed:react.numFailedTests,
 files:react.testResults.map(r=>({file:r.name.replace(/^.*[\\/]src[\\/]/,'src/').replaceAll('\\','/'),status:r.status,cases:r.assertionResults.map(a=>({name:a.fullName,status:a.status}))}))},null,2));
function nodeResult(name){
 const log=readFileSync(`${source}/${name}`,'utf8');
 return {pass:Number(log.match(/^# pass (\d+)/m)[1]),fail:Number(log.match(/^# fail (\d+)/m)[1]),
  failures:[...log.matchAll(/^not ok \d+ - ([^\r\n]+)[\s\S]*?location: '([^']+)'/gm)].map(m=>({name:m[1],file:m[2].replace(/^.*scripts[\\]+/,'scripts/').replaceAll('\\\\','/').replaceAll('\\','/')}))};
}
const base=nodeResult('node-all-base.log'),candidate=nodeResult('node-all-candidate.log');
const keys=r=>new Set(r.failures.map(f=>JSON.stringify(f)));
const b=keys(base),c=keys(candidate);
writeFileSync(`${target}/node-differential.json`,JSON.stringify({base,candidate,new_failures:[...c].filter(k=>!b.has(k)),removed:[...b].filter(k=>!c.has(k)),platform:'Windows',base_sha:'9ca65fc07804f40c2add5e59bee0e6edca940b8f',candidate_sha:'final commit containing these sources; see PR certification'},null,2));
const before=unpack(JSON.parse(readFileSync('docs/reports/evidence/ecom-realtime-auth-1a3/postflight.json')))[0].jsonb_build_object;
const after=unpack(JSON.parse(readFileSync(`${target}/postflight-raw.json`)))[0].jsonb_build_object;
const canonicalACL=acl=>(typeof acl==='string'?acl.slice(1,-1).split(','):acl).sort();
const comparisons=before.functions.map(f=>{const g=after.functions.find(x=>x.signature===f.signature);return {signature:f.signature,body_unchanged:f.md5===g.md5,acl_unchanged:JSON.stringify(canonicalACL(f.acl))===JSON.stringify(canonicalACL(g.acl))};});
const sortPolicies=p=>p.sort((a,b)=>a.name.localeCompare(b.name));
writeFileSync(`${target}/postflight.json`,JSON.stringify({...after,comparisons,policies_unchanged:JSON.stringify(sortPolicies(before.policies))===JSON.stringify(sortPolicies(after.policies))},null,2));
const acl=unpack(JSON.parse(readFileSync(`${target}/acl-rehearsal.json`)))[0].jsonb_build_object;
writeFileSync(`${target}/acl-summary.json`,JSON.stringify({checks:acl.checks,roles:new Set(acl.matrix.map(r=>r.role)).size,
 matrix:acl.matrix,unchanged_bodies:acl.unchanged_bodies},null,2));
const f=JSON.parse(readFileSync(`${source}/private-fixtures.json`));
writeFileSync(`${target}/resource-inventory.json`,JSON.stringify({run:f.run,tenants:f.tenants.map(t=>({license_id:t.id,device:t.device,device2:t.device2,admin:t.admin,session:t.session,session2:t.session2,staff:t.staff,staff_session:t.staffSession,denied_staff:t.denied,denied_session:t.deniedSession})),replacement_session:JSON.parse(readFileSync(`${source}/private-session-rotation.json`)).session,
 server:'local QA only; no Edge endpoint or secrets installed',cleanup:'collector 4 users / 9 Auth sessions; selective SQL migration 20261022184218; no synthetic resources remain'},null,2));
const sourcePaths=['src/services/ecommerce/ecomSignalReceiver.js','src/services/ecommerce/ecomSignalActorAdapter.js','src/services/ecommerce/ecomSignalLeadership.js','src/services/ecommerce/useEcomSignalQa.js',
 'supabase/functions/lanzo-ecom-bridge-qa/broker.mjs',...readdirSync('supabase/candidates/ecom-signal-auth-1a4').filter(n=>n.endsWith('.sql')).map(n=>`supabase/candidates/ecom-signal-auth-1a4/${n}`)];
writeFileSync(`${target}/source-manifest.json`,JSON.stringify(sourcePaths.map(path=>({path,normalization:'LF',sha256:createHash('sha256').update(readFileSync(path,'utf8').replaceAll('\r\n','\n')).digest('hex')})),null,2));
const manifest=readdirSync(target).filter(n=>n!=='manifest.json').sort().map(name=>{const data=readFileSync(`${target}/${name}`);return {name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};});
writeFileSync(`${target}/manifest.json`,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({files:manifest.length,postflight_ok:comparisons.every(c=>c.body_unchanged&&c.acl_unchanged),node_new_failures:[...c].filter(k=>!b.has(k)).length,react_passed:react.numPassedTests}));
