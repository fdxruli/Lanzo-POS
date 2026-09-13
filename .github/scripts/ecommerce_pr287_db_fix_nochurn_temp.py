from pathlib import Path

path = Path('src/services/db/index.js')
raw = path.read_bytes()
marker = "// con createdAt undefined que orderBy sí omite".encode('utf-8')
code = b"                baseCollection = db.table(STORES.MENU).orderBy(timeIndex).reverse();"
replacement = b"                baseCollection = db.table(STORES.MENU).toCollection();"

marker_index = raw.find(marker)
if marker_index < 0 or raw.find(marker, marker_index + 1) >= 0:
    raise SystemExit('expected exactly one legacy createdAt search marker')
code_index = raw.find(code, marker_index)
if code_index < 0 or code_index - marker_index > 256:
    raise SystemExit('scoped legacy search expression not found after marker')

line_end = raw.find(b'\n', code_index)
if line_end < 0:
    raise SystemExit('legacy search expression line ending not found')

# Replace only the proven legacy-search expression. Normalize only this newly
# modified line to LF so git diff --check cannot interpret a CR as added
# trailing whitespace; all unrelated bytes remain untouched.
raw = raw[:code_index] + replacement + b'\n' + raw[line_end + 1:]
path.write_bytes(raw)
