// Captures actual exit codes and source-tree hash. No production calls.
import { spawn,execFileSync } from 'node:child_process';
import { createWriteStream,mkdirSync,writeFileSync,readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const out=resolve('.tmp/ecom-native-1a3');mkdirSync(out,{recursive:true});
const mode=process.argv[2]||'builds';
const tasks={
 builds:[['build-pos','node',['node_modules/vite/bin/vite.js','build']],['postbuild','node',['scripts/admin-startup-precache-audit.mjs']],['build-store','node',['node_modules/vite/bin/vite.js','build','--config','vite.store.config.js']]],
 focal:[['actor-final','node',['node_modules/vitest/vitest.mjs','run','src/services/ecommerce/__tests__/ecomSignalActorAdapter.test.jsx','src/services/auth','src/services/tenant','--maxWorkers=2','--reporter=json',`--outputFile=${out}/actor-final.json`]]],
 node:[['node-contracts','node',['--test',...readdirSync('scripts/supabase').filter(f=>f.endsWith('.node-test.mjs')).map(f=>`scripts/supabase/${f}`)]]],
 lint:[['lint-full','node',['node_modules/eslint/bin/eslint.js','src','--format','json','--output-file',`${out}/lint-full.json`]]],
};
if(!tasks[mode])throw Error('MODE');
const results=[];
const git = args => execFileSync('git',args,{encoding:'utf8'}).trim();
const before={head:git(['rev-parse','HEAD']),status:git(['status','--porcelain'])};
for(const [name,command,args] of tasks[mode]){
 const log=createWriteStream(`${out}/${name}.log`),started=Date.now();
 const result=await new Promise(resolve=>{
  const child=spawn(command,args,{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>child.kill(),mode==='builds'||mode==='lint'?1800000:600000);
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  child.on('error',e=>{clearTimeout(timer);resolve({exit:null,error:e.message});});child.on('exit',(exit,signal)=>{clearTimeout(timer);resolve({exit,signal});});
 });log.end();results.push({name,...result,status:result.exit===0?'PASS':'FAIL',elapsed_ms:Date.now()-started});
 const after={head:git(['rev-parse','HEAD']),status:git(['status','--porcelain'])};
 writeFileSync(`${out}/validation-${mode}.json`,JSON.stringify({before,after,sha_certified:!before.status&&!after.status&&before.head===after.head,results},null,2));
 console.log(JSON.stringify(results.at(-1)));
}
