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
import { auditPrebuiltOutput } from './audit-vercel-build-output.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const STORE_PROJECT_ID = 'prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4';
const STORE_ORGANIZATION_ID = 'team_buvft2mAJErTNR8gDhXcZGfS';
const TEMPORARY_PREFIX = 'lanzo-store-social-preview-1-6-';
const BUILD_COMMAND = 'vercel build --prod --yes --local-config ./vercel.json';
const IS_WINDOWS = process.platform === 'win32';
const DEFAULT_NPM_COMMAND = IS_WINDOWS ? 'npm.cmd' : 'npm';
const DEFAULT_VERCEL_COMMAND = IS_WINDOWS ? 'vercel.cmd' : 'vercel';
const DEFAULT_WINDOWS_COMMAND_PROCESSOR = 'C:\\Windows\\System32\\cmd.exe';
const WINDOWS_COMMAND_WRAPPER_PATTERN = /\.(?:cmd|bat)$/iu;
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

export function resolveCliCommands({
  platform = process.platform,
  environment = {},
} = {}) {
  const windows = platform === 'win32';
  const npmOverride = typeof environment?.NPM_CLI_PATH === 'string'
    ? environment.NPM_CLI_PATH.trim()
    : '';
  const vercelOverride = typeof environment?.VERCEL_CLI_PATH === 'string'
    ? environment.VERCEL_CLI_PATH.trim()
    : '';
  return Object.freeze({
    // Kept for callers that only need to display the configured value.  npm itself
    // is invoked through resolveNpmInvocation, never through this wrapper name.
    npmCommand: npmOverride || (windows ? 'npm.cmd' : 'npm'),
    vercelCommand: vercelOverride || (windows ? 'vercel.cmd' : 'vercel'),
  });
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

export function getEnvironmentValueCaseInsensitive(environment, name) {
  const key = Object.keys(environment || {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? environment[key] : undefined;
}

export function setEnvironmentValueCaseInsensitive(environment, name, value) {
  const normalized = { ...environment };
  for (const key of Object.keys(normalized)) {
    if (key.toLowerCase() === name.toLowerCase()) delete normalized[key];
  }
  normalized[name] = value;
  return normalized;
}

export function prependPathEntry(inheritedPath, entry) {
  const entries = String(inheritedPath || '').split(path.delimiter).filter(Boolean);
  const normalizedEntry = path.normalize(entry).toLowerCase();
  return [entry, ...entries.filter((item) => path.normalize(item).toLowerCase() !== normalizedEntry)].join(path.delimiter);
}

export function buildVercelExecutionEnvironment({
  environment = process.env,
  useLoggedInAuthentication = true,
} = {}) {
  let vercelEnvironment = { ...environment };
  if (useLoggedInAuthentication) {
    for (const name of Object.keys(vercelEnvironment)) {
      if (name.toUpperCase() === 'VERCEL_TOKEN') delete vercelEnvironment[name];
    }
  }
  if (process.platform === 'win32') {
    const systemRoot = getEnvironmentValueCaseInsensitive(environment, 'SystemRoot')
      || getEnvironmentValueCaseInsensitive(environment, 'WINDIR')
      || process.env.SystemRoot
      || 'C:\\Windows';
    const commandProcessor = getEnvironmentValueCaseInsensitive(environment, 'ComSpec')
      || path.join(systemRoot, 'System32', 'cmd.exe');
    const system32 = path.dirname(commandProcessor);
    const inheritedPath = getEnvironmentValueCaseInsensitive(environment, 'PATH') || '';
    vercelEnvironment = setEnvironmentValueCaseInsensitive(vercelEnvironment, 'SystemRoot', systemRoot);
    vercelEnvironment = setEnvironmentValueCaseInsensitive(vercelEnvironment, 'WINDIR', systemRoot);
    vercelEnvironment = setEnvironmentValueCaseInsensitive(vercelEnvironment, 'ComSpec', commandProcessor);
    vercelEnvironment = setEnvironmentValueCaseInsensitive(
      vercelEnvironment, 'PATH', prependPathEntry(inheritedPath, system32),
    );
  }
  return Object.freeze(vercelEnvironment);
}

function serializeDotenvValue(value) {
  const text = String(value || '');
  if (/[\0\r\n]/u.test(text)) throw new Error('Windows build environment contains an unsafe dotenv value.');
  return JSON.stringify(text);
}

export async function injectWindowsBuildEnvironment({ envFilePath, environment }) {
  const existing = await readFile(envFilePath, 'utf8');
  const managed = new Set(['path', 'systemroot', 'windir', 'comspec']);
  const preserved = existing.split(/\r?\n/u).filter((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u);
    return !match || !managed.has(match[1].toLowerCase());
  });
  const values = ['PATH', 'SystemRoot', 'WINDIR', 'ComSpec'].map((name) => {
    const value = getEnvironmentValueCaseInsensitive(environment, name);
    if (!value) throw new Error(`Windows build environment is missing ${name}.`);
    return `${name}=${serializeDotenvValue(value)}`;
  });
  const temporaryPath = `${envFilePath}.tmp`;
  await writeFile(temporaryPath, `${[...preserved.filter(Boolean), ...values].join('\n')}\n`, 'utf8');
  await rename(temporaryPath, envFilePath);
}

function assertSafeWindowsWrapperCommand(command) {
  const value = String(command || '');
  if (!value || /[\0\r\n"&|<>^%!]/u.test(value)) {
    throw new Error('Unsafe Windows CLI executable.');
  }
  return value;
}

function quoteWindowsCommandArgument(value) {
  const argument = String(value);
  if (/[\0\r\n]/u.test(argument)) {
    throw new Error('Windows CLI arguments must not contain CR, LF, or NUL.');
  }
  if (/[%!]/u.test(argument)) {
    throw new Error('Windows CLI arguments must not contain expansion operators.');
  }
  return `"${argument.replaceAll('"', '""')}"`;
}

export function buildWindowsCommandLine(command, args) {
  const executable = assertSafeWindowsWrapperCommand(command);
  if (!Array.isArray(args)) throw new TypeError('CLI arguments must be an array.');
  return [
    quoteWindowsCommandArgument(executable),
    ...args.map(quoteWindowsCommandArgument),
  ].join(' ');
}

export function buildWindowsCmdPayload(command, args) {
  return `"${buildWindowsCommandLine(command, args)}"`;
}

export function resolveSpawnInvocation({
  command,
  args,
  platform = process.platform,
  environment = process.env,
}) {
  if (!Array.isArray(args)) throw new TypeError('CLI arguments must be an array.');
  const resolvedCommand = platform === 'win32'
    ? assertSafeWindowsWrapperCommand(command)
    : command;
  if (platform !== 'win32' || !WINDOWS_COMMAND_WRAPPER_PATTERN.test(resolvedCommand)) {
    return {
      command: resolvedCommand,
      args,
      options: { shell: false },
    };
  }
  const commandProcessor = environment?.ComSpec
    || environment?.COMSPEC
    || DEFAULT_WINDOWS_COMMAND_PROCESSOR;
  return {
    command: commandProcessor,
    args: ['/d', '/s', '/c', buildWindowsCmdPayload(resolvedCommand, args)],
    options: {
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: true,
    },
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
    platform = process.platform,
  } = {},
) {
  const invocation = resolveSpawnInvocation({
    command,
    args,
    platform,
    environment,
  });
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
    if (
      result.error?.code === 'EINVAL'
      && platform === 'win32'
      && invocation.command !== command
    ) {
      throw new Error(
        `Unable to launch Windows command wrapper for ${executableName(command)}`
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
    const resolvedVercelCommand = IS_WINDOWS && vercelCommand === DEFAULT_VERCEL_COMMAND
      ? await resolveWindowsPathCommand(vercelCommand, environment)
      : vercelCommand;
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
      ...vercelExecutionEnvironment,
      VITE_SUPABASE_URL: 'https://invalid-for-local-build.supabase.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_invalid_for_local_build',
      PUBLIC_STORE_ORIGINS: 'https://store.invalid',
    };
    commandRunner(installInvocation.command, installInvocation.args, {
      cwd: workspaceRoot,
      environment: npmExecutionEnvironment,
    });
    commandRunner(
      resolvedVercelCommand,
      ['pull', '--yes', '--environment=production'],
      { cwd: storeRoot, environment: buildEnvironment },
    );
    const downloadedEnvironmentPath = path.join(storeRoot, '.vercel', '.env.production.local');
    if (!await pathExists(downloadedEnvironmentPath)) {
      if (commandRunner === run) {
        throw new Error('Vercel pull did not produce .vercel/.env.production.local.');
      }
      await writeFile(downloadedEnvironmentPath, '', { encoding: 'utf8', flag: 'wx' });
    }
    await injectWindowsBuildEnvironment({
      envFilePath: downloadedEnvironmentPath,
      environment: buildEnvironment,
    });
    commandRunner(
      resolvedVercelCommand,
      ['build', '--prod', '--local-config', './vercel.json'],
      { cwd: storeRoot, environment: buildEnvironment },
    );

    await removeGeneratedEnvironmentFiles(workspaceRoot, storeRoot);
    const outputRoot = path.join(storeRoot, '.vercel', 'output');
    const outputConfigPath = path.join(outputRoot, 'config.json');
    if (!await pathExists(outputConfigPath)) throw new Error('Vercel did not produce .vercel/output.');
    await applyCanonicalNoindex(outputConfigPath);

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
        build: BUILD_COMMAND,
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
