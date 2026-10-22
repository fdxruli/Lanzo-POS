import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireEcomSignalLeadership } from '../../src/services/ecommerce/ecomSignalLeadership.js';
const flush=async()=>{for(let n=0;n<40;n++)await Promise.resolve();};
test('exact context serializes leaders, releases on abort and never sends tokens',async()=>{
  const tails=new Map(),names=[];
  const locks={request:(name,{signal},callback)=>{
    names.push(name);const old=tails.get(name)??Promise.resolve();
    const next=old.then(()=>{if(signal.aborted)throw new DOMException('Aborted','AbortError');return callback();});
    tails.set(name,next.catch(()=>{}));return next;
  }};
  const a=new AbortController(),b=new AbortController(),c=new AbortController();
  const release=await acquireEcomSignalLeadership('tenant-a/admin/session-a/device',a.signal,locks);
  let granted=false;
  const queued=acquireEcomSignalLeadership('tenant-a/admin/session-a/device',b.signal,locks).then(r=>{granted=true;return r;});
  const other=await acquireEcomSignalLeadership('tenant-a/staff/session-b/device',c.signal,locks);
  await flush();assert.equal(granted,false);a.abort();release();
  const next=await queued;assert.equal(granted,true);b.abort();next();c.abort();other();
  assert.equal(names[0],names[1]);assert.notEqual(names[0],names[2]);
  assert.match(names[0],/^lanzo-ecom-qa:[a-f0-9]{64}$/);assert.doesNotMatch(names.join(),/tenant|session|device/);
});
