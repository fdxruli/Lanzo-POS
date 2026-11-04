import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative, extname } from 'node:path';
import { parse } from '@babel/parser';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), out = resolve('scripts/qa/single-instance-f012/evidence');
const resolveImport = (source, importer) => {
  if (!source.startsWith('.')) return null;
  const base = resolve(dirname(importer), source);
  return [base, ...['.js', '.jsx', '.mjs', '.json', '.css'].map(e => base + e), resolve(base, 'index.js')].find(p => existsSync(p) && extname(p)) || null;
};
function graph(entry, dynamic) {
  const nodes = new Set(), edges = [];
  function visit(path) {
    if (nodes.has(path)) return; nodes.add(path);
    if (!['.js', '.jsx', '.mjs'].includes(extname(path))) return;
    const ast = parse(readFileSync(path, 'utf8'), { sourceType: 'module', plugins: ['jsx'], createImportExpressions: true });
    function edge(source, kind) {
      const imported = resolveImport(source, path); edges.push({ from: relative(root, path), source, to: imported && relative(root, imported), kind });
      if (imported && (kind === 'static' || dynamic)) visit(imported);
    }
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) edge(node.source.value, 'static');
      if (node.type === 'ImportExpression' && node.source?.type === 'StringLiteral') edge(node.source.value, 'dynamic');
      for (const [key, value] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'extra', 'comments'].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
      }
    }
    walk(ast.program);
  }
  visit(resolve(entry));
  return { nodes: [...nodes].map(p => relative(root, p)).sort(), edges };
}
const staticMain = graph('src/main.jsx', false), allMain = graph('src/main.jsx', true);
const coordinator = graph('src/services/instance/instanceCoordinator.js', true);
if (allMain.nodes.some(p => p.startsWith('src/services/instance/'))) throw Error('Coordinator became reachable from commercial main');
if (coordinator.nodes.length !== 3 || coordinator.nodes.some(p => !p.startsWith('src/services/instance/'))) throw Error('Business dependency in coordinator');
const base = 'f1d69093ffe3ad180752773c178b7fbaefd92ce1';
const preserved = execFileSync('git', ['ls-tree', '-r', '--name-only', base], { encoding: 'utf8' }).trim().split('\n')
  .filter(p => p.startsWith('src/') || p.startsWith('public/') || p.startsWith('store/') || p.startsWith('supabase/') || p.startsWith('.github/') || ['index.html','package.json','package-lock.json','vite.config.js','vite.store.config.js','vercel.json'].includes(p));
const hashes = preserved.map(path => {
  const expected = execFileSync('git', ['rev-parse', `${base}:${path}`], { encoding: 'utf8' }).trim();
  const current = execFileSync('git', ['hash-object', path], { encoding: 'utf8' }).trim();
  if (expected !== current) throw Error('Changed existing commercial file: ' + path);
  return { path, gitBlob: current };
});
writeFileSync(resolve(out, 'import-graph.json'), JSON.stringify({ base, staticMain, allMain, coordinator, coordinatorReachable: false }, null, 2));
writeFileSync(resolve(out, 'preserved-source-hashes.json'), JSON.stringify(hashes, null, 2));
const sourceHashes = readdirSync('src/services/instance').filter(p => p.endsWith('.js')).map(p => {const path = 'src/services/instance/' + p;return {path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex')};});
writeFileSync(resolve(out, 'coordinator-source-hashes.json'), JSON.stringify(sourceHashes, null, 2));
console.log(JSON.stringify({ staticModules: staticMain.nodes.length, reachableLocalModules: allMain.nodes.length, coordinatorModules: coordinator.nodes.length, unchangedFiles: hashes.length, coordinatorReachable: false }));
