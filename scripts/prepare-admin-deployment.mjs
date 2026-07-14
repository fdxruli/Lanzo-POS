/**
 * Prepares, but never deploys, the isolated administrative artifact.
 *
 * Usage:
 *   node scripts/prepare-admin-deployment.mjs
 */
import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const distRoot = path.join(projectRoot, 'dist');
const configPath = path.join(projectRoot, 'vercel.json');
const rootVercelDirectory = path.join(projectRoot, '.vercel');
const adminProjectId = 'prj_tE5uWn6kLBYdS1eDFWVxRm449RUr';
const adminOrganizationId = 'team_buvft2mAJErTNR8gDhXcZGfS';
const temporaryPrefix = 'lanzo-pos-cutover-1-1-';
const buildCommand = 'vercel build --prod --yes --local-config ./vercel.json';
const deployCommand = 'vercel deploy --prebuilt --prod --yes';
const normalizePath = (value) => value.replaceAll('\\', '/');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fileSha256 = async (filePath) => sha256(await readFile(filePath));
const deploymentConfigBytes = (source) => `${JSON.stringify({
  ...JSON.parse(source),
  framework: null
}, null, 2)}\n`;

const forbiddenPathPatterns = Object.freeze([
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)\.git(?:\/|$)/i,
  /(^|\/)\.vercel(?:\/|$)/i,
  /(^|\/)node_modules(?:\/|$)/i,
  /(^|\/)(?:src|scripts|tests|docs|supabase|reports)(?:\/|$)/i,
  /(^|\/)package(?:-lock)?\.json$/i,
  /(^|\/)vite(?:\.store)?\.config\.[^/]+$/i,
  /\.map$/i
]);

const forbiddenSecretPatterns = Object.freeze({
  vercelToken: /VERCEL_TOKEN|\b(?:vcp|vercel)_[A-Za-z0-9_-]{20,}\b/i,
  githubToken: /GITHUB_TOKEN|\bgh[pousr]_[A-Za-z0-9]{20,}\b/i,
  privateKey: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i,
  stripeSecret: /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b/i,
  supabaseSecretKey: /\bsb_(?:secret|service_role)_[A-Za-z0-9_-]+\b/i
});

const textExtensions = new Set(['.css', '.html', '.js', '.json', '.svg', '.txt', '.webmanifest']);

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
    const relativePath = normalizePath(path.relative(root, absolutePath));
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) throw new Error(`Symbolic links are forbidden: ${relativePath}`);
    if (entry.isDirectory()) files.push(...await walk(absolutePath, root));
    else if (entry.isFile()) files.push({ absolutePath, relativePath, bytes: metadata.size });
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function decodeJwtRole(candidate) {
  try {
    const payload = candidate.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return typeof decoded.role === 'string' ? decoded.role : '';
  } catch {
    return '';
  }
}

async function auditFiles(root) {
  const files = await walk(root);
  const forbiddenPaths = files
    .filter(({ relativePath }) => forbiddenPathPatterns.some((pattern) => pattern.test(relativePath)))
    .map(({ relativePath }) => relativePath);
  const secretViolations = [];

  for (const file of files) {
    if (!textExtensions.has(path.extname(file.relativePath).toLowerCase())) continue;
    const source = await readFile(file.absolutePath, 'utf8');
    for (const [name, pattern] of Object.entries(forbiddenSecretPatterns)) {
      if (pattern.test(source)) secretViolations.push(`${name}:${file.relativePath}`);
    }
    for (const candidate of source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
      if (decodeJwtRole(candidate) === 'service_role') {
        secretViolations.push(`serviceRoleJwt:${file.relativePath}`);
      }
    }
  }

  return {
    files,
    forbiddenPaths: [...new Set(forbiddenPaths)],
    secretViolations: [...new Set(secretViolations)]
  };
}

const buildManifest = (files) => Promise.all(files.map(async ({ absolutePath, relativePath, bytes }) => ({
  path: relativePath,
  bytes,
  sha256: await fileSha256(absolutePath)
})));

function assertTemporaryPackageRoot(candidate) {
  const resolved = path.resolve(candidate);
  const temporaryDirectory = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== temporaryDirectory || !path.basename(resolved).startsWith(temporaryPrefix)) {
    throw new Error(`Prebuilt finalization is restricted to ${temporaryPrefix} roots below the system temp directory.`);
  }
  return resolved;
}

async function finalizePrebuilt(packageDirectoryArgument) {
  const packageDirectory = assertTemporaryPackageRoot(packageDirectoryArgument);
  const packageConfigPath = path.join(packageDirectory, 'vercel.json');
  const projectLinkPath = path.join(packageDirectory, '.vercel', 'project.json');
  const outputConfigPath = path.join(packageDirectory, '.vercel', 'output', 'config.json');
  const outputStaticPath = path.join(packageDirectory, '.vercel', 'output', 'static');
  for (const requiredPath of [packageConfigPath, projectLinkPath, outputConfigPath, outputStaticPath]) {
    if (!await pathExists(requiredPath)) throw new Error(`Missing prebuilt input: ${requiredPath}`);
  }
  const sourceConfigBytes = await readFile(configPath, 'utf8');
  const expectedDeploymentConfigBytes = deploymentConfigBytes(sourceConfigBytes);
  const actualDeploymentConfigBytes = await readFile(packageConfigPath, 'utf8');
  if (sha256(actualDeploymentConfigBytes) !== sha256(expectedDeploymentConfigBytes)) {
    throw new Error('The package vercel.json is not the authorized static administrative derivation.');
  }
  const projectLink = JSON.parse(await readFile(projectLinkPath, 'utf8'));
  if (projectLink.projectId !== adminProjectId || projectLink.orgId !== adminOrganizationId) {
    throw new Error('The temporary package is not linked to the authorized lanzo-pos project.');
  }
  for (const generatedPath of [
    path.join(packageDirectory, '.env.local'),
    path.join(packageDirectory, '.gitignore'),
    path.join(packageDirectory, '.vercel', '.env.production.local')
  ]) {
    await rm(generatedPath, { force: true });
  }
  const outputConfig = JSON.parse(await readFile(outputConfigPath, 'utf8'));
  const staticFiles = await walk(outputStaticPath);
  const staticManifest = await buildManifest(staticFiles);
  const configBytes = await readFile(outputConfigPath);
  console.log(JSON.stringify({
    status: 'prebuilt-finalized',
    packageDirectory,
    projectId: projectLink.projectId,
    organizationId: projectLink.orgId,
    sourceConfigPath: configPath,
    sourceConfigSha256: sha256(sourceConfigBytes),
    deploymentConfigPath: packageConfigPath,
    deploymentConfigSha256: sha256(actualDeploymentConfigBytes),
    frameworkOverride: null,
    outputConfigPath,
    outputConfigSha256: sha256(configBytes),
    routes: outputConfig.routes?.length || 0,
    outputStatic: {
      files: staticFiles.length,
      bytes: staticFiles.reduce((total, file) => total + file.bytes, 0),
      treeSha256: sha256(staticManifest.map((item) => `${item.sha256}  ${item.path}`).join('\n'))
    },
    commands: { build: buildCommand, deploy: deployCommand },
    deployCommandExecuted: false,
    protectedRoot: { rootVercelDirectoryPresent: await pathExists(rootVercelDirectory) }
  }, null, 2));
}

async function main() {
  if (process.argv[2] === '--finalize-prebuilt' && process.argv.length === 4) {
    await finalizePrebuilt(process.argv[3]);
    return;
  }
  if (process.argv.length !== 2) {
    throw new Error('Usage: prepare-admin-deployment.mjs [--finalize-prebuilt <temporary-package-root>].');
  }
  if (!await pathExists(distRoot)) throw new Error('dist does not exist. Run npm run build first.');
  if (!await pathExists(configPath)) throw new Error('vercel.json does not exist.');

  const configSource = await readFile(configPath, 'utf8');
  const config = JSON.parse(configSource);
  if (Array.isArray(config.redirects) && config.redirects.length > 0) {
    throw new Error('Administrative redirects are not authorized for CUTOVER.1.');
  }
  if (!config.rewrites?.some((rule) => rule.source === '/(.*)' && rule.destination === '/index.html')) {
    throw new Error('The administrative SPA fallback rewrite is missing.');
  }

  const baselineRootLink = await pathExists(rootVercelDirectory);
  const sourceAudit = await auditFiles(distRoot);
  if (sourceAudit.forbiddenPaths.length > 0 || sourceAudit.secretViolations.length > 0) {
    throw new Error('The administrative dist audit failed.');
  }

  const requiredArtifactPaths = ['index.html', 'manifest.webmanifest', 'sw.js'];
  for (const requiredPath of requiredArtifactPaths) {
    if (!sourceAudit.files.some(({ relativePath }) => relativePath === requiredPath)) {
      throw new Error(`Missing administrative artifact: ${requiredPath}`);
    }
  }
  const serviceWorkerSource = await readFile(path.join(distRoot, 'sw.js'), 'utf8');
  const workboxPresent = sourceAudit.files.some(({ relativePath }) => /^workbox-[^/]*\.js$/i.test(relativePath))
    || /\bworkbox\b/i.test(serviceWorkerSource);
  if (!workboxPresent) {
    throw new Error('Missing administrative Workbox runtime.');
  }
  if (!sourceAudit.files.some(({ relativePath }) => /^assets\/.+\.(?:js|css)$/i.test(relativePath))) {
    throw new Error('Missing administrative assets.');
  }

  let temporaryRoot = '';
  let manifestPath = '';
  try {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), temporaryPrefix));
    const packageDirectory = temporaryRoot;
    await cp(distRoot, packageDirectory, { recursive: true, errorOnExist: true, force: false });
    await writeFile(
      path.join(packageDirectory, 'vercel.json'),
      deploymentConfigBytes(configSource),
      { encoding: 'utf8', flag: 'wx' }
    );

    const packageAudit = await auditFiles(packageDirectory);
    if (packageAudit.forbiddenPaths.length > 0 || packageAudit.secretViolations.length > 0) {
      throw new Error('The administrative deployment package audit failed.');
    }

    const expectedPaths = new Set([
      ...sourceAudit.files.map(({ relativePath }) => relativePath),
      'vercel.json'
    ]);
    const actualPaths = new Set(packageAudit.files.map(({ relativePath }) => relativePath));
    const unexpectedPaths = [...actualPaths].filter((item) => !expectedPaths.has(item));
    const missingPaths = [...expectedPaths].filter((item) => !actualPaths.has(item));
    if (unexpectedPaths.length > 0 || missingPaths.length > 0) {
      throw new Error(`Deployment allowlist mismatch: unexpected=${unexpectedPaths.join(',')} missing=${missingPaths.join(',')}`);
    }

    for (const sourceFile of sourceAudit.files) {
      const copiedPath = path.join(packageDirectory, sourceFile.relativePath);
      if (await fileSha256(sourceFile.absolutePath) !== await fileSha256(copiedPath)) {
        throw new Error(`Copied file changed: ${sourceFile.relativePath}`);
      }
    }

    const manifest = await buildManifest(packageAudit.files);
    const manifestDocument = {
      schemaVersion: 1,
      files: manifest,
      treeSha256: sha256(manifest.map((item) => `${item.sha256}  ${item.path}`).join('\n'))
    };
    manifestPath = `${temporaryRoot}-sha256-manifest.json`;
    await writeFile(manifestPath, `${JSON.stringify(manifestDocument, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    });

    const finalRootLink = await pathExists(rootVercelDirectory);
    if (baselineRootLink !== finalRootLink) throw new Error('The root Vercel link changed during preparation.');

    console.log(JSON.stringify({
      status: 'prepared',
      packageDirectory,
      auditManifestPath: manifestPath,
      deployCommandExecuted: false,
      commands: { build: buildCommand, deploy: deployCommand },
      administrativeArtifact: {
        files: sourceAudit.files.length,
        bytes: sourceAudit.files.reduce((total, file) => total + file.bytes, 0)
      },
      deploymentPackage: {
        files: packageAudit.files.length,
        bytes: packageAudit.files.reduce((total, file) => total + file.bytes, 0),
        treeSha256: manifestDocument.treeSha256,
        forbiddenPaths: packageAudit.forbiddenPaths,
        secretViolations: packageAudit.secretViolations
      },
      administrativeConfiguration: {
        framework: null,
        rewrites: config.rewrites,
        redirects: config.redirects || []
      },
      requiredArtifacts: {
        indexHtml: true,
        manifest: true,
        serviceWorker: true,
        workbox: true,
        assets: true
      },
      protectedRoot: {
        rootVercelDirectoryPresentBefore: baselineRootLink,
        rootVercelDirectoryPresentAfter: finalRootLink
      }
    }, null, 2));
  } catch (error) {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    if (manifestPath) await rm(manifestPath, { force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'failed', error: String(error?.message || error).slice(0, 500) }));
  process.exitCode = 1;
});
