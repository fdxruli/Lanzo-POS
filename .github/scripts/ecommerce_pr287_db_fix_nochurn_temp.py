from pathlib import Path

path = Path('src/services/db/index.js')
raw = path.read_bytes()
newline = b'\r\n' if b'\r\n' in raw else b'\n'

old_text = """            } else {
                // Con searchTerm y sin cursor: full scan para no excluir registros
                // con createdAt undefined que orderBy sí omite
                baseCollection = db.table(STORES.MENU).orderBy(timeIndex).reverse();
            }
"""
new_text = """            } else {
                // Con searchTerm y sin cursor: full scan para no excluir registros
                // con createdAt undefined que orderBy sí omite.
                // Esta rama es deliberadamente acotada: no cambia paginación normal,
                // filtros por categoría, stock/caducidad ni búsquedas con cursor.
                baseCollection = db.table(STORES.MENU).toCollection();
            }
"""
old = old_text.encode('utf-8').replace(b'\n', newline)
new = new_text.encode('utf-8').replace(b'\n', newline)
count = raw.count(old)
if count != 1:
    raise SystemExit(f'expected exactly one scoped DB branch, found {count}')
path.write_bytes(raw.replace(old, new, 1))
