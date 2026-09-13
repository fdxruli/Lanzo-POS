from pathlib import Path

path = Path('src/components/ecommerce/__tests__/EcommercePortalSettings.productModalLifecycle.test.jsx')
text = path.read_text(encoding='utf-8')

old_copy = "expect(screen.getByRole('button', { name: 'Cargar más productos' }).disabled).toBe(false);"
new_copy = "expect(screen.getByRole('button', { name: 'Cargar más resultados' }).disabled).toBe(false);"
if text.count(old_copy) != 1:
    raise SystemExit(f'expected one stale-load-more copy assertion, found {text.count(old_copy)}')
text = text.replace(old_copy, new_copy, 1)

old_precondition = """  it('releases stale load-more loading after a newer search wins the catalog race', async () => {
    await renderCatalog();
    await openPublishModal();

    fireEvent.change(getProductSelect(), {
"""
new_precondition = """  it('releases stale load-more loading after a newer search wins the catalog race', async () => {
    await renderCatalog();
    await openPublishModal();
    await screen.findByRole('option', { name: /Producto Uno/ });

    fireEvent.change(getProductSelect(), {
"""
if text.count(old_precondition) != 1:
    raise SystemExit(f'expected one load-more race precondition, found {text.count(old_precondition)}')
text = text.replace(old_precondition, new_precondition, 1)

path.write_text(text, encoding='utf-8')
