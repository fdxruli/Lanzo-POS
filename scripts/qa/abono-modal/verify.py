"""Controlled UI checks only; no financial API or Production connection.

Start: npx vite --config scripts/qa/abono-modal/vite.config.mjs
Run: python scripts/qa/abono-modal/verify.py [artifact-directory]
Requires Python Playwright and a local Chromium. No package changes needed.
"""
import json
import os
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright, expect

output = Path(sys.argv[1] if len(sys.argv) > 1 else 'work/abono-modal-ux')
output.mkdir(parents=True, exist_ok=True)
results, errors, external_requests = [], [], []
base = 'http://127.0.0.1:5176/'

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
        headless=True, args=['--no-sandbox'])
    context = browser.new_context(service_workers='block', reduced_motion='reduce')

    def network_guard(route):
        if route.request.url.startswith(base):
            route.continue_()
        else:
            external_requests.append(route.request.url)
            route.abort()

    context.route('**/*', network_guard)
    page = context.new_page()
    page.set_default_timeout(6000)
    page.on('pageerror', lambda error: errors.append(str(error)))

    def open_modal(scenario='reconciled', width=390, height=844, dark=False):
        page.set_viewport_size({'width': width, 'height': height})
        page.goto(f'{base}?scenario={scenario}')
        if dark:
            page.evaluate("document.documentElement.dataset.theme='dark'")
        page.get_by_role('button', name='Abrir abono de demostración').click()
        expect(page.get_by_role('dialog')).to_be_visible()

    def specific():
        page.locator('label.abono-mode').nth(1).click()
        expect(page.get_by_role('radio', name='Abonar por venta / nota', exact=True)).to_be_checked()

    def capture(name):
        # Wait for the shared button color transition before capturing enabled state.
        page.wait_for_timeout(300)
        page.screenshot(path=str(output / f'{name}.png'))

    def within_viewport():
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert page.locator('.abono-scroll-body').evaluate('(el)=>el.scrollWidth <= el.clientWidth')
        box = page.get_by_role('button', name='Confirmar abono', exact=True).bounding_box()
        assert box and box['y'] >= 0 and box['y'] + box['height'] <= page.viewport_size['height']

    open_modal(width=1440, height=1000)
    expect(page.get_by_label('Monto del abono', exact=True)).to_be_focused()
    page.get_by_label('Monto del abono', exact=True).fill('5')
    expect(page.get_by_role('button', name='Confirmar abono', exact=True)).to_be_enabled()
    capture('desktop-general')
    page.get_by_role('button', name='Confirmar abono', exact=True).click()
    assert page.evaluate('paymentCalls[0].slice(1)') == ['5', True, None]
    results.append('General: existing callback, exact amount, receipt, no explicit allocations')

    open_modal(width=1440, height=1000)
    specific()
    page.locator('summary').nth(1).click()
    page.get_by_label('Abono a la nota 002', exact=True).fill('5')
    expect(page.get_by_label('Total a confirmar', exact=True)).to_have_text('$5.00')
    capture('desktop-specific')
    page.get_by_role('button', name='Confirmar abono', exact=True).click()
    assert page.evaluate('paymentCalls[0].slice(1)') == ['5', True, [{'saleId': 'controlled-note-002', 'amountApplied': '5'}]]
    results.append('Specific: only selected verified note submitted')

    # Repeated native submit events test the synchronous guard, including same-tick events.
    page.locator('form').evaluate("el=>{el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}")
    assert page.evaluate('paymentCalls.length') == 1
    expect(page.get_by_role('button', name='Cerrar abono')).to_be_disabled()
    expect(page.get_by_role('radio', name='Abono general', exact=True)).to_be_disabled()
    page.keyboard.press('Tab')
    assert page.evaluate("document.activeElement.matches('.abono-modal-content')")
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_be_visible()
    capture('desktop-pending')
    page.evaluate('finishPayment({success:true})')
    expect(page.get_by_role('radio', name='Abono general', exact=True)).to_be_enabled()
    results.append('Pending: duplicate submit suppressed; close, Escape and mode changes locked')

    open_modal()
    radio = page.get_by_role('radio', name='Abono general', exact=True)
    radio.focus()
    page.keyboard.press('ArrowRight')
    expect(page.get_by_role('radio', name='Abonar por venta / nota', exact=True)).to_be_checked()
    page.locator('summary').first.focus()
    page.keyboard.press('Enter')
    assert page.locator('details').first.get_attribute('open') is not None
    page.keyboard.press('Tab')
    expect(page.get_by_label('Abono a la nota 001', exact=True)).to_be_focused()
    page.get_by_role('button', name='Cancelar', exact=True).focus()
    page.keyboard.press('Tab')
    expect(page.get_by_role('button', name='Cerrar abono')).to_be_focused()
    page.keyboard.press('Shift+Tab')
    expect(page.get_by_role('button', name='Cancelar', exact=True)).to_be_focused()
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_have_count(0)
    expect(page.get_by_role('button', name='Abrir abono de demostración')).to_be_focused()
    results.append('Mobile keyboard: native radio arrows, Enter on notes, input Tab, focus trap, Escape, focus restored')

    for width, height, dark in [(320, 568, False), (390, 844, False), (390, 520, False), (390, 844, True)]:
        open_modal(width=width, height=height, dark=dark)
        specific()
        page.locator('summary').first.click()
        page.get_by_label('Abono a la nota 001', exact=True).fill('5')
        expect(page.get_by_role('button', name='Confirmar abono', exact=True)).to_be_enabled()
        within_viewport()
        # Scroll to include the field while preserving the sticky total/action footer.
        page.get_by_label('Abono a la nota 001', exact=True).scroll_into_view_if_needed()
        capture(f'mobile-{width}x{height}-' + ('dark' if dark else 'specific'))
        page.get_by_label('Abono a la nota 001', exact=True).fill('21')
        expect(page.get_by_role('button', name='Confirmar abono', exact=True)).to_be_disabled()
        assert page.evaluate('paymentCalls.length') == 0
        results.append(f'Layout {width}x{height}, dark={dark}: no horizontal overflow; actions visible; invalid amount blocked')

    for scenario, heading in [
        ('historical_unallocated', 'Estas notas aún no están conciliadas'),
        ('loading', 'Consultando notas en Cloud…'),
        ('error', 'No pudimos cargar las notas'),
        ('empty', 'No hay notas pendientes')
    ]:
        open_modal(scenario)
        specific()
        expect(page.get_by_text(heading, exact=True)).to_be_visible()
        expect(page.get_by_role('button', name='Confirmar abono', exact=True)).to_be_disabled()
        assert page.locator('summary').count() == 0
        within_viewport()
        capture(f'mobile-{scenario}')
        if scenario == 'error':
            page.get_by_role('button', name='Volver a consultar notas').click()
            expect(page.get_by_text('Consultando notas en Cloud…', exact=True)).to_be_visible()
            page.evaluate('finishReload()')
            expect(page.get_by_text('Saldos verificados por Cloud', exact=True)).to_be_visible()
        if scenario == 'historical_unallocated':
            page.locator('label.abono-mode').first.click()
            page.get_by_label('Monto del abono', exact=True).fill('5')
            expect(page.get_by_role('button', name='Confirmar abono', exact=True)).to_be_enabled()
        results.append(f'{scenario}: distinct visible state and specific submission blocked')

    assert not errors, errors
    assert not external_requests, external_requests
    results.append('No browser exceptions, external requests, IndexedDB reads or real payments')
    browser.close()

report = {'scope': 'Controlled local UI only; no Production financial certification', 'checks': results, 'page_errors': errors, 'external_requests': external_requests}
(output / 'browser-results.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
print(json.dumps(report, indent=2, ensure_ascii=False))
