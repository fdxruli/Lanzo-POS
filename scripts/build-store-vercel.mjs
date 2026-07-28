/**
 * Builds and stages the standalone public store for Vercel Git integration.
 * This script never calls the Vercel CLI and never deploys.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateStoreHtmlTemplate } from '../store/api/_storeHtmlTemplate.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = path.join(projectRoot, 'dist-store');
const stagingRoot = path.join(projectRoot, 'store', 'dist');
const generatedTemplatePath = path.join(
  projectRoot,
  'store',
  'generated',
  'storeHtmlTemplate.js'
);
const robotsText = 'User-agent: *\nDisallow: /\n';
const normalizePath = (value) => value.replaceAll('\\', '/');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const forbiddenPathPatterns = Object.freeze([
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:package(?:-lock)?\.json|manifest(?:\.webmanifest)?|sw\.js|service-worker\.js|registerSW[^/]*\.js)$/i,
  /(^|\/)(?:src|source|scripts|docs|node_modules)(\/|$)/i,
  /\.map$/i,
  /(^|\/)workbox[^/]*\.js$/i
]);

const forbiddenContentPatterns = Object.freeze({
  pwa: /virtual:pwa-register|serviceWorker\.register|registerSW|workbox|manifest\.webmanifest/i,
  adminShell: /(?:^|["'\/])App\.jsx|PosPage|CajaPage|Dashboard|EcommercePortalSettings|ScannerModal|PublicStoreQrCode/i,
  adminContracts: /create_free_trial_license|device_security_token|staff_session_token|processSale|cashSync|posSync/i,
  privateToken: /(?:VERCEL_TOKEN|GITHUB_TOKEN|SUPABASE_SERVICE_ROLE|service_role|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i
});

const allowedRootFiles = new Set(['index.html', 'robots.txt']);
const allowedAssetExtensions = new Set([
  '.avif', '.css', '.gif', '.ico', '.jpeg', '.jpg', '.js', '.png', '.svg', '.webp'
]);
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.svg', '.txt', '.webmanifest']);
const functionSourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const allowedBareImports = new Set(['@vercel/og', 'react']);
const expectedPublicFunctions = Object.freeze(['/api/og/store', '/api/store-page']);

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function walkFiles(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const metadata = await lstat(absolutePath);
    const relativePath = normalizePath(path.relative(root, absolutePath));
    if (metadata.isSymbolicLink()) throw new Error(`Symbolic link forbidden: ${relativePath}`);
    if (entry.isDirectory()) files.push(...await walkFiles(absolutePath, root));
    else if (entry.isFile()) files.push({ absolutePath, relativePath, bytes: metadata.size });
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function fileManifest(directory) {
  const files = await walkFiles(directory);
  return Promise.all(files.map(async (file) => ({
    path: file.relativePath,
    bytes: file.bytes,
    sha256: sha256(await readFile(file.absolutePath))
  })));
}

function isAllowlisted(relativePath, requireRobots) {
  if (allowedRootFiles.has(relativePath)) return requireRobots || relativePath !== 'robots.txt';
  if (!relativePath.startsWith('assets/')) return false;
  const assetName = relativePath.slice('assets/'.length);
  return !assetName.includes('/')
    && /-[A-Za-z0-9_-]{6,}\.[^.]+$/.test(assetName)
    && allowedAssetExtensions.has(path.extname(assetName).toLowerCase());
}

function containsServiceRoleJwt(source) {
  for (const token of source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
    try {
      const payload = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
      const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
      if (JSON.parse(Buffer.from(padded, 'base64').toString('utf8')).role === 'service_role') return true;
    } catch {
      // An invalid token-shaped value is not treated as a privileged JWT.
    }
  }
  return false;
}

export async function auditStoreArtifact(directory, { requireRobots = false } = {}) {
  const files = await walkFiles(directory);
  const violations = [];
  const paths = files.map((file) => file.relativePath);

  if (!paths.includes('index.html')) violations.push('missing:index.html');
  if (requireRobots) {
    if (!paths.includes('robots.txt')) violations.push('missing:robots.txt');
    else if (await readFile(path.join(directory, 'robots.txt'), 'utf8') !== robotsText) {
      violations.push('invalid:robots.txt');
    }
  }

  for (const file of files) {
    if (!isAllowlisted(file.relativePath, requireRobots)) violations.push(`not-allowlisted:${file.relativePath}`);
    if (forbiddenPathPatterns.some((pattern) => pattern.test(file.relativePath))) {
      violations.push(`forbidden-path:${file.relativePath}`);
    }
    if (!textExtensions.has(path.extname(file.relativePath).toLowerCase())) continue;
    const source = await readFile(file.absolutePath, 'utf8');
    for (const [name, pattern] of Object.entries(forbiddenContentPatterns)) {
      if (pattern.test(source)) violations.push(`forbidden-content:${name}:${file.relativePath}`);
    }
    if (containsServiceRoleJwt(source)) violations.push(`forbidden-content:service-role-jwt:${file.relativePath}`);
  }

  const manifest = await fileManifest(directory);
  return {
    passed: violations.length === 0,
    violations: [...new Set(violations)].sort(),
    files: manifest.length,
    bytes: manifest.reduce((total, file) => total + file.bytes, 0),
    manifest,
    treeSha256: sha256(manifest.map((file) => `${file.sha256}  ${file.path}`).join('\n'))
  };
}

export function compareArtifactManifests(sourceManifest, stagingManifest) {
  const stagingWithoutRobots = stagingManifest.filter((file) => file.path !== 'robots.txt');
  const sourceComparable = sourceManifest.map(({ path: filePath, bytes, sha256: fileHash }) => ({
    path: filePath,
    bytes,
    sha256: fileHash
  }));
  const stagingComparable = stagingWithoutRobots.map(({ path: filePath, bytes, sha256: fileHash }) => ({
    path: filePath,
    bytes,
    sha256: fileHash
  }));
  if (JSON.stringify(sourceComparable) !== JSON.stringify(stagingComparable)) {
    throw new Error('store/dist differs from dist-store (excluding robots.txt).');
  }
}

function extractGeneratedConstant(moduleSource, name) {
  const match = moduleSource.match(new RegExp(
    `export const ${name} = (.+);`,
    'u',
  ));
  if (!match) throw new Error(`Generated template is missing ${name}.`);
  return JSON.parse(match[1]);
}

export async function verifyTemplateSynchronization({
  sourceHtmlPath,
  generatedModulePath,
  stagedHtmlPath,
}) {
  const [sourceHtml, generatedSource, stagedHtml] = await Promise.all([
    readFile(sourceHtmlPath, 'utf8'),
    readFile(generatedModulePath, 'utf8'),
    readFile(stagedHtmlPath, 'utf8'),
  ]);
  const templateHtml = extractGeneratedConstant(generatedSource, 'STORE_HTML_TEMPLATE');
  const declaredBytes = extractGeneratedConstant(generatedSource, 'STORE_HTML_BYTES');
  const declaredHash = extractGeneratedConstant(generatedSource, 'STORE_HTML_SHA256');
  validateStoreHtmlTemplate(sourceHtml);
  validateStoreHtmlTemplate(templateHtml);
  validateStoreHtmlTemplate(stagedHtml);
  const hashes = {
    source: sha256(sourceHtml),
    template: sha256(templateHtml),
    staged: sha256(stagedHtml),
  };
  const bytes = {
    source: Buffer.byteLength(sourceHtml, 'utf8'),
    template: Buffer.byteLength(templateHtml, 'utf8'),
    staged: Buffer.byteLength(stagedHtml, 'utf8'),
  };
  if (
    sourceHtml !== templateHtml
    || sourceHtml !== stagedHtml
    || new Set(Object.values(hashes)).size !== 1
    || declaredHash !== hashes.source
    || declaredBytes !== bytes.source
  ) {
    throw new Error('Generated store HTML template is not synchronized with the current build.');
  }
  const assetReferences = [
    ...sourceHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/gu),
  ].map((match) => match[1].slice(1));
  for (const reference of assetReferences) {
    if (!await pathExists(path.join(path.dirname(stagedHtmlPath), reference))) {
      throw new Error(`Generated template references a missing staged asset: ${reference}.`);
    }
  }
  return Object.freeze({ hashes, bytes, assets: [...new Set(assetReferences)].sort() });
}

function localImports(source) {
  return [
    ...source.matchAll(
      /(?:\bimport\s+(?:[^'"]*?\s+from\s+)?|\bimport\s*\()\s*['"]([^'"]+)['"]/gu,
    ),
  ].map((match) => match[1]);
}

function endpointForSource(relativePath) {
  const segments = normalizePath(relativePath).split('/');
  const fileName = segments.at(-1);
  if (
    !functionSourceExtensions.has(path.extname(fileName).toLowerCase())
    || fileName.startsWith('_')
    || segments.slice(0, -1).some((segment) => segment.startsWith('_'))
  ) return null;
  const extension = path.extname(fileName);
  const routeSegments = [...segments.slice(0, -1), fileName.slice(0, -extension.length)];
  return `/api/${routeSegments.join('/')}`;
}

export async function auditStoreServerImports(repositoryRoot = projectRoot) {
  const storeRoot = path.join(repositoryRoot, 'store');
  const apiRoot = path.join(storeRoot, 'api');
  const sourceFiles = (await walkFiles(apiRoot))
    .filter(({ relativePath }) => functionSourceExtensions.has(path.extname(relativePath)));
  const publicFunctions = sourceFiles
    .map(({ relativePath }) => endpointForSource(relativePath))
    .filter(Boolean)
    .sort();
  if (JSON.stringify(publicFunctions) !== JSON.stringify(expectedPublicFunctions)) {
    throw new Error(`Unexpected public store functions: ${publicFunctions.join(', ') || 'none'}.`);
  }

  const dependencyClosure = {};
  for (const endpoint of expectedPublicFunctions) {
    const relativeEntry = endpoint === '/api/store-page' ? 'store-page.js' : 'og/store.jsx';
    const pending = [path.join(apiRoot, relativeEntry)];
    const visited = new Set();
    const bareImports = new Set();
    while (pending.length > 0) {
      const current = path.resolve(pending.pop());
      if (visited.has(current)) continue;
      visited.add(current);
      const relativeToStore = normalizePath(path.relative(storeRoot, current));
      if (relativeToStore.startsWith('../') || path.isAbsolute(relativeToStore)) {
        throw new Error(`${endpoint} import escaped store/: ${relativeToStore}.`);
      }
      const source = await readFile(current, 'utf8');
      for (const specifier of localImports(source)) {
        if (specifier.startsWith('node:')) continue;
        if (!specifier.startsWith('.')) {
          const packageName = specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : specifier.split('/')[0];
          bareImports.add(packageName);
          if (!allowedBareImports.has(packageName)) {
            throw new Error(`${endpoint} has an unapproved runtime dependency: ${packageName}.`);
          }
          continue;
        }
        const resolved = path.resolve(path.dirname(current), specifier);
        const relativeResolved = normalizePath(path.relative(storeRoot, resolved));
        if (relativeResolved.startsWith('../') || path.isAbsolute(relativeResolved)) {
          throw new Error(`${endpoint} import escaped store/: ${specifier}.`);
        }
        if (resolved.includes(`${path.sep}generated${path.sep}`)) continue;
        if (!await pathExists(resolved)) {
          throw new Error(`${endpoint} has a missing local import: ${relativeResolved}.`);
        }
        pending.push(resolved);
      }
    }
    dependencyClosure[endpoint] = Object.freeze({
      files: [...visited].map((file) => normalizePath(path.relative(storeRoot, file))).sort(),
      packages: [...bareImports].sort(),
    });
  }
  if (!dependencyClosure['/api/og/store'].packages.includes('@vercel/og')) {
    throw new Error('The OG function does not resolve @vercel/og.');
  }
  if (!dependencyClosure['/api/og/store'].packages.includes('react')) {
    throw new Error('The OG function does not resolve react.');
  }
  if (dependencyClosure['/api/store-page'].packages.includes('@vercel/og')) {
    throw new Error('The HTML function must not depend on @vercel/og.');
  }
  return Object.freeze({ publicFunctions, dependencyClosure });
}

function run(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true
  });
  if (result.status !== 0) {
    const detail = result.error?.message ? `: ${result.error.message}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}${detail}.`);
  }
}

export async function buildStoreForVercel() {
  const expectedCwd = path.resolve(projectRoot);
  if (path.resolve(process.cwd()) !== expectedCwd) {
    throw new Error(`Expected repository root cwd: ${expectedCwd}`);
  }

  await rm(stagingRoot, { recursive: true, force: true });
  await rm(generatedTemplatePath, { force: true });
  try {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error('npm_execpath is required to run the public build safely.');
    run(process.execPath, [npmCli, 'run', 'build:store']);
    if (!await pathExists(sourceRoot)) throw new Error('dist-store was not generated.');
    run(process.execPath, [
      path.join(projectRoot, 'scripts', 'generate-store-html-template.mjs'),
      path.join(sourceRoot, 'index.html'),
      generatedTemplatePath
    ]);
    const serverAudit = await auditStoreServerImports(projectRoot);

    run(process.execPath, [path.join(projectRoot, 'scripts', 'audit-public-delivery.mjs'), 'dist-store']);
    const sourceAudit = await auditStoreArtifact(sourceRoot);
    if (!sourceAudit.passed) throw new Error(`dist-store audit failed: ${sourceAudit.violations.join(', ')}`);

    await cp(sourceRoot, stagingRoot, { recursive: true, errorOnExist: true, force: false });
    await writeFile(path.join(stagingRoot, 'robots.txt'), robotsText, { encoding: 'utf8', flag: 'wx' });

    const stagingAudit = await auditStoreArtifact(stagingRoot, { requireRobots: true });
    if (!stagingAudit.passed) throw new Error(`store/dist audit failed: ${stagingAudit.violations.join(', ')}`);
    compareArtifactManifests(sourceAudit.manifest, stagingAudit.manifest);
    const template = await verifyTemplateSynchronization({
      sourceHtmlPath: path.join(sourceRoot, 'index.html'),
      generatedModulePath: generatedTemplatePath,
      stagedHtmlPath: path.join(stagingRoot, 'index.html'),
    });

    run(process.execPath, [path.join(projectRoot, 'scripts', 'audit-public-delivery.mjs'), 'store/dist']);
    const finalAudit = await auditStoreArtifact(stagingRoot, { requireRobots: true });
    if (!finalAudit.passed) throw new Error(`Final store/dist audit failed: ${finalAudit.violations.join(', ')}`);

    const summary = {
      phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.6',
      status: 'staged',
      deployed: false,
      source: {
        directory: 'dist-store',
        files: sourceAudit.files,
        bytes: sourceAudit.bytes,
        treeSha256: sourceAudit.treeSha256
      },
      staging: {
        directory: 'store/dist',
        files: finalAudit.files,
        bytes: finalAudit.bytes,
        treeSha256: finalAudit.treeSha256,
        robotsTxt: true
      },
      copiedFilesByteIdentical: true,
      template,
      functions: serverAudit,
      violations: []
    };
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    await rm(generatedTemplatePath, { force: true });
    throw error;
  }
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  buildStoreForVercel().catch((error) => {
    console.error(JSON.stringify({
      phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.6',
      status: 'failed',
      error: String(error?.message || error).slice(0, 500)
    }));
    process.exitCode = 1;
  });
}
