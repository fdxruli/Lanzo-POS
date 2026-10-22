import { mkdirSync, writeFileSync } from 'node:fs';
// Discrete client schedule including the native JWT boundary; no measured usage.
export function sessionCost(ttl, seconds=14400, optimized=true) {
  let time=0,jwtExpiry=3600,grantExpiry=ttl,invocations=1,refreshes=0;
  for(let n=0;n<10000;n++){
    const next=Math.max(time+1,Math.min(grantExpiry,jwtExpiry)-30);
    if(next>=seconds)break;
    time=next;
    if(jwtExpiry<=time+90){jwtExpiry=time+3600;refreshes++;}
    grantExpiry=time+ttl;invocations++;
  }
  return { invocations,refreshes,authSignIns:1,joins:optimized?1:invocations,
    reauthorizations:refreshes,session_hours:seconds/3600 };
}
const base=sessionCost(120,14400,false),candidate=sessionCost(600);
const months=(s,devices,tabs)=>({
  edge:s.invocations*60*devices*tabs,auth_refreshes:s.refreshes*60*devices*tabs,
  auth_signins:60*devices*tabs,technical_mau:60*devices,peak_websockets:devices*tabs,
  joins:s.joins*60*devices*tabs,signals_messages:50*30*devices*tabs*2,
  broker_authority_rpc:2*s.invocations*60*devices*tabs,
  // Historical vault snapshot: 9380 bytes / four grants, excluding indexes.
  live_vault_bytes:2345*devices*tabs,
  retained_tombstones_30d:60*devices*tabs,
});
const sizes=[10,25,50,100,500,1000],scale=(row,n)=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v*n]));
const scenarios=Object.fromEntries([['FREE',1],['LEGACY',2],['PRO',5]].map(([plan,devices])=>[plan,sizes.map(businesses=>({businesses,
  baseline:scale(months(base,devices,2),businesses),optimized_one_owner:scale(months(candidate,devices,1),businesses),
  optimized_no_coordination:scale(months(candidate,devices,2),businesses)}))]));
const result={kind:'ASSUMPTION_MODEL_NOT_BENCHMARK',assumptions:{days:30,hours_day:8,sessions_device_day:2,hours_session:4,baseline_tabs:2,optimized_tabs:1,
  receiver_jwt_seconds:3600,refresh_margin_seconds:90,renew_margin_seconds:30,orders_day:50,retries_baseline:0,additional_retries:'add 10% Edge/Auth for stress; network peaks may be synchronized',
  unseen_other_module_usage:'UNKNOWN; quotas below are total, never residual',sql_queries:'two broker RPC per uncached issue, not physical SQL statements; publisher authority per recipient, RLS on join/JWT update',
  storage:'2345 historical bytes/live vault excludes indexes, receipts and audit; no reduction in MAU from deleting users'},
  quotas_free:{edge_invocations_month:500000,realtime_connections:200,realtime_messages_month:2000000,technical_and_other_mau_month:50000,messages_second:100,joins_second:100},
  published_1a3_baseline:{devices:2,tabs:2,edge_business_month:38640,explanation:'320 renewals/day plus two starts per tab; simplified arithmetic from 1A.3, not native JWT simulation'},
  ttl_sessions:[120,300,600,900].map(ttl=>({ttl,...sessionCost(ttl)})),baseline_session:base,candidate_session:candidate,scenarios};
if(process.argv[1]?.endsWith('ecom-cost-model-1a4.mjs')){
 const folder='docs/reports/evidence/ecom-realtime-auth-1a4';mkdirSync(folder,{recursive:true});
 writeFileSync(`${folder}/cost-model.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify({ttl_sessions:result.ttl_sessions,FREE:scenarios.FREE.map(s=>({businesses:s.businesses,before:s.baseline.edge,after:s.optimized_one_owner.edge,sockets:s.optimized_one_owner.peak_websockets})),PRO:scenarios.PRO.map(s=>({businesses:s.businesses,before:s.baseline.edge,after:s.optimized_one_owner.edge,sockets:s.optimized_one_owner.peak_websockets}))}));
}
