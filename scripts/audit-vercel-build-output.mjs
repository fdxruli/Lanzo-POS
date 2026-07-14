/**
 * Read-only gate for Vercel Build Output API artifacts.
 *
 * Usage:
 *   node scripts/audit-vercel-build-output.mjs store <temporary-package-root>
 *   node scripts/audit-vercel-build-output.mjs admin <temporary-package-root>
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const rootVercelDirectory = path.join(projectRoot, '.vercel');
const noindexHeader = 'noindex, nofollow, noarchive';
const revalidateCache = 'public, max-age=0, must-revalidate';
const immutableCache = 'public, max-age=31536000, immutable';
const targets = Object.freeze({
  store: {
    projectId: 'prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4',
    prefix: 'lanzo-store-cutover-1-1-',
    sourceConfig: path.join(projectRoot, 'vercel.store.json'),
    sourceDist: path.join(projectRoot, 'dist-store')
  },
  admin: {
    projectId: 'prj_tE5uWn6kLBYdS1eDFWVxRm449RUr',
    prefix: 'lanzo-pos-cutover-1-1-',
    sourceConfig: path.join(projectRoot, 'vercel.json'),
    sourceDist: path.join(projectRoot, 'dist')
  }
});
const organizationId = 'team_buvft2mAJErTNR8gDhXcZGfS';
const sensitivePaths = Object.freeze([
  '/sw.js', '/manifest.webmanifest', '/registerSW.js', '/workbox-fixture.js',
  '/.env', '/.env.local', '/package.json', '/package-lock.json', '/src',
  '/src/main-store.jsx', '/vite.config.js', '/vite.store.config.js', '/vercel.json',
  '/.git', '/node_modules', '/docs', '/scripts'
]);
const normalizePath = (value) => value.replaceAll('\\', '/');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const metadata = await lstat(absolutePath);
    const relativePath = normalizePath(path.relative(root, absolutePath));
    if (metadata.isSymbolicLink()) throw new Error(`Symbolic link forbidden: ${relativePath}`);
    if (entry.isDirectory()) files.push(...await walk(absolutePath, root));
    else if (entry.isFile()) files.push({ absolutePath, relativePath, bytes: metadata.size });
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function manifest(files) {
  return Promise.all(files.map(async (file) => ({
    path: file.relativePath,
    bytes: file.bytes,
    sha256: sha256(await readFile(file.absolutePath))
  })));
}

function treeHash(items) {
  return sha256(items.map((item) => `${item.sha256}  ${item.path}`).join('\n'));
}

function expectedPackageConfigBytes(targetName, sourceConfigBytes) {
  if (targetName !== 'admin') return sourceConfigBytes;
  return Buffer.from(`${JSON.stringify({
    ...JSON.parse(sourceConfigBytes.toString('utf8')),
    framework: null
  }, null, 2)}\n`);
}

function routeMatches(route, requestPath) {
  if (typeof route?.src !== 'string') return false;
  try {
    return new RegExp(route.src).test(requestPath);
  } catch {
    return false;
  }
}

function hasHeaderRoute(routes, key, value, matcher = () => true) {
  return routes.some((route) => route.headers?.[key] === value && matcher(route));
}

function assertTemporaryRoot(packageRoot, target) {
  const resolved = path.resolve(packageRoot);
  return {
    resolved,
    valid: path.dirname(resolved) === path.resolve(os.tmpdir())
      && path.basename(resolved).startsWith(target.prefix)
  };
}

function inspectRouteContract(targetName, sourceConfig, outputConfig) {
  const routes = Array.isArray(outputConfig.routes) ? outputConfig.routes : [];
  const filesystemIndex = routes.findIndex((route) => route.handle === 'filesystem');
  const errorIndex = routes.findIndex((route) => route.handle === 'error');
  const rewrites = routes
    .map((route, index) => ({ route, index }))
    .filter(({ route, index }) => index > filesystemIndex && typeof route.dest === 'string');
  const routeForPath = (requestPath) => rewrites.some(({ route }) => (
    routeMatches(route, requestPath) && route.dest.startsWith('/index.html')
  ));
  const checks = {
    version3: outputConfig.version === 3,
    routesPresent: routes.length > 1,
    filesystemGate: filesystemIndex >= 0,
    errorGateAfterFilesystem: errorIndex > filesystemIndex,
    noFunctions: !outputConfig.functions,
    noMiddleware: !outputConfig.middleware && !routes.some((route) => route.middlewarePath),
    noDomains: !outputConfig.domains && !outputConfig.alias,
    noPosRedirect: !JSON.stringify(outputConfig).includes('lanzo-pos.vercel.app'),
    noSourceExposure: targetName !== 'store'
      || sensitivePaths.every((requestPath) => !routeForPath(requestPath))
  };

  if (targetName === 'store') {
    const canonicalRoute = routes.find((route) => (
      route.status === 308
      && route.headers?.Location === '/$1'
      && route.headers?.['X-Robots-Tag'] === noindexHeader
      && typeof route.src === 'string'
      && route.src.includes('(.*)/$')
    ));
    checks.trailingSlashFalse = Boolean(canonicalRoute) && sourceConfig.trailingSlash === false;
    checks.globalNoindex = hasHeaderRoute(routes, 'X-Robots-Tag', noindexHeader);
    checks.immutableAssets = hasHeaderRoute(
      routes,
      'Cache-Control',
      immutableCache,
      (route) => routeMatches(route, '/assets/example-hash.js')
    );
    checks.revalidatedIndex = hasHeaderRoute(
      routes,
      'Cache-Control',
      revalidateCache,
      (route) => routeMatches(route, '/') || routeMatches(route, '/index.html')
    );
    checks.publicSpaRoutes = ['/', '/tienda', '/tienda/example', '/conoce-lanzo'].every(routeForPath);
    checks.sensitivePaths404 = sensitivePaths.every((requestPath) => !routeForPath(requestPath));
    checks.noAdministrativeFallback = !routeForPath('/dashboard') && !routeForPath('/login');
    checks.filesystemBeforeSpa = rewrites
      .filter(({ route }) => route.dest.startsWith('/index.html'))
      .every(({ index }) => index > filesystemIndex);
    checks.errorAfterSpa = rewrites
      .filter(({ route }) => route.dest.startsWith('/index.html'))
      .every(({ index }) => errorIndex > index);
  } else {
    checks.adminSpaFallback = routeForPath('/dashboard') && routeForPath('/tienda/legacy');
    checks.adminCoopHeader = hasHeaderRoute(routes, 'Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    checks.noStoreRoutingConfig = !JSON.stringify(outputConfig).includes('lanzo-store.vercel.app');
    checks.filesystemBeforeSpa = rewrites
      .filter(({ route }) => route.dest.startsWith('/index.html'))
      .every(({ index }) => index > filesystemIndex);
  }
  return { checks, routes: routes.length, filesystemIndex, errorIndex, rewrites: rewrites.length };
}

function inspectStaticSafety(targetName, staticManifest) {
  const paths = staticManifest.map((item) => item.path);
  const joined = paths.join('\n');
  const checks = {
    noSource: !paths.some((item) => /^(?:src|tests|docs|scripts|node_modules)\//i.test(item)),
    noEnvironmentFiles: !paths.some((item) => /(^|\/)\.env(?:\.|$)/i.test(item)),
    noSourceMaps: !paths.some((item) => item.endsWith('.map')),
    noPackages: !paths.some((item) => /^package(?:-lock)?\.json$/i.test(item)),
    noFunctions: !paths.some((item) => /(^|\/)functions?(\/|$)/i.test(item))
  };
  if (targetName === 'store') {
    checks.noPublicPwa = !/(^|\n)(?:sw\.js|manifest\.webmanifest|registerSW\.js|workbox-[^\n]+)(?:\n|$)/i.test(joined);
    checks.noAdministrativeChunks = !paths.some((item) => /(?:Dashboard|PosPage|Caja|Settings|vendor_charts)/i.test(item));
    checks.robotsPresent = paths.includes('robots.txt');
  } else {
    checks.adminPwaPresent = paths.includes('manifest.webmanifest')
      && paths.includes('sw.js')
      && staticManifest.some((item) => item.path === 'sw.js' && item.bytes > 0);
  }
  return checks;
}

export async function auditPrebuiltOutput(targetName, packageRootArgument) {
  const target = targets[targetName];
  if (!target) throw new Error('Target must be store or admin.');
  const packageRootState = assertTemporaryRoot(packageRootArgument, target);
  const packageRoot = packageRootState.resolved;
  const packageConfigPath = path.join(packageRoot, 'vercel.json');
  const projectLinkPath = path.join(packageRoot, '.vercel', 'project.json');
  const outputConfigPath = path.join(packageRoot, '.vercel', 'output', 'config.json');
  const outputStaticPath = path.join(packageRoot, '.vercel', 'output', 'static');
  const requiredPaths = [packageConfigPath, projectLinkPath, outputConfigPath, outputStaticPath];
  const missingRequiredPaths = [];
  for (const requiredPath of requiredPaths) {
    if (!await pathExists(requiredPath)) missingRequiredPaths.push(requiredPath);
  }
  if (missingRequiredPaths.length > 0) throw new Error(`Missing prebuilt paths: ${missingRequiredPaths.join(', ')}`);

  const [sourceConfigBytes, packageConfigBytes, outputConfigBytes] = await Promise.all([
    readFile(target.sourceConfig),
    readFile(packageConfigPath),
    readFile(outputConfigPath)
  ]);
  const sourceConfig = JSON.parse(sourceConfigBytes.toString('utf8'));
  const expectedConfigBytes = expectedPackageConfigBytes(targetName, sourceConfigBytes);
  const packageConfig = JSON.parse(packageConfigBytes.toString('utf8'));
  const outputConfig = JSON.parse(outputConfigBytes.toString('utf8'));
  const projectLink = JSON.parse(await readFile(projectLinkPath, 'utf8'));
  const sourceFiles = await walk(target.sourceDist);
  const outputFiles = await walk(outputStaticPath);
  const [sourceManifest, outputManifest] = await Promise.all([manifest(sourceFiles), manifest(outputFiles)]);
  const outputByPath = new Map(outputManifest.map((item) => [item.path, item]));
  const artifactMatches = sourceManifest.every((item) => {
    const output = outputByPath.get(item.path);
    return output?.sha256 === item.sha256 && output.bytes === item.bytes;
  });
  const allowedOutputPaths = new Set([
    ...sourceManifest.map((item) => item.path),
    ...(targetName === 'store' ? ['robots.txt'] : [])
  ]);
  const extraOutputFiles = outputManifest.filter((item) => !allowedOutputPaths.has(item.path)).map((item) => item.path);
  const routeAudit = inspectRouteContract(targetName, sourceConfig, outputConfig);
  const staticChecks = inspectStaticSafety(targetName, outputManifest);
  const checks = {
    temporaryRootExact: packageRootState.valid,
    rootVercelUntouched: !await pathExists(rootVercelDirectory),
    projectLinkMatches: projectLink.projectId === target.projectId && projectLink.orgId === organizationId,
    sourceConfigMatches: sha256(expectedConfigBytes) === sha256(packageConfigBytes),
    authorizedFrameworkOverride: targetName !== 'admin' || packageConfig.framework === null,
    artifactMatches,
    noExtraStaticFiles: extraOutputFiles.length === 0,
    ...routeAudit.checks,
    ...staticChecks
  };
  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  const report = {
    phase: 'ECOM.PUBLIC.CUTOVER.1.1',
    target: targetName,
    status: failedChecks.length === 0 ? 'PASS' : 'FAIL',
    packageRoot,
    projectId: projectLink.projectId,
    hashes: {
      sourceConfig: sha256(sourceConfigBytes),
      deploymentConfig: sha256(packageConfigBytes),
      outputConfig: sha256(outputConfigBytes),
      sourceArtifactTree: treeHash(sourceManifest),
      outputStaticTree: treeHash(outputManifest)
    },
    output: {
      configVersion: outputConfig.version,
      routes: routeAudit.routes,
      rewrites: routeAudit.rewrites,
      files: outputFiles.length,
      bytes: outputFiles.reduce((total, file) => total + file.bytes, 0),
      extraOutputFiles
    },
    checks,
    failedChecks
  };
  return report;
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedAsScript) {
  auditPrebuiltOutput(process.argv[2], process.argv[3])
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.status !== 'PASS') process.exitCode = 1;
    })
    .catch((error) => {
      console.error(JSON.stringify({ status: 'FAIL', error: String(error?.message || error).slice(0, 500) }));
      process.exitCode = 1;
    });
}
