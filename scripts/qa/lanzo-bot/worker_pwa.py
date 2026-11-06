"""Built Worker + offline guides + explicit SW upgrade, without POS login or business data."""
import functools, http.server, json, os, re, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[3]
old=Path(os.environ.get('LANZO_BOT_OLD_DIST','/tmp/lanzo-bot-before-dist'))
current=[old if old.exists() else root/'dist']
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(current[0]),**kwargs)
 def do_GET(self):
  if self.path=='/api/bot-worker-qa':
   self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(b'<!doctype html><title>Isolated Worker QA</title>');return
  super().do_GET()
 def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',4180),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
url='http://127.0.0.1:4180'
assets=list((root/'dist/assets').glob('bot.worker-*.js'));assert len(assets)==1
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context=browser.new_context();context.route('**/*',lambda r:r.continue_() if r.request.url.startswith(url) else r.abort())
 page=context.new_page();page.goto(url+'/api/bot-worker-qa')
 page.evaluate("async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;}")
 page.reload();page.wait_for_function('navigator.serviceWorker.controller!==null')
 upgraded=current[0]==old
 if upgraded:
  current[0]=root/'dist'
  page.evaluate('async()=>{window.qaRegistration=await navigator.serviceWorker.getRegistration();await qaRegistration.update();}')
  page.wait_for_function('window.qaRegistration.waiting!==null')
  page.evaluate("()=>{window.qaNext=qaRegistration.waiting;qaNext.postMessage({type:'SKIP_WAITING'});}")
  page.wait_for_function('qaRegistration.active===qaNext && qaNext.state==="activated"')
  page.reload();page.wait_for_function('navigator.serviceWorker.controller!==null')
 cdp=context.new_cdp_session(page);cdp.send('Network.setCacheDisabled',{'cacheDisabled':True})
 context.set_offline(True)
 result=page.evaluate("""async path=>{
  const worker=new Worker(path,{type:'module',name:'lanzo-bot-pwa-test'});let id=0;
  const ask=(type,payload)=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>reject(Error('timeout')),15000);worker.onmessage=({data})=>{if(data.id===n){clearTimeout(timer);resolve(data);}};worker.onerror=reject;worker.postMessage({id:n,type,payload});});
  const screen=await ask('CONTEXT',{pathname:'/productos',search:'?tab=batches'});
  const answer=await ask('QUESTION',{text:'¿Cómo agrego stock o un lote?',context:{pathname:'/productos'}});
  worker.terminate();return {screen,answer};
 }""",'/assets/'+assets[0].name)
 assert result['screen']['value']['label']=='Productos e inventario · Gestionar lotes',result
 assert result['answer']['value']['title']=='Entradas de inventario',result
 output={'status':'PASS','old_architecture_resource_upgrade':upgraded,'explicit_activation':upgraded,'offline':True,'http_cache_disabled':True,'real_built_worker':assets[0].name,'result':result,'application_QA':False,'account_session':'none'}
 Path('/tmp/bot-worker-pwa.json').write_text(json.dumps(output,indent=2,ensure_ascii=False));print(json.dumps(output,indent=2,ensure_ascii=False));context.close();browser.close()
server.shutdown()
