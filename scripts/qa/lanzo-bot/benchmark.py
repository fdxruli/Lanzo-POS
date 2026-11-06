"""Complementary Chromium measurements. Synthetic read boundary; real UI/Worker/algorithms.
Main JS heap is NOT total RAM and excludes worker heaps. No account or business writes.
"""
import json, os, statistics
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
base = os.environ.get('LANZO_BOT_QA_BASE_URL', 'http://127.0.0.1:5173')
out = Path(os.environ.get('LANZO_BOT_QA_OUTPUT', '/tmp/lanzo-worker-benchmark')); out.mkdir(parents=True, exist_ok=True)
stubs = {
 '/src/store/useAppStore.js': "export const useAppStore = selector => selector({companyProfile:{business_type:'abarrotes'},canAccess:()=>true});",
 '/src/services/auth/useActorRuntimeSnapshot.js': "export const useActorRuntimeSnapshot = () => ({actorType:'admin',generation:window.actorGeneration||1});",
 '/src/hooks/pos/useActiveOrders.js': "export const useActiveOrders = selector => selector({activeOrders:new Map()});",
 '/src/services/botReadService.js': """export const readBotBusinessData = async(intent, _range, {signal,compute}) => {
  const operation = intent === 'low_stock' ? 'stock' : intent === 'top_products' ? 'products' : 'financial';
  const result = await compute(operation, window.dataset, () => { if(signal.aborted) throw new Error('cancelled'); });
  window.lastComputation = result;
  return {title:'Resultado de prueba',message:'Consulta sintética finalizada'};
 };"""
}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':390,'height':844})
 def intercept(route):
  url=route.request.url
  if not url.startswith(base): route.abort(); return
  for suffix,body in stubs.items():
   if suffix in url: route.fulfill(status=200,content_type='application/javascript',body=body); return
  route.continue_()
 context.route('**/*',intercept)
 page=context.new_page(); errors=[]; page.on('pageerror',lambda error:errors.append(str(error)))
 page.add_init_script("""
 window.botWorkers=[]; const Native=Worker;
 window.Worker=class extends Native {
  constructor(...args){super(...args); this.record={url:String(args[0]),start:performance.now(),active:true}; window.botWorkers.push(this.record);}
  terminate(){this.record.active=false; super.terminate();}
 };
 window.longTasks=[];
 new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});
 window.beats=[]; let previous=performance.now(); function beat(now){window.beats.push(now-previous);previous=now;requestAnimationFrame(beat);}requestAnimationFrame(beat);
 """)
 page.goto(base+'/scripts/qa/lanzo-bot/fixture.html?disabled=1')
 cdp=context.new_cdp_session(page); cdp.send('Emulation.setCPUThrottlingRate',{'rate':4})
 states=[]; queries=[]
 def snapshot(name):
  cdp.send('HeapProfiler.collectGarbage')
  states.append({'state':name,'main_js_heap_bytes':cdp.send('Runtime.getHeapUsage')['usedSize'],**page.evaluate("({active_workers:botWorkers.filter(w=>w.active).length,worker_creations:botWorkers.length,worker_download_bytes:performance.getEntriesByType('resource').filter(e=>/bot.worker/.test(e.name)).reduce((s,e)=>s+e.transferSize,0)})")})
 page.evaluate("window.dataset=Array.from({length:20000},(_,i)=>({status:'closed',total:90,items:Array.from({length:3},(_,n)=>({id:String((i+n)%500),name:'Artículo '+((i+n)%500),quantity:1,price:40,lineTotal:30,cost:15}))}))")
 page.evaluate("async()=>{window.historyDataset=dataset;window.catalogDataset=Array.from({length:20000},(_,i)=>({id:String(i),name:'Producto '+i,isActive:true,trackStock:true,stock:i%8,minStock:5,committedStock:0}));window.smallDataset=catalogDataset.slice(0,50);window.baselineSummary=(await import('/src/services/sales/financialPolicy.js')).summarizeFinancialSales;}")
 snapshot('disabled')
 page.get_by_role('button',name='Activar bot',exact=True).click(); snapshot('enabled_closed')
 begin=page.evaluate('performance.now()'); page.get_by_role('button',name='Abrir Lanzó Bot').click()
 page.get_by_role('button',name='¿Cómo hago una venta rápida?',exact=True).wait_for()
 init_ms=page.evaluate('performance.now()')-begin; snapshot('open_idle')
 def query(text,scenario):
  page.evaluate('window.lastComputation=null; window.longTasks=[]; window.beats=[]')
  page.get_by_role('textbox').fill(text); start=page.evaluate('performance.now()'); page.get_by_role('textbox').press('Enter')
  if scenario=='history_20000': snapshot('processing')
  page.wait_for_function('window.lastComputation!==null',timeout=45000)
  queries.append({'scenario':scenario,'latency_ms':page.evaluate('performance.now()')-start,**page.evaluate('({long_tasks:longTasks,frames:beats.length,max_frame_gap_ms:Math.max(0,...beats)})')})
  return page.evaluate('window.lastComputation')
 financial=query('¿Cuánto vendí hoy?','history_20000')
 # Synchronous baseline uses exactly the same official algorithm and dataset, only in this explicit test.
 page.evaluate('window.longTasks=[];window.beats=[]')
 baseline=page.evaluate("""async()=>{const start=performance.now();const result=baselineSummary(dataset);return {ms:performance.now()-start,result};}""")
 page.wait_for_timeout(80)
 baseline_responsiveness=page.evaluate('({long_tasks:longTasks, max_frame_gap_ms:Math.max(0,...beats)})')
 assert financial['totalRevenue']==baseline['result']['totalRevenue'] and financial['confirmedProfit']==baseline['result']['confirmedProfit']
 page.evaluate('window.dataset=catalogDataset')
 stock=query('¿Qué productos tienen stock bajo?','catalog_20000'); assert len(stock)==5
 page.evaluate('window.dataset=smallDataset'); query('stock bajo','catalog_50')
 for i in range(3): query('Qué productos se están agotando'+'?'*(i+1),'consecutive_'+str(i))
 page.evaluate('window.dataset=historyDataset')
 page.get_by_role('button',name='Cerrar asistente').click(); snapshot('closed_after_use')
 page.locator('#toggle-bot').evaluate('el=>el.click()'); snapshot('disabled_after_use')
 for i in range(5):
  page.get_by_role('button',name='Activar bot',exact=True).click(); page.get_by_role('button',name='Abrir Lanzó Bot').click(); page.get_by_role('button',name='¿Cómo hago una venta rápida?',exact=True).wait_for(); page.get_by_role('button',name='Cerrar asistente').click(); page.locator('#toggle-bot').evaluate('el=>el.click()')
 snapshot('after_5_reopens')
 # Termination of actual CPU while closing/disabling, then navigation and actor changes.
 page.get_by_role('button',name='Activar bot',exact=True).click(); page.get_by_role('button',name='Abrir Lanzó Bot').click(); page.get_by_role('button',name='¿Cómo hago una venta rápida?',exact=True).wait_for()
 page.evaluate('window.dataset=historyDataset')
 page.get_by_role('textbox').fill('Cuánto vendí hoy'); page.get_by_role('textbox').press('Enter'); page.locator('#toggle-bot').evaluate('el=>el.click()'); snapshot('disabled_during_query')
 # Actual worker replacement during actor switch and route navigation.
 page.get_by_role('button',name='Activar bot',exact=True).click(); page.get_by_role('button',name='Abrir Lanzó Bot').click(); page.get_by_role('button',name='¿Cómo hago una venta rápida?',exact=True).wait_for()
 page.get_by_role('textbox').fill('Cuánto vendí hoy'); page.get_by_role('textbox').press('Enter'); page.evaluate('window.changeTestActor()')
 page.get_by_role('button',name='¿Cómo hago una venta rápida?',exact=True).wait_for()
 expect(page.get_by_text('Resultado de prueba',exact=True)).to_have_count(0)
 assert page.evaluate('botWorkers.filter(w=>w.active).length')==1
 page.get_by_role('textbox').fill('Cuánto vendí hoy'); page.get_by_role('textbox').press('Enter'); page.evaluate("window.navigateTest('/clientes?tab=add')")
 page.get_by_role('button',name='¿Cómo registro un cliente?',exact=True).wait_for()
 expect(page.get_by_text('Resultado de prueba',exact=True)).to_have_count(0)
 assert page.evaluate('botWorkers.filter(w=>w.active).length')==1
 page.locator('#toggle-bot').evaluate('el=>el.click()'); snapshot('after_actor_and_navigation_cancel')
 assert states[0]['active_workers']==0 and states[1]['active_workers']==0
 assert all(s['active_workers']==0 for s in states if s['state'] in ['closed_after_use','disabled_after_use','after_5_reopens','disabled_during_query'])
 assert not errors,errors
 result={'browser':browser.version,'platform':'Chromium Linux headless','cpu_throttle':4,'viewport':[390,844],'metric':'Main renderer JavaScript used heap after forced GC; excludes Worker heap and total process RAM','synthetic_data':True,'application_QA':False,'initialization_ms':init_ms,'states':states,'queries':queries,'same_financial_algorithm_on_main_ms':baseline['ms'],'baseline_responsiveness':baseline_responsiveness,'constant_retained_datasets':'20000 sales (60000 lines) + 20000 products + 50 product references throughout all states','financial_equivalence':True,'page_errors':errors}
 (out/'results.json').write_text(json.dumps(result,indent=2,ensure_ascii=False));print(json.dumps(result,indent=2,ensure_ascii=False))
 context.close();browser.close()
