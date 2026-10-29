// Reuse the exact F01-1 runner; redirect only evidence, preserve its files.
import { readFile } from 'node:fs/promises';
const original = await readFile('scripts/qa/single-instance-f011/browser.mjs', 'utf8');
const source = original
  .replace("const output = join(root, 'evidence');", "const output = resolve('scripts/qa/single-instance-f012/evidence/f011-browser');")
  .replace("from 'esbuild'", `from '${import.meta.resolve('esbuild')}'`);
await import(`data:text/javascript,${encodeURIComponent(source)}`);
