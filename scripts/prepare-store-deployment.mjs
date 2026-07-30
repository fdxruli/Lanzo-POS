/**
 * Builds and audits a prebuilt lanzo-store artifact in a sanitized temporary workspace.
 * It never deploys, promotes, aliases, or modifies the repository's .vercel link.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  auditPrebuiltOutput,
  classifyGeneratedHandlerSyntax,
  formatSafetyFailureDetails,
  inspectStatic,
} from './audit-vercel-build-output.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const STORE_PROJECT_ID = 'prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4';
const STORE_ORGANIZATION_ID = 'team_buvft2mAJErTNR8gDhXcZGfS';
const STORE_PROJECT_NAME = 'lanzo-store';
const TEMPORARY_PREFIX = 'lanzo-store-social-preview-1-6-';
const GIT_SNAPSHOT_PREFIX = 'lanzo-store-git-snapshot-';
const PRESERVE_PASSED_EVIDENCE_ENV = 'PRESERVE_STORE_PREBUILT_EVIDENCE';
const TARGET_ENVIRONMENT = 'preview';
const DEPLOYMENT_TYPE = 'preview';
const PULL_COMMAND = 'vercel pull --yes --environment=preview';
const BUILD_COMMAND = 'vercel build --debug --local-config ./store/vercel.prebuilt.json';
const DEPLOY_COMMAND = 'vercel deploy --prebuilt --yes';
const DIRECT_STORE_BUILD_COMMAND = 'npm run build:store:vercel';
const DEFAULT_VERCEL_COMMAND = 'vercel';
const normalizePath = (value) => value.replaceAll('\\', '/');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const EXPECTED_PUBLIC_FUNCTION_ROUTES = Object.freeze(['/api/og/store', '/api/store-page']);

const excludedRootNames = new Set([
  '.git',
  '.vercel',
  'coverage',
  'dist',
  'dist-store',
  'docs',
  'node_modules',
  'supabase',
]);

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export function createPrebuiltVercelConfig(sourceConfig) {
  const prebuiltConfig = structuredClone(sourceConfig);
  delete prebuiltConfig.installCommand;
  delete prebuiltConfig.buildCommand;
  assertPrebuiltVercelConfigParity(sourceConfig, prebuiltConfig);
  return prebuiltConfig;
}

export function assertPrebuiltVercelConfigParity(sourceConfig, prebuiltConfig) {
  if (!sourceConfig || typeof sourceConfig !== 'object' || Array.isArray(sourceConfig)) {
    throw new TypeError('The source Vercel configuration must be an object.');
  }
  if (!prebuiltConfig || typeof prebuiltConfig !== 'object' || Array.isArray(prebuiltConfig)) {
    throw new TypeError('The prebuilt Vercel configuration must be an object.');
  }
  if ('installCommand' in prebuiltConfig || 'buildCommand' in prebuiltConfig) {
    throw new Error('The prebuilt Vercel configuration must not contain shell build commands.');
  }
  const expected = structuredClone(sourceConfig);
  delete expected.installCommand;
  delete expected.buildCommand;
  const allowedBuilds = prebuiltConfig.builds;
  if (allowedBuilds !== undefined) {
    if (!Array.isArray(allowedBuilds) || allowedBuilds.length !== 2) {
      throw new Error('The prebuilt Vercel configuration may only add the two exact public function entries.');
    }
    const expectedEntries = [
      { src: 'api/store-page.js', use: '@vercel/node' },
      { src: 'api/og/store.js', use: '@vercel/node' },
    ];
    if (JSON.stringify(allowedBuilds) !== JSON.stringify(expectedEntries)) {
      throw new Error('The prebuilt Vercel configuration may only add the two exact public function entries.');
    }
    expected.builds = allowedBuilds;
  }
  if (JSON.stringify(expected) !== JSON.stringify(prebuiltConfig)) {
    throw new Error('The prebuilt Vercel configuration differs from store/vercel.json beyond shell build commands.');
  }
}

export async function writePrebuiltVercelConfig({ sourceConfigPath, targetConfigPath }) {
  const sourceConfig = JSON.parse(await readFile(sourceConfigPath, 'utf8'));
  const prebuiltConfig = createPrebuiltVercelConfig(sourceConfig);
  await writeFile(targetConfigPath, `${JSON.stringify(prebuiltConfig, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return { sourceConfig, prebuiltConfig, targetConfigPath };
}

export function sanitizeVercelProjectInspection(value, cwd = '') {
  const sanitized = sanitizeCommandDiagnostic(value, cwd);
  const pick = (label) => {
    const match = new RegExp(`^\\s*${label}\\s+(.+?)\\s*$`, 'imu').exec(sanitized);
    return match ? match[1].replaceAll('`', '').trim() : null;
  };
  return Object.freeze({
    projectId: pick('ID'),
    projectName: pick('Name'),
    framework: pick('Framework Preset'),
    configuredRootDirectory: pick('Root Directory'),
    buildCommand: pick('Build Command'),
    installCommand: pick('Install Command'),
    outputDirectory: pick('Output Directory'),
    nodeVersion: pick('Node\\.js Version'),
  });
}

export function sanitizeVercelDebugLog(value, cwd = '') {
  return sanitizeCommandDiagnostic(value, cwd)
    .replace(/(?:[A-Za-z]:)?[^\s"']*\\.vercel\\[^\s"']*/giu, '<vercel-state>')
    .replace(/(?:[A-Za-z]:)?[^\s"']*\/\.vercel\/[^\s"']*/giu, '<vercel-state>');
}

/** A bounded, path-redacted report emitted before a failed workspace is removed. */
export function sanitizeFailedOutputDiagnostic({
  audit,
  usedExplicitBuildsFallback,
  zeroConfigFunctionInventory = null,
  finalFunctionInventory = null,
}) {
  const limit = 20;
  const bundles = (audit.functionAudit?.bundles || []).map((bundle) => ({
    bundle: bundle.bundle,
    route: bundle.route,
    rawRoute: bundle.rawRoute,
    normalized: bundle.normalized,
    handler: bundle.handler,
    runtime: bundle.runtime,
    files: bundle.files,
    sourceMaps: bundle.sourceMaps,
    dependencies: bundle.dependencies,
  }));
  const functionFonts = (audit.functionAudit?.bundles || []).map((bundle) => ({
    route: bundle.route,
    paths: (bundle.fonts || []).slice(0, limit).map((font) => font.relativePath),
  }));
  const localImportViolations = (audit.functionAudit?.bundles || []).map((bundle) => ({
    route: bundle.route,
    paths: [...new Set((bundle.localImportViolations || []).map((item) => item.path))].slice(0, limit),
  }));
  const brokenLocalImports = (audit.functionAudit?.safety?.localImportViolations || [])
    .slice(0, limit)
    .map(({ route, path: relativePath, classification }) => ({
      route,
      path: relativePath,
      classification,
    }));
  return {
    usedExplicitBuildsFallback,
    outputRoot: audit.output?.outputRoot || '.vercel/output',
    configVersion: audit.output?.configVersion ?? null,
    functionBundles: bundles,
    functionRoutes: audit.output?.functions || [],
    functionHandlers: bundles.map(({ route, handler }) => ({ route, handler })),
    functionRuntimes: bundles.map(({ route, runtime }) => ({ route, runtime })),
    functionFonts,
    localImportViolations,
    localImportClassification: audit.functionAudit?.safety?.localImportClassification || {},
    brokenLocalImports,
    zeroConfigFunctionInventory,
    finalFunctionInventory,
    sourceMapPaths: audit.output?.sourceMaps || [],
    compiledRoutes: audit.routing?.compiled || null,
    staticAsset: audit.routing?.compiled?.asset?.request || null,
    workspaceValidation: {
      workspaceRoot: '<temporary-workspace>',
      effectiveStoreRoot: 'store',
      temporaryRoot: '<system-temp>',
      prefix: TEMPORARY_PREFIX,
      valid: audit.checks?.temporaryWorkspace === true,
    },
    failedChecks: audit.failedChecks || [],
    workspaceRetainedForDevelopment: false,
  };
}

function canonicalGeneratedFunctionRoute(relativeBundlePath) {
  const rawRoute = `/${normalizePath(relativeBundlePath).slice(0, -'.func'.length)}`;
  const route = rawRoute.replace(/\.js$/u, '');
  return {
    rawRoute,
    canonicalRoute: EXPECTED_PUBLIC_FUNCTION_ROUTES.includes(route) ? route : rawRoute,
  };
}

/**
 * Reads only Build Output created by Vercel.  It intentionally does not infer
 * functions from source files or fabricate Vercel bundle metadata.
 */
export async function inspectGeneratedFunctionInventory(functionsRoot) {
  const bundles = [];
  if (!await pathExists(functionsRoot) || !(await stat(functionsRoot)).isDirectory()) {
    return Object.freeze({
      bundles,
      rawRoutes: [],
      canonicalRoutes: [],
      handlers: [],
      runtimes: [],
      complete: false,
      missingExpectedRoutes: [...EXPECTED_PUBLIC_FUNCTION_ROUTES],
      unexpectedRoutes: [],
      duplicateRoutes: [],
    });
  }
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (!entry.name.endsWith('.func')) {
        await visit(absolutePath);
        continue;
      }
      const relativePath = normalizePath(path.relative(functionsRoot, absolutePath));
      const { rawRoute, canonicalRoute } = canonicalGeneratedFunctionRoute(relativePath);
      const configPath = path.join(absolutePath, '.vc-config.json');
      let config = null;
      let configReadable = false;
      try {
        config = JSON.parse(await readFile(configPath, 'utf8'));
        configReadable = Boolean(config && typeof config === 'object' && !Array.isArray(config));
      } catch { /* represented below as an invalid generated bundle */ }
      const handler = typeof config?.handler === 'string' ? config.handler : null;
      const runtime = typeof config?.runtime === 'string' ? config.runtime : null;
      bundles.push({
        bundle: relativePath,
        rawRoute,
        route: canonicalRoute,
        handler,
        runtime,
        configReadable,
        handlerPresent: Boolean(handler) && await isFile(path.join(absolutePath, handler)),
        validRuntime: /^nodejs\d+(?:\.x)?$/u.test(runtime || ''),
      });
    }
  }
  await visit(functionsRoot);
  bundles.sort((left, right) => left.bundle.localeCompare(right.bundle));
  const rawRoutes = bundles.map(({ rawRoute }) => rawRoute).sort();
  const canonicalRoutes = bundles.map(({ route }) => route).sort();
  const duplicateRoutes = canonicalRoutes.filter((route, index) => canonicalRoutes.indexOf(route) !== index);
  const missingExpectedRoutes = EXPECTED_PUBLIC_FUNCTION_ROUTES
    .filter((route) => !canonicalRoutes.includes(route));
  const unexpectedRoutes = canonicalRoutes
    .filter((route) => !EXPECTED_PUBLIC_FUNCTION_ROUTES.includes(route));
  const complete = bundles.length === 2
    && duplicateRoutes.length === 0
    && JSON.stringify(canonicalRoutes) === JSON.stringify(EXPECTED_PUBLIC_FUNCTION_ROUTES)
    && bundles.every((bundle) => bundle.configReadable && bundle.handlerPresent && bundle.validRuntime);
  return Object.freeze({
    bundles,
    rawRoutes,
    canonicalRoutes,
    handlers: bundles.map(({ route, handler, handlerPresent }) => ({ route, handler, present: handlerPresent })),
    runtimes: bundles.map(({ route, runtime, validRuntime }) => ({ route, runtime, valid: validRuntime })),
    complete,
    missingExpectedRoutes,
    unexpectedRoutes,
    duplicateRoutes: [...new Set(duplicateRoutes)],
  });
}

const GENERATED_FUNCTION_SCOPE = Object.freeze({
  '/api/og/store': 'store/api',
  '/api/store-page': 'store/api',
});

/**
 * @vercel/node currently emits the two ESM sources as CommonJS .js files and
 * also copies the repository package.json ("type":"module") into each bundle.
 * Set the narrow generated store/api scope to the syntax Vercel actually
 * emitted. This never edits source handlers or package manifests.
 */
export async function applyGeneratedFunctionRuntimeCompatibility(functionsRoot) {
  const inventory = await inspectGeneratedFunctionInventory(functionsRoot);
  if (!inventory.complete) {
    throw new Error('Generated function runtime compatibility requires exactly the two public functions.');
  }
  const scopes = [];
  for (const bundle of inventory.bundles) {
    const expectedScope = GENERATED_FUNCTION_SCOPE[bundle.route];
    const normalizedHandler = normalizePath(bundle.handler || '');
    if (!expectedScope || !normalizedHandler.startsWith(`${expectedScope}/`)) {
      throw new Error(`Generated handler is outside its approved runtime scope: ${bundle.route}.`);
    }
    const handlerPath = path.join(functionsRoot, bundle.bundle, ...normalizedHandler.split('/'));
    const source = await readFile(handlerPath, 'utf8');
    const syntax = classifyGeneratedHandlerSyntax(source);
    if (!['commonjs', 'module'].includes(syntax) || path.extname(handlerPath) !== '.js') {
      throw new Error(`Generated handler format is not safely scopeable: ${bundle.route}.`);
    }
    const scopeRoot = path.join(functionsRoot, bundle.bundle, ...expectedScope.split('/'));
    const packagePath = path.join(scopeRoot, 'package.json');
    const temporaryPackagePath = path.join(
      scopeRoot,
      `.runtime-package-${process.pid}-${scopes.length}.json`,
    );
    const packageJson = `${JSON.stringify({ type: syntax }, null, 2)}\n`;
    await writeFile(temporaryPackagePath, packageJson, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPackagePath, packagePath);
    scopes.push(Object.freeze({
      route: bundle.route,
      handler: normalizedHandler,
      syntax,
      packageScope: `${expectedScope}/package.json`,
      packageType: syntax,
      atomic: true,
    }));
  }
  return Object.freeze(scopes.sort((left, right) => left.route.localeCompare(right.route)));
}

export async function assertEffectiveVercelProjectRoot({
  workspaceRoot,
  configuredRootDirectory,
  prebuiltConfigPath,
}) {
  const normalizedRootDirectory = String(configuredRootDirectory || '').trim().replaceAll('\\', '/');
  const effectiveSourceRoot = path.resolve(workspaceRoot, normalizedRootDirectory || '.');
  const relativeRoot = path.relative(workspaceRoot, effectiveSourceRoot);
  if (relativeRoot.startsWith('..') || path.isAbsolute(relativeRoot)) {
    throw new Error('Configured Vercel root directory escapes the temporary workspace.');
  }
  const normalizedEffective = normalizePath(effectiveSourceRoot);
  if (/\/store\/store(?:\/|$)/u.test(normalizedEffective)) {
    throw new Error('Vercel effective source root contains a duplicated store/store directory.');
  }
  const apiDirectory = path.join(effectiveSourceRoot, 'api');
  const requiredPaths = [
    apiDirectory,
    path.join(apiDirectory, 'store-page.js'),
    path.join(apiDirectory, 'og', 'store.js'),
    prebuiltConfigPath || path.join(effectiveSourceRoot, 'vercel.prebuilt.json'),
  ];
  const missing = [];
  for (const requiredPath of requiredPaths) {
    if (!await pathExists(requiredPath)) missing.push(normalizePath(path.relative(effectiveSourceRoot, requiredPath)));
  }
  if (missing.length > 0) {
    throw new Error(`Effective Vercel project root is missing: ${missing.join(', ')}.`);
  }
  return Object.freeze({
    configuredRootDirectory: normalizedRootDirectory || null,
    effectiveSourceRoot,
    apiDirectory,
    apiDirectoryExists: true,
  });
}

async function hashOptional(filePath) {
  return await pathExists(filePath) ? sha256(await readFile(filePath)) : null;
}

async function manifestOptionalDirectory(directory) {
  if (!await pathExists(directory)) return { present: false, files: [] };
  const files = await walk(directory);
  return {
    present: true,
    files: await Promise.all(files.map(async (file) => ({
      path: file.relativePath,
      bytes: file.bytes,
      sha256: sha256(await readFile(file.absolutePath)),
    }))),
  };
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

export function shouldCopyStoreWorkspacePath(relativePath) {
  const normalized = normalizePath(relativePath).replace(/^\.\/+/u, '');
  if (!normalized) return true;
  const segments = normalized.split('/');
  if (excludedRootNames.has(segments[0])) return false;
  if (segments.at(-1)?.toLowerCase() === 'auth.json') return false;
  if (segments.some((segment) => /^\.env(?:\.|$)/iu.test(segment))) return false;
  if (normalized === 'store/dist' || normalized.startsWith('store/dist/')) return false;
  if (
    normalized === 'store/generated/storeHtmlTemplate.js'
    || normalized.startsWith('store/generated/.storeHtmlTemplate.js.')
  ) return false;
  if (
    segments.includes('coverage')
    || segments.includes('__snapshots__')
    || segments.some((segment) => segment === 'tests' || segment === '__tests__')
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(segments.at(-1))
  ) return false;
  if (/\.(?:tmp|temp|tgz)$/iu.test(segments.at(-1))) return false;
  return true;
}

export async function createSanitizedStoreWorkspace({
  sourceRoot = projectRoot,
  temporaryRoot,
}) {
  await cp(sourceRoot, temporaryRoot, {
    recursive: true,
    errorOnExist: false,
    force: false,
    filter(sourcePath) {
      const relativePath = path.relative(sourceRoot, sourcePath);
      return shouldCopyStoreWorkspacePath(relativePath);
    },
  });
  const forbidden = (await walk(temporaryRoot))
    .map((file) => file.relativePath)
    .filter((relativePath) => !shouldCopyStoreWorkspacePath(relativePath));
  if (forbidden.length > 0) {
    throw new Error(`Sanitized workspace contains forbidden paths: ${forbidden.join(', ')}.`);
  }
}

export function resolveNpmInvocation({
  platform = process.platform,
  environment = process.env,
  nodeExecutable = process.execPath,
} = {}) {
  const npmCliPath = typeof environment?.npm_execpath === 'string'
    ? environment.npm_execpath.trim()
    : '';
  if (!npmCliPath) {
    throw new Error('Unable to resolve the npm CLI safely: npm_execpath is not set.');
  }
  if (!nodeExecutable || typeof nodeExecutable !== 'string') {
    throw new Error('Unable to resolve the npm CLI safely: Node executable is unavailable.');
  }
  // platform is deliberately accepted: Node can execute the JavaScript CLI directly
  // on Windows, Linux, and macOS, without relying on a shell wrapper.
  void platform;
  return Object.freeze({
    command: nodeExecutable,
    args: Object.freeze([npmCliPath, 'ci', '--no-audit', '--no-fund']),
    options: Object.freeze({ shell: false }),
  });
}

async function directoryManifest(directory) {
  const files = await walk(directory);
  const items = await Promise.all(files.map(async (file) => ({
    path: file.relativePath,
    bytes: file.bytes,
    sha256: sha256(await readFile(file.absolutePath)),
  })));
  return {
    files: items,
    bytes: items.reduce((total, item) => total + item.bytes, 0),
    treeSha256: sha256(items.map((item) => `${item.sha256}  ${item.path}`).join('\n')),
  };
}

function manifestsMatch(source, output) {
  return source.files.length === output.files.length
    && source.files.every((item, index) => (
      item.path === output.files[index]?.path
      && item.bytes === output.files[index]?.bytes
      && item.sha256 === output.files[index]?.sha256
    ));
}

async function isEmptyDirectory(directory) {
  return (await readdir(directory)).length === 0;
}

export async function materializePrebuiltStaticOutput({ sourceStaticRoot, outputStaticRoot }) {
  if (!await pathExists(sourceStaticRoot)) {
    throw new Error('Public static build input is missing.');
  }
  if (!(await stat(sourceStaticRoot)).isDirectory()) {
    throw new Error('Public static build input must be a directory.');
  }
  const sourceAudit = await inspectStatic(sourceStaticRoot, 'store');
  const failedSourceChecks = Object.entries(sourceAudit.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failedSourceChecks.length > 0) {
    const details = formatSafetyFailureDetails(sourceAudit.safety, failedSourceChecks);
    throw new Error([
      'Public static build audit failed:',
      ...(details.length > 0 ? details : [failedSourceChecks.join(', ')]),
    ].join('\n'));
  }
  const source = await directoryManifest(sourceStaticRoot);
  if (source.files.some((item) => item.path === 'vercel.prebuilt.json' || /(^|\/)\.env(?:\.|$)/iu.test(item.path))) {
    throw new Error('Public static build contains forbidden deployment input.');
  }

  let strategy = 'copied';
  if (await pathExists(outputStaticRoot)) {
    if (!(await stat(outputStaticRoot)).isDirectory()) {
      throw new Error('Vercel output static path must be a directory.');
    }
    if (await isEmptyDirectory(outputStaticRoot)) {
      strategy = 'filled-empty-output';
    } else {
      const existing = await directoryManifest(outputStaticRoot);
      if (!manifestsMatch(source, existing)) {
        throw new Error('Vercel output static differs from the audited public build.');
      }
      return {
        strategy: 'verified-existing-output',
        sourceFiles: source.files.length,
        outputFiles: existing.files.length,
        sourceBytes: source.bytes,
        outputBytes: existing.bytes,
        sourceTreeSha256: source.treeSha256,
        outputTreeSha256: existing.treeSha256,
        parity: true,
      };
    }
  } else {
    await mkdir(outputStaticRoot, { recursive: true });
  }

  for (const entry of await readdir(sourceStaticRoot)) {
    await cp(path.join(sourceStaticRoot, entry), path.join(outputStaticRoot, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    });
  }
  const output = await directoryManifest(outputStaticRoot);
  const parity = manifestsMatch(source, output);
  if (!parity) throw new Error('Materialized static output does not match the audited public build.');
  return {
    strategy,
    sourceFiles: source.files.length,
    outputFiles: output.files.length,
    sourceBytes: source.bytes,
    outputBytes: output.bytes,
    sourceTreeSha256: source.treeSha256,
    outputTreeSha256: output.treeSha256,
    parity,
  };
}

export function resolveNpmScriptInvocation({
  npmCliPath,
  script,
  nodeExecutable = process.execPath,
} = {}) {
  if (!npmCliPath || typeof npmCliPath !== 'string') {
    throw new Error('Unable to resolve the npm CLI safely: npm-cli.js is unavailable.');
  }
  if (!script || typeof script !== 'string') throw new TypeError('The npm script name is required.');
  return Object.freeze({
    command: nodeExecutable,
    args: Object.freeze([npmCliPath, 'run', script]),
    options: Object.freeze({ shell: false }),
  });
}

export async function resolveNpmCliPath({
  environment = process.env,
  nodeExecutable = process.execPath,
} = {}) {
  const inherited = typeof environment?.npm_execpath === 'string'
    ? environment.npm_execpath.trim()
    : '';
  if (inherited && await isFile(inherited)) return inherited;

  // npm is distributed alongside the Windows and standalone Node installations.
  // This fallback is rooted in the real Node executable, never in the workspace.
  const bundled = path.join(path.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (await isFile(bundled)) return bundled;

  const reason = inherited
    ? 'npm_execpath does not reference a readable file'
    : 'npm_execpath is not set';
  throw new Error(
    `Unable to resolve the npm CLI safely: ${reason}; no bundled npm CLI was found next to Node.`,
  );
}

export async function resolveWindowsPathCommand(command, environment = process.env) {
  if (path.isAbsolute(command) || command.includes('\\') || command.includes('/')) return command;
  const pathEntries = String(environment?.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  for (const directory of pathEntries) {
    const candidate = path.join(directory, command);
    if (await isFile(candidate)) return candidate;
  }
  throw new Error(`Required executable not found: ${executableName(command)}`);
}

export async function resolveVercelInvocation({
  platform = process.platform,
  environment = process.env,
  nodeExecutable = process.execPath,
  vercelCommand = DEFAULT_VERCEL_COMMAND,
} = {}) {
  if (platform !== 'win32') {
    return Object.freeze({ command: vercelCommand, argsPrefix: Object.freeze([]), options: { shell: false } });
  }
  const configured = typeof environment.VERCEL_CLI_PATH === 'string'
    ? environment.VERCEL_CLI_PATH.trim()
    : '';
  const candidates = configured
    ? [configured]
    : [
      vercelCommand.toLowerCase().endsWith('.js') ? vercelCommand : '',
      environment.APPDATA ? path.join(environment.APPDATA, 'npm', 'node_modules', 'vercel', 'dist', 'vc.js') : '',
      environment.npm_config_prefix ? path.join(environment.npm_config_prefix, 'node_modules', 'vercel', 'dist', 'vc.js') : '',
    ].filter(Boolean);
  // Resolution is restricted to JavaScript CLI entrypoints rather than Windows
  // shell wrappers.
  let resolvedCliPath = '';
  for (const candidate of candidates) {
    if (candidate.toLowerCase().endsWith('.js') && await isFile(candidate)) {
      resolvedCliPath = candidate;
      break;
    }
  }
  if (!resolvedCliPath) {
    throw new Error('Unable to resolve the Vercel JavaScript CLI without a Windows command wrapper.');
  }
  return Object.freeze({
    command: nodeExecutable,
    argsPrefix: Object.freeze([resolvedCliPath]),
    options: Object.freeze({ shell: false }),
  });
}

export function buildNpmExecutionEnvironment({
  environment = process.env,
  temporaryDirectory = os.tmpdir(),
} = {}) {
  const pathApi = /^[A-Za-z]:\\/u.test(temporaryDirectory) ? path.win32 : path;
  return Object.freeze({
    ...environment,
    NPM_CONFIG_CACHE: pathApi.join(temporaryDirectory, 'lanzo-store-social-preview-npm-cache'),
    XDG_CACHE_HOME: pathApi.join(temporaryDirectory, 'lanzo-store-npm-cache'),
  });
}

export function buildVercelExecutionEnvironment({
  environment = process.env,
  useLoggedInAuthentication = true,
} = {}) {
  const vercelEnvironment = { ...environment };
  if (useLoggedInAuthentication) {
    for (const name of Object.keys(vercelEnvironment)) {
      if (name.toUpperCase() === 'VERCEL_TOKEN') delete vercelEnvironment[name];
    }
  }
  return Object.freeze(vercelEnvironment);
}

export function resolveSpawnInvocation({
  command,
  args,
}) {
  if (!Array.isArray(args)) throw new TypeError('CLI arguments must be an array.');
  return {
    command,
    args,
    options: { shell: false },
  };
}

function executableName(command) {
  const name = normalizePath(String(command || '')).split('/').at(-1) || 'unknown';
  return name.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 120);
}

function sanitizeCommandDiagnostic(value, cwd) {
  let diagnostic = String(value || '');
  for (const [protectedPath, replacement] of [
    [process.cwd(), '<repository>'],
    [cwd, '<workspace>'],
  ]) {
    if (protectedPath) diagnostic = diagnostic.replaceAll(protectedPath, replacement);
  }
  return diagnostic
    .replace(/\b(?:sb_secret|ghp|github_pat|vcp|vercel)_[A-Za-z0-9_-]{8,}\b/giu, '<redacted>')
    .replace(/(SUPABASE_SERVICE_ROLE\s*=\s*)[^\s]+/giu, '$1<redacted>')
    .slice(0, 1_000);
}

export function run(
  command,
  args,
  {
    cwd,
    environment = process.env,
  } = {},
) {
  const invocation = resolveSpawnInvocation({ command, args });
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
    ...invocation.options,
  });
  if (result.status !== 0) {
    const stderr = sanitizeCommandDiagnostic(result.stderr, cwd);
    if (result.error?.code === 'ENOENT') {
      throw new Error(
        `Required executable not found: ${executableName(invocation.command)}`
        + ` (status: ${String(result.status)}).${stderr ? ` ${stderr}` : ''}`,
      );
    }
    const diagnostic = stderr || sanitizeCommandDiagnostic(result.error?.message, cwd);
    throw new Error(
      `${executableName(command)} ${sanitizeCommandDiagnostic(args.join(' '), cwd)}`
      + ' failed with exit code'
      + ` ${result.status}: ${diagnostic}`,
    );
  }
  return result;
}

export async function resolveRepositoryHead({
  repositoryRoot = projectRoot,
  commandRunner = run,
  environment = process.env,
} = {}) {
  return (await resolveRepositoryIdentity({
    repositoryRoot,
    commandRunner,
    environment,
  })).HEAD;
}

export function buildSanitizedGitEnvironment({
  environment = process.env,
  temporaryIndexPath,
} = {}) {
  const sanitizedEnvironment = {};
  for (const [name, value] of Object.entries(environment || {})) {
    if (!name.toUpperCase().startsWith('GIT_')) {
      sanitizedEnvironment[name] = value;
    }
  }
  sanitizedEnvironment.GIT_TERMINAL_PROMPT = '0';
  if (temporaryIndexPath !== undefined) {
    sanitizedEnvironment.GIT_INDEX_FILE = temporaryIndexPath;
  }
  return sanitizedEnvironment;
}

async function runGitIdentityCommand({
  repositoryRoot,
  commandRunner,
  environment,
  args,
}) {
  try {
    const result = await commandRunner('git', args, {
      cwd: repositoryRoot,
      environment: buildSanitizedGitEnvironment({ environment }),
      shell: false,
    });
    if (result?.status != null && result.status !== 0) throw new Error('git failed');
    return result;
  } catch {
    throw new Error('Unable to resolve repository identity with Git.');
  }
}

export async function readRepositoryStatus({
  repositoryRoot = projectRoot,
  commandRunner = run,
  environment = process.env,
} = {}) {
  let result;
  try {
    result = await commandRunner(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      {
        cwd: repositoryRoot,
        environment: buildSanitizedGitEnvironment({ environment }),
        shell: false,
      },
    );
    if (result?.status != null && result.status !== 0) throw new Error('git failed');
  } catch {
    throw new Error('Unable to inspect repository checkout with Git.');
  }
  if (String(result?.stdout || '') !== '') {
    throw new Error('Repository checkout must be clean before preparing the artifact.');
  }
  return Object.freeze({ clean: true });
}

export async function resolveRepositoryIdentity({
  repositoryRoot = projectRoot,
  commandRunner = run,
  environment = process.env,
} = {}) {
  const results = [];
  for (const args of [
    ['rev-parse', 'HEAD'],
    ['rev-parse', 'HEAD^{tree}'],
    ['rev-parse', '--show-object-format'],
    ['rev-parse', '--is-inside-work-tree'],
    ['rev-parse', '--show-toplevel'],
  ]) {
    results.push(await runGitIdentityCommand({
      repositoryRoot,
      commandRunner,
      environment,
      args,
    }));
  }
  const [headResult, treeResult, formatResult, insideResult, topLevelResult] = results;
  const HEAD = String(headResult?.stdout || '').trim();
  const treeOid = String(treeResult?.stdout || '').trim();
  const objectFormat = String(formatResult?.stdout || '').trim();
  const isInsideWorkTree = String(insideResult?.stdout || '').trim();
  const showToplevel = String(topLevelResult?.stdout || '').trim();
  if (!/^[a-f0-9]{40}$/u.test(HEAD)) {
    throw new Error('Git returned an invalid repository HEAD.');
  }
  if (!['sha1', 'sha256'].includes(objectFormat)) {
    throw new Error('Git returned an unknown object format.');
  }
  const expectedTreeLength = objectFormat === 'sha1' ? 40 : 64;
  if (!new RegExp(`^[a-f0-9]{${expectedTreeLength}}$`, 'u').test(treeOid)) {
    throw new Error('Git returned an invalid repository tree OID.');
  }
  if (isInsideWorkTree !== 'true') {
    throw new Error('The requested repositoryRoot is not inside a Git work tree.');
  }
  const normalizeRepositoryRoot = (value) => {
    const rawValue = String(value || '').trim();
    const windowsPath = /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(rawValue);
    const pathImplementation = windowsPath ? path.win32 : path;
    const normalized = normalizePath(pathImplementation.resolve(rawValue)).replace(/\/+$/u, '');
    return windowsPath || process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  if (
    !showToplevel
    || normalizeRepositoryRoot(showToplevel) !== normalizeRepositoryRoot(repositoryRoot)
  ) {
    throw new Error('Git repository root does not match the requested repositoryRoot.');
  }
  return Object.freeze({ HEAD, treeOid, objectFormat });
}

function assertValidRepositoryIdentity(identity) {
  if (!/^[a-f0-9]{40}$/u.test(identity?.HEAD || '')) {
    throw new Error('Git returned an invalid repository HEAD.');
  }
  if (!['sha1', 'sha256'].includes(identity?.objectFormat)) {
    throw new Error('Git returned an unknown object format.');
  }
  const length = identity.objectFormat === 'sha1' ? 40 : 64;
  if (!new RegExp(`^[a-f0-9]{${length}}$`, 'u').test(identity?.treeOid || '')) {
    throw new Error('Git returned an invalid repository tree OID.');
  }
  return identity;
}

function hasParentTraversal(value) {
  return normalizePath(String(value)).split('/').includes('..');
}

async function assertControlledGitSnapshotDirectory({
  provenanceRoot,
  repositoryRoot,
  workspaceRoot = '',
  temporaryRoot = os.tmpdir(),
  requireExisting = true,
}) {
  if (!path.isAbsolute(provenanceRoot) || hasParentTraversal(provenanceRoot)) {
    throw new Error('Git snapshot path is not a controlled absolute path.');
  }
  const controlledRoot = path.resolve(provenanceRoot);
  const controlledTemporaryRoot = path.resolve(temporaryRoot);
  const forbidden = new Set([
    path.parse(controlledRoot).root,
    path.resolve(os.homedir()),
    path.resolve(repositoryRoot),
    ...(workspaceRoot ? [path.resolve(workspaceRoot)] : []),
  ]);
  if (
    controlledTemporaryRoot !== path.resolve(os.tmpdir())
    || path.dirname(controlledRoot) !== controlledTemporaryRoot
    || !path.basename(controlledRoot).startsWith(GIT_SNAPSHOT_PREFIX)
    || forbidden.has(controlledRoot)
  ) {
    throw new Error('Git snapshot path is outside the controlled temporary directory.');
  }
  if (requireExisting) {
    let metadata;
    try {
      metadata = await lstat(controlledRoot);
    } catch {
      throw new Error('Controlled Git snapshot directory is missing.');
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('Controlled Git snapshot directory is unsafe.');
    }
  }
  return controlledRoot;
}

function gitCheckoutIndexPrefix(snapshotRoot) {
  const normalized = normalizePath(path.resolve(snapshotRoot)).replace(/\/+$/u, '');
  return `${normalized}/`;
}

export async function removeGitHeadSnapshot({
  provenanceRoot,
  snapshotRoot,
  temporaryIndexPath,
  repositoryRoot,
  workspaceRoot = '',
  temporaryRoot = os.tmpdir(),
  removePath = rm,
  exists = pathExists,
} = {}) {
  const controlledRoot = await assertControlledGitSnapshotDirectory({
    provenanceRoot,
    repositoryRoot,
    workspaceRoot,
    temporaryRoot,
  });
  const expectedSnapshotRoot = path.join(controlledRoot, 'snapshot');
  const expectedIndexPath = path.join(controlledRoot, 'git-index');
  if (
    path.resolve(snapshotRoot) !== path.resolve(expectedSnapshotRoot)
    || path.resolve(temporaryIndexPath) !== path.resolve(expectedIndexPath)
  ) {
    throw new Error('Git snapshot resources do not match the controlled layout.');
  }
  await removePath(controlledRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
  const [rootPresent, snapshotPresent, indexPresent] = await Promise.all([
    exists(controlledRoot),
    exists(expectedSnapshotRoot),
    exists(expectedIndexPath),
  ]);
  if (rootPresent || snapshotPresent || indexPresent) {
    throw new Error('Git snapshot resources could not be removed completely.');
  }
  return Object.freeze({
    snapshotRemoved: true,
    temporaryIndexRemoved: true,
  });
}

export async function createGitHeadSnapshot({
  repositoryRoot = projectRoot,
  identity,
  commandRunner = run,
  environment = process.env,
  temporaryRoot = os.tmpdir(),
  makeTemporaryDirectory = mkdtemp,
  makeDirectory = mkdir,
  snapshotRemover = removeGitHeadSnapshot,
} = {}) {
  const HEAD = identity?.HEAD;
  if (!/^[a-f0-9]{40}$/u.test(HEAD || '')) {
    throw new Error('The repository HEAD is invalid for Git snapshot creation.');
  }
  const provenanceRoot = await makeTemporaryDirectory(
    path.join(path.resolve(temporaryRoot), GIT_SNAPSHOT_PREFIX),
  );
  const snapshotRoot = path.join(provenanceRoot, 'snapshot');
  const temporaryIndexPath = path.join(provenanceRoot, 'git-index');
  try {
    await assertControlledGitSnapshotDirectory({
      provenanceRoot,
      repositoryRoot,
      temporaryRoot,
    });
    await makeDirectory(snapshotRoot, { recursive: false });
    const indexEnvironment = buildSanitizedGitEnvironment({
      environment,
      temporaryIndexPath,
    });
    try {
      const result = await commandRunner('git', ['read-tree', HEAD], {
        cwd: repositoryRoot,
        environment: indexEnvironment,
        shell: false,
      });
      if (result?.status != null && result.status !== 0) throw new Error('git failed');
    } catch {
      throw new Error('Unable to load repository HEAD into the temporary Git index.');
    }
    const prefix = gitCheckoutIndexPrefix(snapshotRoot);
    if (path.resolve(prefix) !== path.resolve(snapshotRoot)) {
      throw new Error('Git checkout-index prefix is unsafe.');
    }
    try {
      const result = await commandRunner(
        'git',
        ['checkout-index', '--all', '--force', `--prefix=${prefix}`],
        { cwd: repositoryRoot, environment: indexEnvironment, shell: false },
      );
      if (result?.status != null && result.status !== 0) throw new Error('git failed');
    } catch {
      throw new Error('Unable to materialize repository HEAD from the temporary Git index.');
    }
    await walk(snapshotRoot);
    return Object.freeze({
      provenanceRoot,
      snapshotRoot,
      temporaryIndexPath,
      prefix,
      snapshotFromTemporaryIndex: true,
      trackedFilesOnly: true,
    });
  } catch (error) {
    try {
      await snapshotRemover({
        provenanceRoot,
        snapshotRoot,
        temporaryIndexPath,
        repositoryRoot,
        temporaryRoot,
      });
    } catch {
      throw new Error('Git snapshot preparation failed and temporary resources could not be removed.');
    }
    throw error;
  }
}

export async function assertRepositoryIdentityStable({
  initialIdentity,
  repositoryRoot = projectRoot,
  commandRunner = run,
  environment = process.env,
  statusReader = readRepositoryStatus,
  identityResolver = resolveRepositoryIdentity,
} = {}) {
  const finalIdentity = await identityResolver({ repositoryRoot, commandRunner, environment });
  let finalStatus;
  try {
    finalStatus = await statusReader({ repositoryRoot, commandRunner, environment });
  } catch (error) {
    if (error?.message === 'Repository checkout must be clean before preparing the artifact.') {
      throw new Error('Repository checkout changed while preparing the artifact.');
    }
    throw error;
  }
  if (initialIdentity.HEAD !== finalIdentity.HEAD) {
    throw new Error('Repository HEAD changed while preparing the artifact.');
  }
  if (initialIdentity.treeOid !== finalIdentity.treeOid) {
    throw new Error('Repository tree changed while preparing the artifact.');
  }
  if (initialIdentity.objectFormat !== finalIdentity.objectFormat) {
    throw new Error('Repository object format changed while preparing the artifact.');
  }
  return Object.freeze({
    identity: finalIdentity,
    checkoutCleanAfter: finalStatus.clean === true,
    headStable: true,
    treeStable: true,
  });
}

export async function writeProjectLink(linkedDirectory) {
  const vercelDirectory = path.join(linkedDirectory, '.vercel');
  await mkdir(vercelDirectory, { recursive: true });
  await writeFile(path.join(vercelDirectory, 'project.json'), `${JSON.stringify({
    projectId: STORE_PROJECT_ID,
    orgId: STORE_ORGANIZATION_ID,
  })}\n`, { encoding: 'utf8', flag: 'wx' });
}

function isEnvironmentFileName(name) {
  return name === '.env' || name.startsWith('.env.');
}

export async function findWorkspaceEnvironmentFiles(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const relativeToTemp = path.relative(path.resolve(os.tmpdir()), root);
  if (
    path.dirname(root) !== path.resolve(os.tmpdir())
    || relativeToTemp.startsWith('..')
    || path.isAbsolute(relativeToTemp)
    || !path.basename(root).startsWith(TEMPORARY_PREFIX)
  ) {
    throw new Error('Environment scan requires a controlled temporary store workspace.');
  }
  const matches = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        if (isEnvironmentFileName(entry.name)) matches.push(absolutePath);
        continue;
      }
      if (metadata.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (metadata.isFile() && isEnvironmentFileName(entry.name)) matches.push(absolutePath);
    }
  }
  await visit(root);
  return matches.sort().map((absolutePath) => normalizePath(path.relative(root, absolutePath)));
}

export async function removeWorkspaceEnvironmentFiles({
  workspaceRoot,
  removeFile = rm,
} = {}) {
  const found = await findWorkspaceEnvironmentFiles(workspaceRoot);
  for (const relativePath of found) {
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    const relative = path.relative(path.resolve(workspaceRoot), absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Environment cleanup attempted to escape the temporary workspace.');
    }
    await removeFile(absolutePath, { force: true });
  }
  const remaining = await findWorkspaceEnvironmentFiles(workspaceRoot);
  if (remaining.length > 0) {
    throw new Error(`Environment cleanup incomplete: ${remaining.join(', ')}.`);
  }
  return Object.freeze({
    removed: Object.freeze(found),
    environmentFilesFound: Object.freeze(remaining),
  });
}

async function applyCanonicalNoindex(outputConfigPath) {
  const config = JSON.parse(await readFile(outputConfigPath, 'utf8'));
  const canonicalRoute = config.routes?.find((route) => (
    route.status === 308
    && route.headers?.Location === '/$1'
    && typeof route.src === 'string'
    && route.src.includes('(.*)/$')
  ));
  if (!canonicalRoute) {
    throw new Error('Vercel did not compile the expected trailing-slash canonical route.');
  }
  canonicalRoute.headers ||= {};
  canonicalRoute.headers['X-Robots-Tag'] = 'noindex, nofollow, noarchive';
  await writeFile(outputConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function writeExternalManifest(workspaceRoot, outputRoot, {
  targetEnvironment = TARGET_ENVIRONMENT,
  deploymentType = DEPLOYMENT_TYPE,
  production = false,
  deploymentExecuted = false,
} = {}) {
  const files = await walk(outputRoot);
  const manifest = await Promise.all(files.map(async (file) => ({
    path: file.relativePath,
    bytes: file.bytes,
    sha256: sha256(await readFile(file.absolutePath)),
  })));
  const manifestPath = `${workspaceRoot}-output-sha256.json`;
  const document = {
    schemaVersion: 2,
    targetEnvironment,
    deploymentType,
    production,
    deploymentExecuted,
    files: manifest,
    treeSha256: sha256(manifest.map((item) => `${item.sha256}  ${item.path}`).join('\n')),
  };
  await writeFile(manifestPath, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return { manifestPath, ...document };
}

async function protectedRepositoryState(repositoryRoot) {
  const administrativeProjectLinkPath = path.join(
    repositoryRoot,
    '.vercel',
    'project.json',
  );
  return {
    rootGitignoreHash: await hashOptional(path.join(repositoryRoot, '.gitignore')),
    storeGitignoreHash: await hashOptional(path.join(repositoryRoot, 'store', '.gitignore')),
    administrativeConfigHash: await hashOptional(path.join(repositoryRoot, 'vercel.json')),
    storeConfigHash: await hashOptional(path.join(repositoryRoot, 'store', 'vercel.json')),
    storePrebuiltConfigHash: await hashOptional(path.join(repositoryRoot, 'store', 'vercel.prebuilt.json')),
    storePrebuiltConfigPresent: await pathExists(path.join(repositoryRoot, 'store', 'vercel.prebuilt.json')),
    administrativeProjectLinkHash: await hashOptional(administrativeProjectLinkPath),
    administrativeProjectLinkPresent: await pathExists(administrativeProjectLinkPath),
    administrativeVercel: await manifestOptionalDirectory(
      path.join(repositoryRoot, '.vercel'),
    ),
    repositoryEnvironment: {
      envLocalHash: await hashOptional(path.join(repositoryRoot, '.env.local')),
      envProductionLocalHash: await hashOptional(
        path.join(repositoryRoot, '.env.production.local'),
      ),
      storeEnvLocalHash: await hashOptional(
        path.join(repositoryRoot, 'store', '.env.local'),
      ),
      storeEnvProductionLocalHash: await hashOptional(
        path.join(repositoryRoot, 'store', '.env.production.local'),
      ),
    },
  };
}

function changedProtectedState(baseline, finalState) {
  return Object.keys(baseline).filter(
    (name) => JSON.stringify(baseline[name]) !== JSON.stringify(finalState[name]),
  );
}

async function assertProtectedRepositoryIntegrity(repositoryRoot, baseline) {
  const finalState = await protectedRepositoryState(repositoryRoot);
  const changed = changedProtectedState(baseline, finalState);
  if (changed.length > 0) {
    throw new Error(
      `Repository protected state changed during prebuilt preparation: ${changed.join(', ')}.`,
    );
  }
  return finalState;
}

async function removeTemporaryWorkspace(workspaceRoot) {
  await rm(workspaceRoot, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 500,
  });
}

export function shouldPreservePassedWorkspace(environment = process.env) {
  const value = environment?.[PRESERVE_PASSED_EVIDENCE_ENV];
  if (value == null || value === '' || value === '0') return false;
  if (value === '1') return true;
  throw new Error(`${PRESERVE_PASSED_EVIDENCE_ENV} must be 1, 0, or unset.`);
}

export async function cleanupPreparedStoreWorkspace({
  workspaceRoot,
  manifestPath = '',
  temporaryRoot = os.tmpdir(),
} = {}) {
  if (!workspaceRoot) return Object.freeze({ workspaceRemoved: true, manifestRemoved: true });
  const workspace = path.resolve(workspaceRoot);
  const temporary = path.resolve(temporaryRoot);
  const relative = path.relative(temporary, workspace);
  if (
    path.dirname(workspace) !== temporary
    || relative.startsWith('..')
    || path.isAbsolute(relative)
    || !path.basename(workspace).startsWith(TEMPORARY_PREFIX)
  ) {
    throw new Error('Refusing to clean a path outside the controlled store workspace.');
  }
  await removeTemporaryWorkspace(workspace);
  if (manifestPath) await rm(path.resolve(manifestPath), { force: true });
  return Object.freeze({
    workspaceRemoved: !await pathExists(workspace),
    manifestRemoved: !manifestPath || !await pathExists(path.resolve(manifestPath)),
  });
}

export async function finalizePassedStoreWorkspace({
  workspaceRoot,
  storeRoot = path.join(workspaceRoot, 'store'),
  auditOptions,
  prebuiltAuditor = auditPrebuiltOutput,
  removeFile = rm,
} = {}) {
  try {
    const environmentCleanup = await removeWorkspaceEnvironmentFiles({
      workspaceRoot,
      removeFile,
    });
    await rm(path.join(storeRoot, 'vercel.prebuilt.json'), { force: true });
    const audit = await prebuiltAuditor('store', workspaceRoot, auditOptions);
    if (audit.status !== 'PASS' || (audit.failedChecks || []).length > 0) {
      throw new Error('Post-cleanup Vercel output audit did not pass.');
    }
    const environmentFilesFound = await findWorkspaceEnvironmentFiles(workspaceRoot);
    if (environmentFilesFound.length > 0) {
      throw new Error(`Environment files remained after the preservation gate: ${environmentFilesFound.join(', ')}.`);
    }
    return Object.freeze({
      audit,
      environmentCleanup,
      environmentFilesFound: Object.freeze(environmentFilesFound),
    });
  } catch (error) {
    await cleanupPreparedStoreWorkspace({ workspaceRoot });
    throw error;
  }
}

export async function prepareStoreDeployment({
  repositoryRoot = projectRoot,
  commandRunner = run,
  gitCommandRunner = run,
  repositoryStatusReader = readRepositoryStatus,
  repositoryIdentityResolver = resolveRepositoryIdentity,
  gitSnapshotCreator = createGitHeadSnapshot,
  gitSnapshotRemover = removeGitHeadSnapshot,
  repositoryStabilityChecker = assertRepositoryIdentityStable,
  sanitizedWorkspaceCreator = createSanitizedStoreWorkspace,
  temporaryRoot = os.tmpdir(),
  vercelCommand = process.env.VERCEL_CLI_PATH || DEFAULT_VERCEL_COMMAND,
  vercelInvocation,
  npmInvocation,
  projectInspection,
  environment = process.env,
  preservePassedWorkspace = shouldPreservePassedWorkspace(environment),
  prebuiltAuditor = auditPrebuiltOutput,
} = {}) {
  const initialStatus = await repositoryStatusReader({
    repositoryRoot,
    commandRunner: gitCommandRunner,
    environment,
  });
  if (initialStatus?.clean !== true) {
    throw new Error('Repository checkout must be clean before preparing the artifact.');
  }
  const initialIdentity = assertValidRepositoryIdentity(await repositoryIdentityResolver({
    repositoryRoot,
    commandRunner: gitCommandRunner,
    environment,
  }));
  const { HEAD } = initialIdentity;
  const baseline = await protectedRepositoryState(repositoryRoot);
  let workspaceRoot = '';
  let manifestPath = '';
  let gitSnapshot = null;
  let sourceCleanup = null;
  let snapshotEvidence = null;
  try {
    gitSnapshot = await gitSnapshotCreator({
      repositoryRoot,
      identity: initialIdentity,
      commandRunner: gitCommandRunner,
      environment,
      temporaryRoot,
    });
    if (
      gitSnapshot?.snapshotFromTemporaryIndex !== true
      || gitSnapshot?.trackedFilesOnly !== true
    ) {
      throw new Error('Git snapshot provenance is incomplete.');
    }
    const controlledProvenanceRoot = await assertControlledGitSnapshotDirectory({
      provenanceRoot: gitSnapshot.provenanceRoot,
      repositoryRoot,
      temporaryRoot,
    });
    if (
      path.resolve(gitSnapshot.snapshotRoot)
        !== path.resolve(controlledProvenanceRoot, 'snapshot')
      || path.resolve(gitSnapshot.temporaryIndexPath)
        !== path.resolve(controlledProvenanceRoot, 'git-index')
      || !await pathExists(gitSnapshot.temporaryIndexPath)
    ) {
      throw new Error('Git snapshot resources do not match the controlled layout.');
    }
    const workingTreeCopied = path.resolve(gitSnapshot.snapshotRoot)
      === path.resolve(repositoryRoot);
    if (workingTreeCopied) {
      throw new Error('The repository working tree cannot be used as the artifact source.');
    }
    snapshotEvidence = {
      snapshotFromTemporaryIndex: gitSnapshot.snapshotFromTemporaryIndex,
      trackedFilesOnly: gitSnapshot.trackedFilesOnly,
      workingTreeCopied,
    };
    workspaceRoot = await mkdtemp(path.join(temporaryRoot, TEMPORARY_PREFIX));
    await sanitizedWorkspaceCreator({
      sourceRoot: gitSnapshot.snapshotRoot,
      temporaryRoot: workspaceRoot,
    });
    sourceCleanup = await gitSnapshotRemover({
      ...gitSnapshot,
      repositoryRoot,
      workspaceRoot,
      temporaryRoot,
    });
    gitSnapshot = null;
    if (
      sourceCleanup.snapshotRemoved !== true
      || sourceCleanup.temporaryIndexRemoved !== true
    ) {
      throw new Error('Git snapshot cleanup did not pass.');
    }

    // Capture and validate the parent npm JavaScript entrypoint before work.
    const injectedNpmCliPath = npmInvocation?.args?.[0];
    if (npmInvocation && (typeof injectedNpmCliPath !== 'string' || !injectedNpmCliPath)) {
      throw new Error('Injected npm invocation must identify npm-cli.js as its first argument.');
    }
    const npmCliPath = injectedNpmCliPath || await resolveNpmCliPath({
      environment,
      nodeExecutable: process.execPath,
    });
    const installInvocation = npmInvocation || resolveNpmInvocation({
      environment: { ...environment, npm_execpath: npmCliPath },
      nodeExecutable: process.execPath,
    });
    const directBuildInvocation = resolveNpmScriptInvocation({
      npmCliPath,
      script: 'build:store:vercel',
      nodeExecutable: process.execPath,
    });
    const resolvedVercelInvocation = vercelInvocation || (
      commandRunner === run
        ? await resolveVercelInvocation({ environment, vercelCommand })
        : { command: vercelCommand, argsPrefix: [], options: { shell: false } }
    );
    const storeRoot = path.join(workspaceRoot, 'store');
    const vercelExecutionEnvironment = buildVercelExecutionEnvironment({ environment });
    const inspectedProject = projectInspection || (
      commandRunner === run
        ? sanitizeVercelProjectInspection(
          [
            (() => {
              const result = commandRunner(
              resolvedVercelInvocation.command,
              [...resolvedVercelInvocation.argsPrefix, 'project', 'inspect', STORE_PROJECT_NAME],
              { cwd: workspaceRoot, environment: vercelExecutionEnvironment, ...resolvedVercelInvocation.options },
              );
              return `${result?.stdout || ''}\n${result?.stderr || ''}`;
            })(),
          ].join('\n'),
          workspaceRoot,
        )
        : Object.freeze({
          projectId: STORE_PROJECT_ID,
          projectName: STORE_PROJECT_NAME,
          configuredRootDirectory: 'store',
        })
    );
    if (inspectedProject.projectId && inspectedProject.projectId !== STORE_PROJECT_ID) {
      throw new Error('Vercel project inspection does not match the expected store project.');
    }
    if (inspectedProject.projectName && inspectedProject.projectName !== STORE_PROJECT_NAME) {
      throw new Error('Vercel project inspection does not match the expected store project name.');
    }
    if (inspectedProject.configuredRootDirectory !== 'store') {
      throw new Error('Vercel project inspection must confirm Root Directory = store.');
    }
    await writeProjectLink(workspaceRoot);

    const npmExecutionEnvironment = buildNpmExecutionEnvironment({ environment });
    await mkdir(npmExecutionEnvironment.NPM_CONFIG_CACHE, { recursive: true });
    const buildEnvironment = {
      ...npmExecutionEnvironment,
      VITE_SUPABASE_URL: 'https://invalid-for-local-build.supabase.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_invalid_for_local_build',
      PUBLIC_STORE_ORIGINS: 'https://store.invalid',
    };
    commandRunner(installInvocation.command, installInvocation.args, {
      cwd: workspaceRoot,
      environment: npmExecutionEnvironment,
      ...installInvocation.options,
    });
    commandRunner(
      directBuildInvocation.command,
      directBuildInvocation.args,
      { cwd: workspaceRoot, environment: buildEnvironment, ...directBuildInvocation.options },
    );
    commandRunner(
      resolvedVercelInvocation.command,
      [...resolvedVercelInvocation.argsPrefix, 'pull', '--yes', '--environment=preview'],
      { cwd: workspaceRoot, environment: vercelExecutionEnvironment, ...resolvedVercelInvocation.options },
    );
    const linkedProject = JSON.parse(await readFile(path.join(workspaceRoot, '.vercel', 'project.json'), 'utf8'));
    if (linkedProject.projectId !== STORE_PROJECT_ID || linkedProject.orgId !== STORE_ORGANIZATION_ID) {
      throw new Error('Temporary Vercel project link does not match the inspected store project.');
    }
    const downloadedEnvironmentPath = path.join(workspaceRoot, '.vercel', '.env.preview.local');
    if (!await pathExists(downloadedEnvironmentPath)) {
      if (commandRunner === run) {
        throw new Error('Vercel pull did not produce .vercel/.env.preview.local.');
      }
      await writeFile(downloadedEnvironmentPath, '', { encoding: 'utf8', flag: 'wx' });
    }
    const prebuiltConfigPath = path.join(storeRoot, 'vercel.prebuilt.json');
    const { sourceConfig, prebuiltConfig } = await writePrebuiltVercelConfig({
      sourceConfigPath: path.join(storeRoot, 'vercel.json'),
      targetConfigPath: prebuiltConfigPath,
    });
    const effectiveProjectRoot = await assertEffectiveVercelProjectRoot({
      workspaceRoot,
      configuredRootDirectory: inspectedProject.configuredRootDirectory,
      prebuiltConfigPath,
    });
    const zeroConfigBuild = commandRunner(
      resolvedVercelInvocation.command,
      [...resolvedVercelInvocation.argsPrefix, 'build', '--debug', '--local-config', './store/vercel.prebuilt.json'],
      { cwd: workspaceRoot, environment: vercelExecutionEnvironment, ...resolvedVercelInvocation.options },
    );

    await removeWorkspaceEnvironmentFiles({ workspaceRoot });
    const outputRoot = path.join(workspaceRoot, '.vercel', 'output');
    const outputConfigPath = path.join(outputRoot, 'config.json');
    const outputFunctionsPath = path.join(outputRoot, 'functions');
    const outputStaticPath = path.join(outputRoot, 'static');
    if (!await pathExists(outputConfigPath)) throw new Error('Vercel did not produce .vercel/output.');
    const zeroConfigDebugLog = sanitizeVercelDebugLog(
      `${zeroConfigBuild?.stdout || ''}\n${zeroConfigBuild?.stderr || ''}`,
      workspaceRoot,
    );
    const zeroConfigFunctionInventory = await inspectGeneratedFunctionInventory(outputFunctionsPath);
    let finalFunctionInventory = zeroConfigFunctionInventory;
    let usedExplicitBuildsFallback = false;
    let generatedPrebuiltConfig = prebuiltConfig;
    if (!zeroConfigFunctionInventory.complete) {
      generatedPrebuiltConfig = {
        ...prebuiltConfig,
        builds: [
          { src: 'api/store-page.js', use: '@vercel/node' },
          { src: 'api/og/store.js', use: '@vercel/node' },
        ],
      };
      assertPrebuiltVercelConfigParity(sourceConfig, generatedPrebuiltConfig);
      await rm(outputRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
      await writeFile(prebuiltConfigPath, `${JSON.stringify(generatedPrebuiltConfig, null, 2)}\n`, 'utf8');
      commandRunner(
        resolvedVercelInvocation.command,
        [...resolvedVercelInvocation.argsPrefix, 'build', '--debug', '--local-config', './store/vercel.prebuilt.json'],
        { cwd: workspaceRoot, environment: vercelExecutionEnvironment, ...resolvedVercelInvocation.options },
      );
      await removeWorkspaceEnvironmentFiles({ workspaceRoot });
      usedExplicitBuildsFallback = true;
      finalFunctionInventory = await inspectGeneratedFunctionInventory(outputFunctionsPath);
      if (!finalFunctionInventory.complete) {
        throw new Error(`Vercel fallback did not generate exactly the two public functions: ${JSON.stringify({
          zeroConfigFunctionInventory,
          finalFunctionInventory,
        })}`);
      }
    }
    if (!await pathExists(outputConfigPath)) throw new Error('Vercel did not produce .vercel/output after function packaging.');
    const functionRuntimeCompatibility = await applyGeneratedFunctionRuntimeCompatibility(
      outputFunctionsPath,
    );
    const vercelOutputInventory = (await walk(outputRoot)).map((file) => ({
      path: file.relativePath,
      bytes: file.bytes,
    }));
    if (await pathExists(path.join(outputRoot, 'vercel.prebuilt.json'))) {
      throw new Error('The temporary Vercel configuration must not be included in .vercel/output.');
    }
    const inventoryPaths = vercelOutputInventory.map((file) => file.path).join(', ') || '<empty>';
    if (!await pathExists(outputFunctionsPath) || !(await stat(outputFunctionsPath)).isDirectory()) {
      throw new Error(`Vercel did not produce .vercel/output/functions (inventory: ${inventoryPaths}).`);
    }
    await applyCanonicalNoindex(outputConfigPath);
    const staticMaterialization = await materializePrebuiltStaticOutput({
      sourceStaticRoot: path.join(storeRoot, 'dist'),
      outputStaticRoot: outputStaticPath,
    });

    const auditOptions = {
      sourceConfigPath: path.join(workspaceRoot, 'store', 'vercel.json'),
      sourceStaticPath: path.join(workspaceRoot, 'store', 'dist'),
    };
    const audit = await prebuiltAuditor('store', workspaceRoot, auditOptions);
    if (audit.status !== 'PASS') {
      const diagnostic = sanitizeFailedOutputDiagnostic({
        audit,
        usedExplicitBuildsFallback,
        zeroConfigFunctionInventory,
        finalFunctionInventory,
      });
      throw new Error(`Vercel output audit failed:\n${JSON.stringify(diagnostic)}`);
    }
    const finalized = await finalizePassedStoreWorkspace({
      workspaceRoot,
      storeRoot,
      auditOptions,
      prebuiltAuditor,
    });
    const finalAudit = finalized.audit;
    const manifest = await writeExternalManifest(workspaceRoot, outputRoot);
    manifestPath = manifest.manifestPath;

    const finalState = await assertProtectedRepositoryIntegrity(repositoryRoot, baseline);
    const repositoryStability = await repositoryStabilityChecker({
      initialIdentity,
      repositoryRoot,
      commandRunner: gitCommandRunner,
      environment,
      statusReader: repositoryStatusReader,
      identityResolver: repositoryIdentityResolver,
    });
    const outputFiles = await walk(outputRoot);
    const result = {
      phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.7',
      status: 'PASS',
      targetEnvironment: TARGET_ENVIRONMENT,
      deploymentType: DEPLOYMENT_TYPE,
      production: false,
      HEAD,
      strategy: 'git-head-temporary-index',
      sourceProvenance: {
        mode: 'git-head-temporary-index',
        HEAD,
        treeOid: initialIdentity.treeOid,
        objectFormat: initialIdentity.objectFormat,
        checkoutCleanBefore: true,
        checkoutCleanAfter: repositoryStability.checkoutCleanAfter,
        headStable: repositoryStability.headStable,
        treeStable: repositoryStability.treeStable,
        snapshotFromTemporaryIndex: snapshotEvidence.snapshotFromTemporaryIndex,
        trackedFilesOnly: snapshotEvidence.trackedFilesOnly,
        workingTreeCopied: snapshotEvidence.workingTreeCopied,
        snapshotRemoved: sourceCleanup.snapshotRemoved,
        temporaryIndexRemoved: sourceCleanup.temporaryIndexRemoved,
      },
      workspaceRoot,
      storeRoot,
      outputRoot,
      manifestPath,
      manifestTreeSha256: manifest.treeSha256,
      artifactManifest: {
        schemaVersion: manifest.schemaVersion,
        targetEnvironment: manifest.targetEnvironment,
        deploymentType: manifest.deploymentType,
        production: manifest.production,
        deploymentExecuted: manifest.deploymentExecuted,
      },
      vercelOutputInventory,
      functionRuntimeCompatibility,
      staticMaterialization,
      output: {
        files: outputFiles.length,
        bytes: outputFiles.reduce((total, file) => total + file.bytes, 0),
        functions: finalAudit.output.functions,
        routes: finalAudit.output.routes,
      },
      audit: finalAudit,
      environmentFilesFound: finalized.environmentFilesFound,
      protectedRepository: {
        gitignoreUnchanged:
          baseline.rootGitignoreHash === finalState.rootGitignoreHash
          && baseline.storeGitignoreHash === finalState.storeGitignoreHash,
        administrativeConfigUnchanged:
          baseline.administrativeConfigHash === finalState.administrativeConfigHash,
        storeConfigUnchanged: baseline.storeConfigHash === finalState.storeConfigHash,
        storePrebuiltConfigUnchanged:
          baseline.storePrebuiltConfigHash === finalState.storePrebuiltConfigHash,
        storePrebuiltConfigPresent:
          finalState.storePrebuiltConfigPresent,
        administrativeProjectLinkUnchanged:
          baseline.administrativeProjectLinkHash
            === finalState.administrativeProjectLinkHash,
        administrativeProjectLinkPresent:
          finalState.administrativeProjectLinkPresent,
        administrativeVercelUnchanged:
          JSON.stringify(baseline.administrativeVercel)
            === JSON.stringify(finalState.administrativeVercel),
        repositoryEnvironmentUnchanged:
          JSON.stringify(baseline.repositoryEnvironment)
            === JSON.stringify(finalState.repositoryEnvironment),
      },
      commands: {
        install: `${path.basename(process.execPath)} ${path.basename(npmCliPath)} ci --no-audit --no-fund`,
        directBuild: DIRECT_STORE_BUILD_COMMAND,
        pull: PULL_COMMAND,
        build: BUILD_COMMAND,
        deploy: DEPLOY_COMMAND,
      },
      zeroConfigFunctionInventory,
      finalFunctionInventory,
      prebuiltConfig: {
        source: sourceConfig,
        generated: generatedPrebuiltConfig,
        path: prebuiltConfigPath,
      },
      projectInspection: {
        ...inspectedProject,
        linkedDirectory: workspaceRoot,
        vercelCommandCwd: workspaceRoot,
        effectiveSourceRoot: effectiveProjectRoot.effectiveSourceRoot,
        apiDirectory: effectiveProjectRoot.apiDirectory,
        apiDirectoryExists: effectiveProjectRoot.apiDirectoryExists,
        zeroConfigDebugLog,
        usedExplicitBuildsFallback,
      },
      deploymentExecuted: false,
      workspacePreserved: preservePassedWorkspace === true,
      cleanupRequired: preservePassedWorkspace === true,
    };
    if (!preservePassedWorkspace) {
      await cleanupPreparedStoreWorkspace({ workspaceRoot, manifestPath });
      return {
        ...result,
        workspaceRoot: null,
        storeRoot: null,
        outputRoot: null,
        manifestPath: null,
        workspacePreserved: false,
        cleanupRequired: false,
        cleanupCompleted: true,
      };
    }
    return result;
  } catch (error) {
    let failure = error;
    if (gitSnapshot) {
      try {
        await gitSnapshotRemover({
          ...gitSnapshot,
          repositoryRoot,
          workspaceRoot,
          temporaryRoot,
        });
        gitSnapshot = null;
      } catch {
        failure = new Error(
          `${String(failure?.message || failure)} Git snapshot cleanup was blocked.`,
        );
      }
    }
    try {
      await assertProtectedRepositoryIntegrity(repositoryRoot, baseline);
    } catch (integrityError) {
      failure = integrityError;
    }
    if (workspaceRoot) {
      try {
        await cleanupPreparedStoreWorkspace({ workspaceRoot, manifestPath });
        manifestPath = '';
      } catch (cleanupError) {
        const cleanupDiagnostic = sanitizeCommandDiagnostic(cleanupError?.message, workspaceRoot);
        failure = new Error(
          `${String(failure?.message || failure)} Workspace cleanup was blocked: ${cleanupDiagnostic}`,
        );
      }
    }
    if (manifestPath) await rm(manifestPath, { force: true });
    throw failure;
  }
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  prepareStoreDeployment()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.6',
        status: 'BLOCKED',
        error: String(error?.message || error).slice(0, 12_000),
        deploymentExecuted: false,
      }));
      process.exitCode = 1;
    });
}
