# Isolated component verification. Never logs into POS or sends service requests.
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
base_url=os.environ.get('LANZO_DIAGNOSTIC_QA_BASE_URL','http://127.0.0.1:5173').rstrip('/')
output=Path(os.environ.get('LANZO_DIAGNOSTIC_QA_OUTPUT','/tmp/lanzo-console-qa'))
output.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for name,width,height in [('mobile',390,844),('desktop',1440,900)]:
        context=browser.new_context(viewport={'width':width,'height':height},permissions=['clipboard-read','clipboard-write'])
        context.route('**/*',lambda route: route.continue_() if route.request.url.startswith(base_url) else route.abort())
        page=context.new_page()
        errors=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.goto(base_url+'/scripts/qa/dev-console/fixture.html')
        page.get_by_role('button',name='Abrir consola de diagnóstico').click()
        panel=page.get_by_role('region',name='Consola de diagnóstico')
        expect(panel).to_be_visible()
        expect(page.locator('.dev-console-entry')).to_have_count(3)
        expect(page.get_by_text('3 eventos equivalentes',exact=False)).to_be_visible()
        page.get_by_label('Filtrar por nivel').select_option('warn')
        expect(page.locator('.dev-console-entry')).to_have_count(1)
        page.get_by_label('Buscar en logs').fill('NETWORK_TIMEOUT')
        page.get_by_title('Copiar logs visibles').click()
        expect(page.get_by_text('Diagnóstico copiado.')).to_be_visible()
        copied=page.evaluate('navigator.clipboard.readText()')
        assert 'NETWORK_TIMEOUT' in copied and 'Eventos equivalentes: 3' in copied
        assert 'private' not in copied and 'private' not in panel.inner_text()
        page.get_by_label('Filtrar por categoría').select_option('indexeddb')
        expect(page.get_by_text('No hay registros para este filtro.')).to_be_visible()
        page.get_by_label('Filtrar por categoría').select_option('all')
        page.get_by_label('Buscar en logs').fill('')
        page.get_by_label('Filtrar por nivel').select_option('all')
        page.get_by_title('Pausar captura visual').click()
        count=page.locator('.dev-console-entry').count()
        page.evaluate('window.seedDiagnostic()')
        expect(page.locator('.dev-console-entry')).to_have_count(count)
        page.get_by_title('Reanudar captura visual').click()
        expect(page.locator('.dev-console-entry')).to_have_count(6)
        page.get_by_title('Limpiar consola').click()
        expect(page.locator('.dev-console-entry')).to_have_count(0)
        page.evaluate('window.seedDiagnostic()')
        expect(page.locator('.dev-console-entry')).to_have_count(3)
        page.locator('#operation').click(timeout=5000)
        expect(page.locator('#counter')).to_have_text('1')
        for theme in ['light','dark']:
            page.evaluate('(theme)=>document.documentElement.dataset.theme=theme',theme)
            box=panel.bounding_box()
            assert box['x']>=0 and box['y']>=0 and box['x']+box['width']<=width+1 and box['y']+box['height']<=height+1,box
            page.screenshot(path=str(output/f'{name}-{theme}.png'))
        if name=='mobile':
            page.set_viewport_size({'width':844,'height':390})
            expect(panel).to_be_visible()
            box=panel.bounding_box()
            assert box['x']>=0 and box['y']>=0 and box['x']+box['width']<=844+1
            page.get_by_title('Expandir panel').click()
            page.get_by_label('Buscar en logs').fill('PGRST202')
            expect(page.get_by_text('No hay registros para este filtro.')).to_be_visible()
        page.keyboard.press('Escape')
        expect(page.get_by_role('button',name='Abrir consola de diagnóstico')).to_be_focused()
        assert errors==[],errors
        results.append({'viewport':name,'width':width,'height':height,'result':'PASS','pageErrors':errors,'scope':'isolated synthetic component fixture; no license/POS/network operations'})
        context.close()
    browser.close()
(output/'browser-results.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
