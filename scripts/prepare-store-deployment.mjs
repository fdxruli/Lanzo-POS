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
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditPrebuiltOutput, inspectStatic } from './audit-vercel-build-output.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const STORE_PROJECT_ID = 'prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4';
const STORE_ORGANIZATION_ID = 'team_buvft2mAJErTNR8gDhXcZGfS';
const TEMPORARY_PREFIX = 'lanzo-store-social-preview-1-6-';
const BUILD_COMMAND = 'vercel build --prod --local-config ./vercel.prebuilt.json';
const DIRECT_STORE_BUILD_COMMAND = 'npm run build:store:vercel';
const DEFAULT_VERCEL_COMMAND = 'vercel';
const normalizePath = (value) => value.replaceAll('\\', '/');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

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
    throw new Error(`Public static build audit failed: ${failedSourceChecks.join(', ')}.`);
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
  const candidate = configured || vercelCommand;
  const commandPath = await resolveWindowsPathCommand(
    candidate === DEFAULT_VERCEL_COMMAND ? 'vercel.cmd' : candidate,
    environment,
  );
  const cliPath = commandPath.toLowerCase().endsWith('.js')
    ? commandPath
    : path.join(path.dirname(commandPath), 'node_modules', 'vercel', 'dist', 'vc.js');
  if (!await isFile(cliPath)) {
    throw new Error('Unable to resolve the Vercel JavaScript CLI without a Windows command wrapper.');
  }
  return Object.freeze({
    command: nodeExecutable,
    argsPrefix: Object.freeze([cliPath]),
    options: Object.freeze({ shell: false }),
  });
}

export function buildNpmExecutionEnvironment({
  environment = process.env,
  temporaryDirectory = os.tmpdir(),
} = {}) {
  return Object.freeze({
    ...environment,
    NPM_CONFIG_CACHE: path.join(temporaryDirectory, 'lanzo-store-social-preview-npm-cache'),
    XDG_CACHE_HOME: path.join(temporaryDirectory, 'lanzo-store-npm-cache'),
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

async function writeProjectLink(storeRoot) {
  const vercelDirectory = path.join(storeRoot, '.vercel');
  await mkdir(vercelDirectory, { recursive: true });
  await writeFile(path.join(vercelDirectory, 'project.json'), `${JSON.stringify({
    projectId: STORE_PROJECT_ID,
    orgId: STORE_ORGANIZATION_ID,
  })}\n`, { encoding: 'utf8', flag: 'wx' });
}

async function removeGeneratedEnvironmentFiles(workspaceRoot, storeRoot) {
  const candidates = [
    path.join(workspaceRoot, '.env.local'),
    path.join(workspaceRoot, '.env.production.local'),
    path.join(storeRoot, '.env.local'),
    path.join(storeRoot, '.env.production.local'),
    path.join(storeRoot, '.vercel', '.env.production.local'),
    path.join(storeRoot, '.vercel', '.env.preview.local'),
    path.join(storeRoot, '.vercel', '.env.development.local'),
  ];
  for (const candidate of candidates) await rm(candidate, { force: true });
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

async function writeExternalManifest(workspaceRoot, outputRoot) {
  const files = await walk(outputRoot);
  const manifest = await Promise.all(files.map(async (file) => ({
    path: file.relativePath,
    bytes: file.bytes,
    sha256: sha256(await readFile(file.absolutePath)),
  })));
  const manifestPath = `${workspaceRoot}-output-sha256.json`;
  const document = {
    schemaVersion: 1,
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
    maxRetries: 5,
    retryDelay: 250,
  });
}

export async function prepareStoreDeployment({
  repositoryRoot = projectRoot,
  commandRunner = run,
  vercelCommand = process.env.VERCEL_CLI_PATH || DEFAULT_VERCEL_COMMAND,
  vercelInvocation,
  npmInvocation,
  environment = process.env,
} = {}) {
  const baseline = await protectedRepositoryState(repositoryRoot);
  let workspaceRoot = '';
  let manifestPath = '';
  try {
    // Capture and validate the parent npm entrypoint before any work in the
    // temporary workspace. A bare npm.cmd makes %~dp0 point at that workspace.
    const npmCliPath = await resolveNpmCliPath({
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
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), TEMPORARY_PREFIX));
    await createSanitizedStoreWorkspace({
      sourceRoot: repositoryRoot,
      temporaryRoot: workspaceRoot,
    });
    const storeRoot = path.join(workspaceRoot, 'store');
    await writeProjectLink(storeRoot);

    const npmExecutionEnvironment = buildNpmExecutionEnvironment({ environment });
    await mkdir(npmExecutionEnvironment.NPM_CONFIG_CACHE, { recursive: true });
    const vercelExecutionEnvironment = buildVercelExecutionEnvironment({ environment });
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
      [...resolvedVercelInvocation.argsPrefix, 'pull', '--yes', '--environment=production'],
      { cwd: storeRoot, environment: vercelExecutionEnvironment, ...resolvedVercelInvocation.options },
    );
    const downloadedEnvironmentPath = path.join(storeRoot, '.vercel', '.env.production.local');
    if (!await pathExists(downloadedEnvironmentPath)) {
      if (commandRunner === run) {
        throw new Error('Vercel pull did not produce .vercel/.env.production.local.');
      }
      await writeFile(downloadedEnvironmentPath, '', { encoding: 'utf8', flag: 'wx' });
    }
    const prebuiltConfigPath = path.join(storeRoot, 'vercel.prebuilt.json');
    const { sourceConfig, prebuiltConfig } = await writePrebuiltVercelConfig({
      sourceConfigPath: path.join(storeRoot, 'vercel.json'),
      targetConfigPath: prebuiltConfigPath,
    });
    commandRunner(
      resolvedVercelInvocation.command,
      [...resolvedVercelInvocation.argsPrefix, 'build', '--prod', '--local-config', './vercel.prebuilt.json'],
      { cwd: storeRoot, environment: vercelExecutionEnvironment, ...resolvedVercelInvocation.options },
    );

    await removeGeneratedEnvironmentFiles(workspaceRoot, storeRoot);
    const outputRoot = path.join(storeRoot, '.vercel', 'output');
    const outputConfigPath = path.join(outputRoot, 'config.json');
    const outputFunctionsPath = path.join(outputRoot, 'functions');
    const outputStaticPath = path.join(outputRoot, 'static');
    if (!await pathExists(outputConfigPath)) throw new Error('Vercel did not produce .vercel/output.');
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

    const audit = await auditPrebuiltOutput('store', storeRoot, {
      sourceConfigPath: path.join(workspaceRoot, 'store', 'vercel.json'),
      sourceStaticPath: path.join(workspaceRoot, 'store', 'dist'),
    });
    if (audit.status !== 'PASS') {
      throw new Error(`Vercel output audit failed: ${audit.failedChecks.join(', ')}.`);
    }
    const manifest = await writeExternalManifest(workspaceRoot, outputRoot);
    manifestPath = manifest.manifestPath;

    const finalState = await assertProtectedRepositoryIntegrity(repositoryRoot, baseline);
    const outputFiles = await walk(outputRoot);
    return {
      phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.6',
      status: 'PASS',
      strategy: 'sanitized-repository-copy',
      workspaceRoot,
      storeRoot,
      outputRoot,
      manifestPath,
      manifestTreeSha256: manifest.treeSha256,
      vercelOutputInventory,
      staticMaterialization,
      output: {
        files: outputFiles.length,
        bytes: outputFiles.reduce((total, file) => total + file.bytes, 0),
        functions: audit.output.functions,
        routes: audit.output.routes,
      },
      audit,
      protectedRepository: {
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
        build: BUILD_COMMAND,
      },
      prebuiltConfig: {
        source: sourceConfig,
        generated: prebuiltConfig,
        path: prebuiltConfigPath,
      },
      deploymentExecuted: false,
    };
  } catch (error) {
    let failure = error;
    try {
      await assertProtectedRepositoryIntegrity(repositoryRoot, baseline);
    } catch (integrityError) {
      failure = integrityError;
    }
    if (workspaceRoot) {
      try {
        await removeTemporaryWorkspace(workspaceRoot);
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
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  prepareStoreDeployment()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.6',
        status: 'BLOCKED',
        error: String(error?.message || error).slice(0, 1_000),
        deploymentExecuted: false,
      }));
      process.exitCode = 1;
    });
}
