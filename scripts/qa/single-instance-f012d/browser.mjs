import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const out=resolve('scripts/qa/single-instance-f012d/evidence');await mkdir(out,{recursive:true});
let browser;
try {
 const tooling=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
 const {chromium}=await import(tooling?pathToFileURL(join(tooling,'playwright/index.mjs')).href:'playwright');
 browser=await chromium.launch({executablePath:process.env.ACTOR_QA_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
} catch(error) {
 await writeFile(join(out,'chromium.json'),JSON.stringify({status:'NOT_EXECUTED',message:error.message,scenarios:['timer','pull','outbox','recovery','late_callback','never_settles','tenant_change','abrupt_close']},null,2));
 console.log('Chromium NOT_EXECUTED: '+error.message.split('\n')[0]);process.exit(0);
}
const html=`<!doctype html><script type="module">
import {createSyncExecutionScope} from '/scope.js';
window.state={held:false,drained:false,starts:0,childSettled:false};window.current=true;
window.scope=createSyncExecutionScope({isContextCurrent:()=>current});
window.acquire=()=>navigator.locks.request('synthetic-f012d',async()=>{state.held=true;await new Promise(r=>window.release=async()=>{scope.quiesce();await scope.drain();state.drained=true;r();});state.held=false;});
window.begin=(kind)=>{let finish;const raw=new Promise(r=>finish=r);window.complete=()=>finish();const execute=async t=>{state.starts++;await raw;await t.track(async()=>{await Promise.resolve();state.childSettled=true;});};if(kind==='timer')scope.schedule('timer',execute,0);else scope.run(kind,execute);};window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url==='/scope.js'){res.setHeader('Content-Type','application/javascript');res.end(await readFile('src/services/sync/syncExecutionScope.js'));}else{res.setHeader('Content-Type','text/html');res.end(html);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const errors=[],results=[];
try {
 for(const kind of ['timer','pull','outbox','recovery','late_callback','never_settles','tenant_change','abrupt_close']) {
  const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage();
  for(const page of[a,b]){page.on('pageerror',e=>errors.push(String(e)));await page.goto(origin);await page.waitForFunction(()=>window.ready);}
  await a.evaluate(()=>{void acquire();});await a.waitForFunction(()=>state.held);await b.evaluate(()=>{void acquire();});
  await a.evaluate(kind=>begin(kind),kind);await a.waitForFunction(()=>state.starts===1);
  await a.evaluate(()=>{void release();});await b.waitForTimeout(30);assert.equal(await b.evaluate(()=>state.held),false);
  if(kind==='never_settles') {assert.equal(await a.evaluate(()=>scope.getSnapshot().pending),1);results.push({kind,status:'PASS_PENDING',limit:'finite observation; no timeout release'});}
  else if(kind==='tenant_change') {await a.evaluate(()=>{current=false;complete();});await b.waitForFunction(()=>state.held);assert.equal(await a.evaluate(()=>state.childSettled),false);results.push({kind,status:'PASS_STALE_CONTINUATION_REJECTED'});}
  else if(kind==='abrupt_close') {await a.close();await b.waitForFunction(()=>state.held);results.push({kind,status:'PASS_NATIVE_TERMINATION',limit:'browser release, not voluntary drain or remote rollback'});}
  else {await a.evaluate(()=>complete());await b.waitForFunction(()=>state.held);assert.equal(await a.evaluate(()=>state.drained&&state.childSettled),true);if(kind==='late_callback'){await a.evaluate(()=>{try{scope.run('late',()=>state.starts++);}catch{}});assert.equal(await a.evaluate(()=>state.starts),1);}results.push({kind,status:'PASS'});}
  await context.close();
 }
 assert.deepEqual(errors,[]);
 await writeFile(join(out,'chromium.json'),JSON.stringify({status:'PASS',version:browser.version(),results,errors,limit:'native locks and exact scope; jobs synthetic, no POS or production services'},null,2));
} finally {await browser.close();await new Promise(r=>server.close(r));}
