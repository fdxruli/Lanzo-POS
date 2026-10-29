import {describe,it,expect} from 'vitest';
import {webcrypto} from 'node:crypto';
import {createSyncExecutionScope} from '../../../src/services/sync/syncExecutionScope';
import {getDocumentInstanceCoordinator} from '../../../src/services/instance/instanceCoordinator';
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
// Deterministic LockManager substitute. Native browser evidence is separate.
const lab=()=>{
 const queue=[];let held=false;
 const pump=()=>{if(held||!queue.length)return;const task=queue.shift();if(task.options.signal.aborted){pump();return;}held=true;task.options.signal.removeEventListener('abort',task.abort);Promise.resolve().then(()=>task.callback({name:task.name})).then(task.resolve,task.reject).finally(()=>{held=false;pump();});};
 const request=(name,options,callback)=>new Promise((resolve,reject)=>{const task={name,options,callback,resolve,reject};task.abort=()=>{const i=queue.indexOf(task);if(i>=0)queue.splice(i,1);reject(new DOMException('aborted','AbortError'));};options.signal.addEventListener('abort',task.abort,{once:true});queue.push(task);queueMicrotask(pump);});
 const document=()=>getDocumentInstanceCoordinator({isSecureContext:true,document:{},crypto:webcrypto,navigator:{locks:{request}}});
 return{document};
};
describe('F012D synthetic instance boundary',()=>{
 it('D-60 secondary harness starts zero writes until owner scope drains and releases',async()=>{
  const l=lab(),a=l.document(),b=l.document(),scope=createSyncExecutionScope(),raw=deferred(),permit=deferred();let secondaryWrites=0;
  await a.start();const waiting=b.start().then(()=>{secondaryWrites++;});
  const job=scope.run('synthetic:outbox',()=>raw.promise);await flush();
  const executor=a.runExecutor(async()=>{await permit.promise;await scope.drain();});
  const observed=executor.catch(e=>e.code);
  await flush();scope.quiesce();permit.resolve();const exit=a.quiesceAndRelease();await flush();
  expect(secondaryWrites).toBe(0);expect(b.getSnapshot().state).toBe('SECONDARY');expect(a.getSnapshot().nativeHeld).toBe(true);
  raw.resolve();await job;await observed;await exit;await waiting;expect(secondaryWrites).toBe(1);expect(scope.getSnapshot().state).toBe('DRAINED');await b.quiesceAndRelease();
 });
 it('EXTRA UNKNOWN scope never completes the synthetic owner executor',async()=>{
  const l=lab(),a=l.document(),b=l.document(),scope=createSyncExecutionScope(),permit=deferred();await a.start();void b.start();scope.markUnobservable('raw_unknown');
  void a.runExecutor(async()=>{await permit.promise;await scope.drain();}).catch(()=>{});await flush();scope.quiesce();permit.resolve();void a.quiesceAndRelease();await flush();
  expect(scope.getSnapshot().state).toBe('UNKNOWN');expect(a.getSnapshot()).toMatchObject({nativeHeld:true,pendingExecutors:1});expect(b.getSnapshot().state).toBe('SECONDARY');await b.quiesceAndRelease();
 });
});
