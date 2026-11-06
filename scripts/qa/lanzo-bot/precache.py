"""Verify the built production Service Worker serves bot assets on first offline fetch.
Run after npm run build and serve dist on localhost:4173. No account/session is created.
"""
import json, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright
base = os.environ.get('LANZO_BOT_PWA_BASE_URL', 'http://127.0.0.1:4173').rstrip('/')
root = Path(__file__).resolve().parents[3]
names = [p.name for p in (root / 'dist/assets').iterdir() if p.suffix in ('.js', '.css') and p.name.startswith(('AssistantBot-', 'botIntelligence-', 'botReadService-', 'inventoryAnalysis-', 'productStats-'))]
assert names, 'Build the application first'
queue = list(names)
assets = set(names)
while queue:
    name = queue.pop()
    if not name.endswith('.js'):
        continue
    source = (root / 'dist/assets' / name).read_text()
    for dependency in re.findall(r'(?:\bfrom\s*|\bimport\s*)[\"\']\./([^\"\']+\.(?:js|css))[\"\']', source):
        if dependency not in assets:
            assets.add(dependency)
            queue.append(dependency)
names = sorted(assets)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context()
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base) else route.abort())
    page = context.new_page()
    page.goto(base + '/manifest.webmanifest')  # no application login/bootstrap runs
    page.evaluate("async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; }")
    page.reload()  # First installation activates the worker; a new navigation adopts its scope.
    page.wait_for_function('navigator.serviceWorker.controller !== null')
    context.new_cdp_session(page).send('Network.setCacheDisabled', {'cacheDisabled': True})
    seen = []
    page.on('response', lambda response: seen.append({'path': response.url.removeprefix(base + '/'), 'service_worker': response.from_service_worker}))
    context.set_offline(True)
    results = page.evaluate("""async paths => Promise.all(paths.map(async path => {
      const response = await fetch('/assets/' + path);
      return {path, status:response.status, bytes:(await response.text()).length};
    }))""", names)
    assert all(item['status'] == 200 and item['bytes'] > 0 for item in results), results
    assert len(seen) == len(results) and all(item['service_worker'] for item in seen), seen
    print(json.dumps({'status': 'PASS', 'first_offline_fetch': results, 'responses': seen, 'http_cache_disabled': True, 'account_session': 'none'}, ensure_ascii=False, indent=2))
    context.close()
    browser.close()
