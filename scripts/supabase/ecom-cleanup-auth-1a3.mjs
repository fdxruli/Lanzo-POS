// Delete only identities already quarantined/retired by the reviewed QA broker.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createBackend} from '../../supabase/functions/lanzo-ecom-bridge-qa/broker.mjs';
import {serverSecrets} from '../../supabase/functions/lanzo-ecom-bridge-qa/secrets.mjs';
const ref='odlrhijtfyavryeqivaa',url=`https://${ref}.supabase.co`;
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',ref,'-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}));
const service=keys.find(k=>k.name==='service_role').api_key;
const env=Object.fromEntries(readFileSync('.tmp/ecom-native-1a3/private-secrets.env','utf8').split('\n').map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));
if(process.argv.includes('--local')){
 const backend=createBackend({url,serviceKey:service,publicKey:keys.find(k=>k.name==='anon').api_key,...serverSecrets({get:name=>env[name]})});
 try{const result=await backend.collect();writeFileSync('.tmp/ecom-native-1a3/auth-cleanup-local.json',JSON.stringify({at:new Date().toISOString(),result},null,2));console.log(JSON.stringify(result));}
 catch(error){console.log(JSON.stringify({code:error.message}));process.exitCode=1;}
}else{
const response=await fetch(`${url}/functions/v1/lanzo-ecom-bridge-qa`,{method:'POST',headers:{apikey:keys.find(k=>k.name==='anon').api_key,'x-lanzo-qa-control':env.LANZO_ECOM_QA_CONTROL_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({action:'collect'}),signal:AbortSignal.timeout(60000)});
const body=await response.json().catch(()=>null);
const result={at:new Date().toISOString(),http:response.status,result:body};
writeFileSync('.tmp/ecom-native-1a3/auth-cleanup.json',JSON.stringify(result,null,2));
if(!response.ok)throw Error(`COLLECT_${response.status}`);
console.log(JSON.stringify(result));
}
