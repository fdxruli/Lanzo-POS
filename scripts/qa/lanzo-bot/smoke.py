"""Isolated browser checks with mocked actor/store modules. No POS login or business operations."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
base = os.environ.get('LANZO_BOT_QA_BASE_URL', 'http://127.0.0.1:5173').rstrip('/')
out = Path(os.environ.get('LANZO_BOT_QA_OUTPUT', '/tmp/lanzo-bot-browser'))
out.mkdir(parents=True, exist_ok=True)
stubs = {
    '/src/store/useAppStore.js': "export const useAppStore = selector => selector({companyProfile:{business_type:'farmacia'},canAccess:()=>true});",
    '/src/services/auth/useActorRuntimeSnapshot.js': "export const useActorRuntimeSnapshot = () => ({actorType:'admin',generation:1});",
    '/src/hooks/pos/useActiveOrders.js': "export const useActiveOrders = selector => selector({activeOrders:new Map()});"
}
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    for name, width, height in [('small-mobile', 320, 568), ('android-size', 390, 844), ('windows-size', 1440, 900), ('android-dark', 390, 844)]:
        context = browser.new_context(viewport={'width': width, 'height': height}, service_workers='block')
        def route_request(route):
            url = route.request.url
            if not url.startswith(base):
                route.abort()
                return
            for suffix, body in stubs.items():
                if suffix in url:
                    route.fulfill(status=200, content_type='application/javascript', body=body)
                    return
            route.continue_()
        context.route('**/*', route_request)
        page = context.new_page()
        errors = []
        workers = []
        page.on('worker', lambda worker: workers.append(worker))
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base + '/scripts/qa/lanzo-bot/fixture.html')
        if name == 'android-dark':
            page.evaluate("document.documentElement.dataset.theme = 'dark'")
        page.get_by_role('button', name='Abrir Lanzó Bot').click()
        panel = page.get_by_role('region', name='Lanzó Bot')
        expect(panel).to_be_visible()
        page.wait_for_function("document.querySelector('.suggested-questions button') !== null")
        assert len(workers) == 1 and workers[0].evaluate('self.constructor.name') == 'DedicatedWorkerGlobalScope'
        assert page.locator('.close-btn svg').bounding_box()['width'] >= 18
        page.get_by_role('button', name='¿Cómo hago una venta rápida?', exact=True).click()
        expect(page.get_by_text('Venta rápida', exact=True)).to_be_visible()
        expect(page.get_by_text('Comprueba lote y caducidad física;', exact=False)).to_be_visible()
        page.get_by_role('textbox').fill('¿Cómo agrego stock o un lote?')
        page.get_by_role('textbox').press('Enter')
        expect(page.get_by_text('Entradas de inventario', exact=True)).to_be_visible()
        box = panel.bounding_box()
        assert box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['width'] <= width + 1 and box['y'] + box['height'] <= height + 1
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(out / (name + '.png')))
        page.get_by_role('button', name='Abrir Entradas de inventario', exact=True).click()
        expect(page.locator('#qa-path')).to_have_text('/productos?tab=batches')
        page.get_by_role('button', name='Abrir Lanzó Bot').click()
        expect(page.get_by_text('Productos e inventario · Gestionar lotes', exact=True)).to_be_visible()
        # Modules were loaded online. This checks warm offline operation, not PWA installation.
        context.set_offline(True)
        page.get_by_role('textbox').fill('¿Cómo registro un abono?')
        page.get_by_role('textbox').press('Enter')
        expect(page.get_by_text('Registrar abono', exact=True)).to_be_visible()
        expect(page.get_by_text('Sin conexión', exact=False)).to_be_visible()
        context.set_offline(False)
        expect(page.get_by_text('Con conexión', exact=False)).to_be_visible()
        page.get_by_role('textbox').press('Escape')
        expect(panel).not_to_be_visible()
        expect(page.get_by_role('button', name='Abrir Lanzó Bot')).to_be_focused()
        assert not errors, errors
        results.append({'viewport': name, 'size': [width, height], 'suggested_manual_navigation_warm_offline_reconnect_escape': 'PASS', 'page_errors': errors, 'identity_and_stores': 'mocked', 'worker': 'real DedicatedWorkerGlobalScope', 'worker_creations': len(workers)})
        context.close()
    browser.close()
(out / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps(results, ensure_ascii=False, indent=2))
