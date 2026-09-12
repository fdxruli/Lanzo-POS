from pathlib import Path

path = Path('src/components/ecommerce/__tests__/EcommercePortalSettings.test.jsx')
text = path.read_text(encoding='utf-8')
old = "    expect(screen.getByText('Presentación de tu tienda')).toBeInTheDocument();"
new = "    expect(screen.getByText('Identidad visual de tu tienda')).toBeInTheDocument();"
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected one stale Free design heading assertion, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Free design regression expectation aligned')
