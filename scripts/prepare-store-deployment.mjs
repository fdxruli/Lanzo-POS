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
import { auditPrebuiltOutput } from './audit-vercel-build-output.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const STORE_PROJECT_ID = 'prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4';
const STORE_ORGANIZATION_ID = 'team_buvft2mAJErTNR8gDhXcZGfS';
const TEMPORARY_PREFIX = 'lanzo-store-social-preview-1-6-';
const BUILD_COMMAND = 'vercel build --prod --yes --local-config ./vercel.json';
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

function run(command, args, { cwd, environment = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr || result.error?.message || '')
      .replaceAll(process.cwd(), '<repository>')
      .replaceAll(cwd || '', '<workspace>')
      .slice(0, 1_000);
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status}: ${stderr}`,
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

export async function prepareStoreDeployment({
  repositoryRoot = projectRoot,
  commandRunner = run,
  vercelCommand = process.env.VERCEL_CLI_PATH || 'vercel',
} = {}) {
  const baseline = await protectedRepositoryState(repositoryRoot);
  let workspaceRoot = '';
  let manifestPath = '';
  try {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), TEMPORARY_PREFIX));
    await createSanitizedStoreWorkspace({
      sourceRoot: repositoryRoot,
      temporaryRoot: workspaceRoot,
    });
    const storeRoot = path.join(workspaceRoot, 'store');
    await writeProjectLink(storeRoot);

    const npmCache = path.join(os.tmpdir(), 'lanzo-store-social-preview-npm-cache');
    await mkdir(npmCache, { recursive: true });
    const environment = {
      ...process.env,
      NPM_CONFIG_CACHE: npmCache,
      XDG_CACHE_HOME: path.join(os.tmpdir(), 'lanzo-store-vercel-cache'),
      XDG_CONFIG_HOME: path.join(os.tmpdir(), 'lanzo-store-vercel-config'),
      XDG_DATA_HOME: path.join(os.tmpdir(), 'lanzo-store-vercel-data'),
      VITE_SUPABASE_URL: 'https://invalid-for-local-build.supabase.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_invalid_for_local_build',
      PUBLIC_STORE_ORIGINS: 'https://store.invalid',
    };
    commandRunner('npm', ['ci', '--no-audit', '--no-fund'], {
      cwd: workspaceRoot,
      environment,
    });
    commandRunner(
      vercelCommand,
      ['build', '--prod', '--yes', '--local-config', './vercel.json'],
      { cwd: storeRoot, environment },
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
        install: 'npm ci --no-audit --no-fund',
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
    if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true });
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
