from pathlib import Path

path = Path('src/services/db/index.js')
raw = path.read_bytes()
old = b"                baseCollection = db.table(STORES.MENU).orderBy(timeIndex).reverse();"
new = b"                baseCollection = db.table(STORES.MENU).toCollection();"
count = raw.count(old)
if count != 1:
    raise SystemExit(f'expected exactly one scoped DB search expression, found {count}')
path.write_bytes(raw.replace(old, new, 1))
