import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { extractPrecachedAssetUrls } from './admin-startup-precache-audit.mjs';

const outDir = path.resolve('dist');
const assets = await readdir(path.join(outDir, 'assets'));
const worker = await readFile(path.join(outDir, 'sw.js'), 'utf8');
const cached = new Set(extractPrecachedAssetUrls(worker));
const roots = assets.filter(asset => /^(AssistantBot|botIntelligence|botReadService|botWorkerClient|inventoryAnalysis|productStats|bot\.worker)-.*\.(js|css)$/.test(asset));
if (!roots.some(asset => asset.startsWith('AssistantBot-') && asset.endsWith('.js'))) throw new Error('Missing assistant build output');
if (!roots.some(asset => /^bot\.worker-.*\.js$/.test(asset))) throw new Error('Missing independent bot Worker');
const queue = roots.map(asset => `assets/${asset}`);
const visited = new Set();
const missing = [];
while (queue.length) {
  const asset = queue.pop();
  if (visited.has(asset)) continue;
  visited.add(asset);
  if (!cached.has(asset)) missing.push(asset);
  if (!asset.endsWith('.js')) continue;
  const source = await readFile(path.join(outDir, asset), 'utf8');
  // Static ESM dependencies only. Dynamic bot roots are listed explicitly above;
  // unrelated optional applications must retain their existing loading policy.
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.\/[^"']+\.(?:js|css))["']/g)) {
    queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(asset), match[1])));
  }
}
if (missing.length) throw new Error(`Bot dependencies are not available on first offline use: ${missing.join(', ')}`);
if (!worker.includes('boticon.svg')) throw new Error('Bot icon missing from precache');
console.info(`[lanzo-bot-precache] Verified ${roots.length} bot assets and ${visited.size} static dependencies for offline use.`);
