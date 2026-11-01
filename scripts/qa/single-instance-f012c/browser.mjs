import { createServer } from 'node:http';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const out=resolve('scripts/qa/single-instance-f012c/evidence');await mkdir(out,{recursive:true});
const tooling=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const {chromium}=await import(tooling?pathToFileURL(join(tooling,'playwright/index.mjs')).href:'playwright');
let browser;
try {browser=await chromium.launch({executablePath:process.env.ACTOR_QA_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});}
catch(error){await writeFile(join(out,'chromium.json'),JSON.stringify({status:'NOT_EXECUTED',reason:'BROWSER_EXECUTABLE_UNAVAILABLE',message:error.message},null,2));console.log('Chromium NOT_EXECUTED: browser executable unavailable');process.exit(0);}
const html=`<!doctype html><script type="module">
import {createBootstrapLifecycle} from '/lifecycle.js';
window.scope=createBootstrapLifecycle();window.state={held:false,publicSettled:false,rawSettled:false,drained:false};
window.begin=()=>{let done;const raw=new Promise(r=>done=r);window.complete=()=>{state.rawSettled=true;done();};scope.observe(raw);Promise.race([raw,new Promise(r=>setTimeout(r,20))]).then(()=>state.publicSettled=true);};
window.acquire=()=>navigator.locks.request('synthetic-f012c-lifetime',async()=>{state.held=true;await new Promise(r=>window.release=async()=>{scope.quiesce();await scope.drain();state.drained=true;r();});state.held=false;});
window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url==='/lifecycle.js'){res.setHeader('Content-Type','application/javascript');res.end(await readFile('src/services/bootstrap/bootstrapLifecycle.js'));}else{res.setHeader('Content-Type','text/html');res.end(html);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const errors=[];let result;
try{
 const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage();
 for(const page of[a,b]){page.on('pageerror',e=>errors.push(String(e)));await page.goto(origin);await page.waitForFunction(()=>window.ready);}
 await a.evaluate(()=>{void acquire();});await a.waitForFunction(()=>state.held);await b.evaluate(()=>{void acquire();});await a.evaluate(()=>begin());await a.waitForFunction(()=>state.publicSettled);
 await a.evaluate(()=>{void release();});await b.waitForTimeout(60);assert.equal(await b.evaluate(()=>state.held),false);assert.equal(await a.evaluate(()=>scope.getSnapshot().pending),1);
 await a.evaluate(()=>complete());await b.waitForFunction(()=>state.held);assert.equal(await a.evaluate(()=>state.drained),true);result={status:'PASS',version:browser.version(),origin,errors,scope:'Native Web Locks/two real documents and exact lifecycle helper. Synthetic public race/raw work; not full POS/Profile/Supabase browser E2E.'};await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));if(result)await writeFile(join(out,'chromium.json'),JSON.stringify(result,null,2));}
assert.deepEqual(errors,[]);
