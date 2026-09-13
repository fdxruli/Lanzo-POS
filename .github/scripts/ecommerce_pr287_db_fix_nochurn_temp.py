from pathlib import Path

path = Path('src/services/db/index.js')
raw = path.read_bytes()

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

old_lf = old_text.encode('utf-8')
new_lf = new_text.encode('utf-8')
old_crlf = old_lf.replace(b'\n', b'\r\n')
new_crlf = new_lf.replace(b'\n', b'\r\n')

if raw.count(old_lf) == 1:
    old, new = old_lf, new_lf
elif raw.count(old_crlf) == 1:
    old, new = old_crlf, new_crlf
else:
    raise SystemExit(
        f'expected exactly one scoped DB branch; lf={raw.count(old_lf)} crlf={raw.count(old_crlf)}'
    )

path.write_bytes(raw.replace(old, new, 1))
