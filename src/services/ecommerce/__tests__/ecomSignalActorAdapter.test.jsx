// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActorRuntimeController } from '../../auth/actorRuntimeController';
import { createEcomSignalReceiver } from '../ecomSignalReceiver';
import { attachEcomSignalQa } from '../ecomSignalActorAdapter';
import { useEcomSignalQa } from '../useEcomSignalQa';

afterEach(cleanup);
const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
function fixture({ broker, captureCredentials, onState } = {}) {
  let tenant={opaqueId:'tenant-a',databaseName:'db-a',generation:1};
  const runtime=createActorRuntimeController({getTenantAuthority:()=>tenant});
  const grant=(type='admin',sessionId='session-a',permissions=['ecommerce'])=>{
    if(runtime.getState().status!=='locked')runtime.lock('qa_handoff');
    runtime.beginAuthentication({actorType:type,deviceRef:'device-a'});
    runtime.grant({actorType:type,actorId:`${type}-a`,sessionId,deviceRef:'device-a',permissions,
      authorizationExpiresAt:new Date(Date.now()+3600000).toISOString()});
  };
  const connection={url:'https://qa.invalid',publicKey:'public',accessToken:'memory-only',grantExpiresAt:Date.now()+120000,jwtExpiresAt:Date.now()+3600000,topic:'ecom:qa-probe:1a2:grant'};
  const transports=[];
  const authorize=vi.fn(broker??(async()=>({ok:true,connection})));
  const receiver=createEcomSignalReceiver({broker:authorize,createTransport:async()=>{
    const transport={disconnect:vi.fn(),removeAllChannels:vi.fn(),setAuth:vi.fn(),channel:()=>({on:(_type,_event,callback)=>{transport.probe=callback;},subscribe:callback=>{transport.status=callback;}})};
    transports.push(transport);return transport;
  }});
  const probes=vi.fn(), states=vi.fn(onState);
  const credentials=vi.fn(captureCredentials??(async handle=>({sessionId:handle.sessionId,capture:{license_key:'synthetic',actor_session_token:`token-${handle.actorType}`}})));
  const options={enabled:true,runtime,receiver,captureCredentials:credentials,onProbe:probes,onState:states,isOnline:()=>true,isVisible:()=>true};
  return {runtime,grant,receiver,connection,transports,authorize,probes,states,credentials,options,setTenant:t=>{tenant=t;}};
}
describe('QA signal lifecycle with the current Actor Runtime',()=>{
  it('is disabled by default, including locally recovered GRANTED sessions',async()=>{
    const f=fixture();f.grant();const stop=attachEcomSignalQa({...f.options,enabled:undefined});await flush();
    expect(f.authorize).not.toHaveBeenCalled();stop();
  });
  it('cannot authorize offline or while local authentication is pending',async()=>{
    const f=fixture();f.runtime.beginAuthentication({actorType:'admin'});
    const stop=attachEcomSignalQa({...f.options,isOnline:()=>false});await flush();expect(f.authorize).not.toHaveBeenCalled();stop();
    f.runtime.lock();f.grant();const offline=attachEcomSignalQa({...f.options,isOnline:()=>false});await flush();expect(f.authorize).not.toHaveBeenCalled();offline();
  });
  it.each([['admin','staff'],['staff','admin']])('drops previous actor callbacks during %s to %s',async(first,next)=>{
    const f=fixture();f.grant(first);const stop=attachEcomSignalQa(f.options);await flush();const old=f.transports[0];
    f.grant(next,'next-session');await flush();const current=f.transports[1];
    old.probe({payload:{old:true}});current.probe({payload:{current:true}});
    expect(f.probes).toHaveBeenCalledExactlyOnceWith({current:true});expect(old.disconnect).toHaveBeenCalledOnce();stop();
  });
  it('discards late credentials when the same owner session is replaced',async()=>{
    let release;const f=fixture({captureCredentials:handle=>new Promise(resolve=>{release=()=>resolve({sessionId:handle.sessionId,capture:{}});})});
    f.grant();const stop=attachEcomSignalQa(f.options);await flush();const oldRelease=release;
    f.grant('admin','replacement');await flush();oldRelease();await flush();expect(f.authorize).not.toHaveBeenCalled();
    release();await flush();expect(f.authorize).toHaveBeenCalledOnce();stop();
  });
  it('discards a late broker response after tenant switch or logout',async()=>{
    let release;const f=fixture({broker:()=>new Promise(resolve=>{release=resolve;})});
    f.grant();const stop=attachEcomSignalQa(f.options);await flush();
    f.runtime.lock('tenant_switch');f.setTenant({opaqueId:'tenant-b',databaseName:'db-b',generation:2});
    release({ok:true,connection:f.connection});await flush();expect(f.transports).toHaveLength(0);stop();
  });
  it('drops credentials belonging to another cached session',async()=>{
    const f=fixture({captureCredentials:async()=>({sessionId:'wrong',capture:{}})});f.grant();
    const stop=attachEcomSignalQa(f.options);await flush();expect(f.authorize).not.toHaveBeenCalled();stop();
  });
  it('stops synchronously on device release, actor lock and denied staff permission',async()=>{
    const f=fixture();f.grant();const stop=attachEcomSignalQa(f.options);await flush();
    f.runtime.lock('device_released');expect(f.transports[0].disconnect).toHaveBeenCalledOnce();
    f.grant('staff','denied',[]);await flush();expect(f.authorize).toHaveBeenCalledOnce();stop();
  });
  it('keeps one owner across duplicate mounts and ignores old cleanup',async()=>{
    const f=fixture();f.grant();const old=attachEcomSignalQa(f.options);await flush();const first=f.transports[0];
    const next=attachEcomSignalQa(f.options);await flush();old();
    expect(first.disconnect).toHaveBeenCalledOnce();expect(f.transports[1].disconnect).not.toHaveBeenCalled();
    expect(f.authorize.mock.calls[0][0].runtime_id).toBe(f.authorize.mock.calls[1][0].runtime_id);next();
  });
  it('does not rejoin an authoritative denial after hiding, reconnecting or rerendering',async()=>{
    const events=new EventTarget();let visible=true;
    const f=fixture({broker:async()=>({ok:false,status:403})});f.grant();
    const stop=attachEcomSignalQa({...f.options,events,visibilityEvents:events,isVisible:()=>visible});await flush();
    visible=false;events.dispatchEvent(new Event('visibilitychange'));visible=true;events.dispatchEvent(new Event('online'));await flush();
    expect(f.authorize).toHaveBeenCalledOnce();expect(f.states).toHaveBeenLastCalledWith('denied');stop();
  });
  it('closes on hidden/offline, reuses the same runtime and revalidates on return',async()=>{
    const events=new EventTarget();let visible=true,online=true;const f=fixture();f.grant();
    const stop=attachEcomSignalQa({...f.options,events,visibilityEvents:events,isVisible:()=>visible,isOnline:()=>online});await flush();
    online=false;events.dispatchEvent(new Event('offline'));expect(f.transports[0].disconnect).toHaveBeenCalledOnce();
    online=true;visible=false;events.dispatchEvent(new Event('online'));await flush();expect(f.authorize).toHaveBeenCalledOnce();
    visible=true;events.dispatchEvent(new Event('visibilitychange'));await flush();expect(f.authorize).toHaveBeenCalledTimes(2);
    expect(f.authorize.mock.calls[0][0].runtime_id).toBe(f.authorize.mock.calls[1][0].runtime_id);stop();
  });
  it('React Strict Mode leaves one transport and fully cleans up on unmount',async()=>{
    const f=fixture();f.grant();
    const view=renderHook(()=>useEcomSignalQa(f.options),{wrapper:StrictMode});
    await waitFor(()=>expect(f.transports).toHaveLength(1));
    act(()=>view.unmount());expect(f.transports[0].disconnect).toHaveBeenCalledOnce();
    expect(f.runtime.getState().status).toBe('granted');
  });
});
