import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_PATH,
  REPO_ROOT,
  enumerateFiles,
  loadBoundaryManifest,
  outputRelativePath,
  restrictedAssetBuffers,
  sha256File,
  updateBoundaryAudit
} from './release-boundary.mjs';
import { auditOssRelease } from './audit-oss-release.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function assertGitUnchanged(manifest) {
  const protectedPaths = [
    'icono/icono.png',
    'public/icono.png',
    'icono/icono-web.png',
    'public/icono-web.png',
    'public/pwa-192x192.png',
    'public/pwa-512x512.png',
    'public/log.svg',
    'public/logIcon.svg',
    'public/boticon.svg',
    'src',
    'store',
    'index.html',
    'vite.config.js',
    'vite.store.config.js',
    'supabase',
    'vercel.json',
    '.github'
  ];
  try {
    execFileSync('git', ['diff', '--exit-code', manifest.baseCommit, '--', ...protectedPaths], { cwd: REPO_ROOT, stdio: 'ignore' });
  } catch {
    throw new Error('OFFICIAL PRODUCTION IDENTITY: MODIFIED');
  }
  if (existsSync(join(REPO_ROOT, 'LICENSE'))) throw new Error('LICENSE must not be created by OSS.1.4.4.');
  const trackedOutput = execFileSync('git', ['ls-files', '.oss-release'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  if (trackedOutput) throw new Error('.oss-release must remain untracked.');
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', '72590fd200be6200e44cf64c14ef38204526d4bf', 'HEAD'], { cwd: REPO_ROOT, stdio: 'ignore' });
    throw new Error('Rejected PR #171 head is an ancestor of the current branch.');
  } catch (error) {
    if (error.message.includes('Rejected PR')) throw error;
  }
}

function assertBuildFiles(buildPath, kind) {
  if (!buildPath || !existsSync(buildPath)) throw new Error(`${kind} build directory is missing.`);
  const files = enumerateFiles(buildPath);
  const paths = new Set(files.map((filePath) => outputRelativePath(buildPath, filePath)));
  if (kind === 'ADMIN') {
    for (const required of ['index.html', 'manifest.webmanifest', 'pwa-192x192.png', 'pwa-512x512.png', 'logIcon.svg', 'sw.js']) {
      if (!paths.has(required)) throw new Error(`ADMIN build is missing ${required}.`);
    }
    const manifest = JSON.parse(readFileSync(join(buildPath, 'manifest.webmanifest'), 'utf8'));
    if (manifest.name !== 'Unbranded POS' || manifest.short_name !== 'POS') throw new Error('ADMIN manifest retained official identity.');
    for (const icon of manifest.icons || []) {
      if (!paths.has(icon.src.replace(/^\//u, ''))) throw new Error(`ADMIN PWA manifest icon does not resolve: ${icon.src}`);
    }
    const worker = readFileSync(join(buildPath, 'sw.js'), 'utf8');
    for (const required of ['manifest.webmanifest', 'pwa-192x192.png', 'pwa-512x512.png', 'logIcon.svg']) {
      if (!worker.includes(required)) throw new Error(`ADMIN precache does not contain ${required}.`);
    }
  } else {
    if (!paths.has('index.html')) throw new Error('STORE build is missing index.html.');
    const html = readFileSync(join(buildPath, 'index.html'), 'utf8');
    if (/\b(?:Lanzo|LANZO)\b/gu.test(html)) throw new Error('STORE build retained visible official identity.');
    const favicon = html.match(/<link[^>]+rel=["']icon["'][^>]+href=["']([^"']+)["']/iu)?.[1];
    if (!favicon) throw new Error('STORE favicon is missing.');
    const faviconPath = favicon.startsWith('/') ? favicon.slice(1) : favicon;
    if (!paths.has(faviconPath) && !paths.has(faviconPath.replace(/^public\//u, ''))) {
      throw new Error(`STORE favicon does not resolve: ${favicon}`);
    }
  }
  return { fileCount: files.length, paths: [...paths].sort() };
}

function assertNoOfficialBytes(buildPath, manifest) {
  const matches = [];
  const buffers = restrictedAssetBuffers(manifest);
  for (const filePath of enumerateFiles(buildPath)) {
    const bytes = readFileSync(filePath);
    const hash = sha256File(filePath);
    for (const asset of buffers) {
      const binaryCandidate = /\.(?:png|svg|webp|ico|bin|dat|zip)$/iu.test(filePath);
      if (hash === asset.sha256 || (binaryCandidate && bytes.length >= asset.bytes.length && bytes.includes(asset.bytes))) {
        matches.push({ path: relative(buildPath, filePath), restrictedPath: asset.path });
      }
    }
  }
  if (matches.length) throw new Error(`Restricted official asset found in build: ${matches.map(({ path }) => path).join(', ')}`);
  return matches;
}

function compareTrees(rootA, rootB) {
  const inventory = (root) => new Map(enumerateFiles(root).map((filePath) => [outputRelativePath(root, filePath), { size: readFileSync(filePath).byteLength, sha256: sha256File(filePath) }]));
  const a = inventory(rootA);
  const b = inventory(rootB);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const differences = paths.filter((path) => !a.has(path) || !b.has(path) || a.get(path).size !== b.get(path).size || a.get(path).sha256 !== b.get(path).sha256);
  if (differences.length) throw new Error(`BLOCKED - OSS export is not deterministic: ${differences.join(', ')}`);
  return { fileCount: paths.length, differences: [] };
}

export async function verifyOssRelease({ outputRoot, adminBuildPath, storeBuildPath, compareRootA, compareRootB } = {}) {
  const manifest = loadBoundaryManifest(MANIFEST_PATH);
  assertGitUnchanged(manifest);
  const report = await auditOssRelease({ outputRoot, adminBuildPath, storeBuildPath });
  const admin = assertBuildFiles(adminBuildPath, 'ADMIN');
  const store = assertBuildFiles(storeBuildPath, 'STORE');
  const adminOfficialBytes = assertNoOfficialBytes(adminBuildPath, manifest);
  const storeOfficialBytes = assertNoOfficialBytes(storeBuildPath, manifest);
  const deterministic = compareRootA && compareRootB ? compareTrees(compareRootA, compareRootB) : { status: 'NOT_RUN' };
  const finalReport = {
    ...report,
    deterministic: deterministic.status || 'PASS',
    adminBuild: admin,
    storeBuild: store,
    adminOfficialBytes,
    storeOfficialBytes,
    officialProductionIdentity: 'UNCHANGED',
    license: 'NOT CREATED',
    agpl: 'NOT ACTIVATED'
  };
  updateBoundaryAudit(report.outputPath, finalReport);
  return finalReport;
}

async function main() {
  const finalReport = await verifyOssRelease({
    outputRoot: option('--output-root') || undefined,
    adminBuildPath: option('--admin-build'),
    storeBuildPath: option('--store-build'),
    compareRootA: option('--compare-root-a'),
    compareRootB: option('--compare-root-b')
  });
  process.stdout.write(`${JSON.stringify(finalReport, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
