/**
 * Prepares, but never deploys, the standalone public storefront artifact.
 *
 * Usage:
 *   node scripts/prepare-store-deployment.mjs
 *
 * The deployable directory is created below the system temporary directory.
 * Its SHA-256 audit manifest is stored beside, never inside, that directory.
 */
import { spawnSync } from 'node:child_process';
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
const distRoot = path.join(projectRoot, 'dist-store');
const storeConfigPath = path.join(projectRoot, 'vercel.store.json');
const administrativeConfigPath = path.join(projectRoot, 'vercel.json');
const rootVercelDirectory = path.join(projectRoot, '.vercel');
const robotsText = 'User-agent: *\nDisallow: /\n';
const noindexHeader = 'noindex, nofollow, noarchive';
const storeProjectId = 'prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4';
const storeOrganizationId = 'team_buvft2mAJErTNR8gDhXcZGfS';
const temporaryPrefix = 'lanzo-store-cutover-1-1-';
const buildCommand = 'vercel build --prod --yes --local-config ./vercel.json';
const deployCommand = 'vercel deploy --prebuilt --prod --yes';

const forbiddenPathPatterns = Object.freeze([
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)\.git(?:\/|$)/i,
  /(^|\/)\.vercel(?:\/|$)/i,
  /(^|\/)node_modules(?:\/|$)/i,
  /(^|\/)(?:src|scripts|tests|docs|supabase)(?:\/|$)/i,
  /(^|\/)package(?:-lock)?\.json$/i,
  /(^|\/)vite(?:\.store)?\.config\.[^/]+$/i,
  /(^|\/)(?:sw|service-worker)\.js$/i,
  /(^|\/)registerSW(?:-[^/]*)?\.js$/i,
  /(^|\/)workbox-[^/]*\.js$/i,
  /(^|\/)manifest\.webmanifest$/i,
  /\.map$/i
]);

const forbiddenSecretPatterns = Object.freeze({
  serviceRoleMarker: /service_role|SUPABASE_SERVICE_ROLE/i,
  vercelTokenMarker: /VERCEL_TOKEN|\b(?:vcp|vercel)_[A-Za-z0-9_-]{20,}\b/i,
  githubTokenMarker: /GITHUB_TOKEN|\bgh[pousr]_[A-Za-z0-9]{20,}\b/i,
  privateKey: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i,
  stripeSecret: /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b/i,
  supabaseSecretKey: /\bsb_(?:secret|service_role)_[A-Za-z0-9_-]+\b/i,
  googleCredential: /\bAIza[0-9A-Za-z_-]{25,}\b|client_secret\s*[=:]\s*["'][^"']+["']/i
});

const administrativePatterns = Object.freeze({
  administrativeChunk: /(^|\/)(?:App|PosPage|Caja|Dashboard|Settings|AssistantBot|ScannerModal|vendor_charts)[^/]*\.(?:js|css)$/i,
  createFreeTrialLicense: /create_free_trial_license/,
  deviceSecurityToken: /device_security_token/,
  staffSessionToken: /staff_session_token/,
  releaseDeviceAnon: /release_device_anon/,
  lanzoDb: /LanzoDB/,
  processSale: /processSale/,
  cashSync: /cashSync/,
  posSync: /posSync/,
  googleDrive: /googleDrive/
});

const pwaContentPatterns = Object.freeze({
  pwaRegister: /virtual:pwa-register|serviceWorker\.register|registerSW\.js/i,
  workbox: /\bworkbox\b|__WB_MANIFEST/i,
  manifest: /manifest\.webmanifest/i
});

const textExtensions = new Set(['.css', '.html', '.js', '.json', '.svg', '.txt']);
const normalizePath = (value) => value.replaceAll('\\', '/');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fileSha256 = async (filePath) => sha256(await readFile(filePath));

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

function inspectTextSources(sources) {
  const secretViolations = [];
  const administrativeViolations = [];
  const pwaViolations = [];
  const genericCredentialVocabulary = {};
  const supabaseHostnames = new Set();
  let publishableCredentialPresent = false;
  let persistSessionFalse = false;

  for (const { relativePath, source } of sources) {
    for (const [name, pattern] of Object.entries(forbiddenSecretPatterns)) {
      if (pattern.test(source)) secretViolations.push(`${name}:${relativePath}`);
    }
    for (const candidate of source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
      const role = decodeJwtRole(candidate);
      if (role === 'service_role') secretViolations.push(`serviceRoleJwt:${relativePath}`);
      if (role === 'anon') publishableCredentialPresent = true;
    }
    if (/\bsb_publishable_[A-Za-z0-9_-]+\b/.test(source)) publishableCredentialPresent = true;
    if (/persistSession\s*:\s*(?:false|!1)\b/.test(source)) persistSessionFalse = true;

    for (const match of source.matchAll(/https:\/\/[A-Za-z0-9.-]+\.supabase\.co\b/gi)) {
      try {
        supabaseHostnames.add(new URL(match[0]).hostname);
      } catch {
        // Invalid URLs cannot contribute a public hostname.
      }
    }
    for (const [name, pattern] of Object.entries(administrativePatterns)) {
      if (name !== 'administrativeChunk' && pattern.test(source)) {
        administrativeViolations.push(`${name}:${relativePath}`);
      }
    }
    for (const [name, pattern] of Object.entries(pwaContentPatterns)) {
      if (pattern.test(source)) pwaViolations.push(`${name}:${relativePath}`);
    }
    for (const marker of ['password', 'secret', 'refresh_token', 'access_token']) {
      if (new RegExp(marker, 'i').test(source)) {
        genericCredentialVocabulary[marker] ||= [];
        genericCredentialVocabulary[marker].push(relativePath);
      }
    }
  }

  return {
    administrativeViolations: [...new Set(administrativeViolations)],
    genericCredentialVocabulary,
    persistSessionFalse,
    publishableCredentialPresent,
    pwaViolations: [...new Set(pwaViolations)],
    secretViolations: [...new Set(secretViolations)],
    supabaseHostnames: [...supabaseHostnames].sort()
  };
}

async function auditFiles(root) {
  const files = await walk(root);
  const forbiddenPaths = files
    .filter(({ relativePath }) => forbiddenPathPatterns.some((pattern) => pattern.test(relativePath)))
    .map(({ relativePath }) => relativePath);
  const administrativeChunks = files
    .filter(({ relativePath }) => administrativePatterns.administrativeChunk.test(relativePath))
    .map(({ relativePath }) => relativePath);
  const sources = await Promise.all(files
    .filter(({ relativePath }) => textExtensions.has(path.extname(relativePath).toLowerCase()))
    .map(async (file) => ({ ...file, source: await readFile(file.absolutePath, 'utf8') })));
  const contentAudit = inspectTextSources(sources);
  return {
    ...contentAudit,
    administrativeViolations: [...administrativeChunks, ...contentAudit.administrativeViolations],
    files,
    forbiddenPaths
  };
}

async function runPublicDeliveryAudit() {
  const result = spawnSync(process.execPath, [
    path.join(projectRoot, 'scripts', 'audit-public-delivery.mjs'),
    'dist-store'
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status !== 0) throw new Error('The existing dist-store delivery audit failed.');
  const report = JSON.parse(result.stdout);
  if (!report.compliance?.passed) throw new Error('dist-store did not pass the public delivery contract.');
  return {
    files: report.dist.files,
    bytes: report.dist.bytes,
    compliancePassed: true
  };
}

function assertCleanAudit(audit, label) {
  const violations = [
    ...audit.forbiddenPaths.map((item) => `forbidden-path:${item}`),
    ...audit.secretViolations.map((item) => `secret:${item}`),
    ...audit.pwaViolations.map((item) => `pwa:${item}`),
    ...audit.administrativeViolations.map((item) => `administrative:${item}`)
  ];
  if (!audit.persistSessionFalse) violations.push('public-client:persistSession-false-not-found');
  if (!audit.publishableCredentialPresent) violations.push('public-client:publishable-credential-not-found');
  if (audit.supabaseHostnames.length !== 1) violations.push('public-client:expected-one-supabase-hostname');
  if (violations.length > 0) throw new Error(`${label} audit failed: ${violations.join(', ')}`);
}

async function buildManifest(files) {
  return Promise.all(files.map(async ({ absolutePath, relativePath, bytes }) => ({
    path: relativePath,
    bytes,
    sha256: await fileSha256(absolutePath)
  })));
}

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
  if (await fileSha256(packageConfigPath) !== await fileSha256(storeConfigPath)) {
    throw new Error('The package vercel.json does not match vercel.store.json.');
  }

  const projectLink = JSON.parse(await readFile(projectLinkPath, 'utf8'));
  if (projectLink.projectId !== storeProjectId || projectLink.orgId !== storeOrganizationId) {
    throw new Error('The temporary package is not linked to the authorized lanzo-store project.');
  }

  // Vercel CLI may materialize environment helper files while linking/building.
  // They are removed without reading and never belong to the static output.
  for (const generatedPath of [
    path.join(packageDirectory, '.env.local'),
    path.join(packageDirectory, '.gitignore'),
    path.join(packageDirectory, '.vercel', '.env.production.local')
  ]) {
    await rm(generatedPath, { force: true });
  }

  const outputConfig = JSON.parse(await readFile(outputConfigPath, 'utf8'));
  const canonicalRoute = outputConfig.routes?.find((route) => (
    route.status === 308
    && route.headers?.Location === '/$1'
    && typeof route.src === 'string'
    && route.src.includes('(.*)/$')
  ));
  if (!canonicalRoute) throw new Error('Vercel did not generate the expected trailing-slash canonicalization route.');

  // Vercel places the generated trailing-slash redirect before header routes.
  // Preserve the required noindex contract on that terminal 308 response.
  canonicalRoute.headers['X-Robots-Tag'] = noindexHeader;
  await writeFile(outputConfigPath, `${JSON.stringify(outputConfig, null, 2)}\n`, 'utf8');

  const staticFiles = await walk(outputStaticPath);
  const staticManifest = await buildManifest(staticFiles);
  const configBytes = await readFile(outputConfigPath);
  console.log(JSON.stringify({
    status: 'prebuilt-finalized',
    packageDirectory,
    projectId: projectLink.projectId,
    organizationId: projectLink.orgId,
    sourceConfigPath: packageConfigPath,
    sourceConfigSha256: await fileSha256(packageConfigPath),
    outputConfigPath,
    outputConfigSha256: sha256(configBytes),
    routes: outputConfig.routes.length,
    canonicalNoindexApplied: canonicalRoute.headers['X-Robots-Tag'] === noindexHeader,
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
    throw new Error('Usage: prepare-store-deployment.mjs [--finalize-prebuilt <temporary-package-root>].');
  }
  if (!await pathExists(distRoot)) throw new Error('dist-store does not exist. Run npm run build:store first.');
  if (!await pathExists(storeConfigPath)) throw new Error('vercel.store.json does not exist.');

  let storeConfig;
  try {
    storeConfig = JSON.parse(await readFile(storeConfigPath, 'utf8'));
  } catch {
    throw new Error('vercel.store.json must contain valid JSON.');
  }
  if (storeConfig.trailingSlash !== false) {
    throw new Error('vercel.store.json must define trailingSlash === false before packaging.');
  }

  const baseline = {
    administrativeConfigSha256: await fileSha256(administrativeConfigPath),
    rootVercelDirectoryPresent: await pathExists(rootVercelDirectory)
  };
  const deliveryAudit = await runPublicDeliveryAudit();
  const sourceAudit = await auditFiles(distRoot);
  assertCleanAudit(sourceAudit, 'dist-store');

  let temporaryRoot = '';
  let manifestPath = '';
  try {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), temporaryPrefix));
    const packageDirectory = temporaryRoot;
    await cp(distRoot, packageDirectory, { recursive: true, errorOnExist: true, force: false });
    await cp(storeConfigPath, path.join(packageDirectory, 'vercel.json'), { force: false });
    await writeFile(path.join(packageDirectory, 'robots.txt'), robotsText, { encoding: 'utf8', flag: 'wx' });

    const packageAudit = await auditFiles(packageDirectory);
    assertCleanAudit(packageAudit, 'deployment package');

    const expectedPaths = new Set([
      ...sourceAudit.files.map(({ relativePath }) => relativePath),
      'robots.txt',
      'vercel.json'
    ]);
    const unexpectedPaths = packageAudit.files
      .map(({ relativePath }) => relativePath)
      .filter((relativePath) => !expectedPaths.has(relativePath));
    const missingPaths = [...expectedPaths]
      .filter((relativePath) => !packageAudit.files.some((file) => file.relativePath === relativePath));
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
    manifestPath = `${temporaryRoot}-sha256-manifest.json`;
    const manifestDocument = {
      schemaVersion: 1,
      files: manifest,
      treeSha256: sha256(manifest.map((item) => `${item.sha256}  ${item.path}`).join('\n'))
    };
    await writeFile(manifestPath, `${JSON.stringify(manifestDocument, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });

    const finalState = {
      administrativeConfigSha256: await fileSha256(administrativeConfigPath),
      rootVercelDirectoryPresent: await pathExists(rootVercelDirectory)
    };
    if (JSON.stringify(baseline) !== JSON.stringify(finalState)) {
      throw new Error('The administrative Vercel baseline changed during preparation.');
    }

    const publicBytes = sourceAudit.files.reduce((total, file) => total + file.bytes, 0);
    console.log(JSON.stringify({
      status: 'prepared',
      packageDirectory,
      auditManifestPath: manifestPath,
      deployCommandExecuted: false,
      commands: { build: buildCommand, deploy: deployCommand },
      publicArtifact: {
        files: sourceAudit.files.length,
        bytes: publicBytes,
        treeSha256: sha256((await buildManifest(sourceAudit.files))
          .map((item) => `${item.sha256}  ${item.path}`).join('\n'))
      },
      deploymentPackage: {
        files: packageAudit.files.length,
        bytes: packageAudit.files.reduce((total, file) => total + file.bytes, 0),
        treeSha256: manifestDocument.treeSha256,
        forbiddenPaths: packageAudit.forbiddenPaths,
        secretViolations: packageAudit.secretViolations,
        pwaViolations: packageAudit.pwaViolations,
        administrativeViolations: packageAudit.administrativeViolations
      },
      publicConfiguration: {
        trailingSlash: storeConfig.trailingSlash,
        supabaseHostname: packageAudit.supabaseHostnames[0],
        publishableCredentialPresent: packageAudit.publishableCredentialPresent,
        serviceRolePresent: false,
        persistSessionFalse: packageAudit.persistSessionFalse,
        genericCredentialVocabulary: packageAudit.genericCredentialVocabulary
      },
      deliveryAudit,
      protectedRoot: {
        rootVercelDirectoryPresentBefore: baseline.rootVercelDirectoryPresent,
        rootVercelDirectoryPresentAfter: finalState.rootVercelDirectoryPresent,
        administrativeConfigUnchanged: baseline.administrativeConfigSha256 === finalState.administrativeConfigSha256
      }
    }, null, 2));
  } catch (error) {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    if (manifestPath) await rm(manifestPath, { force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'failed', error: String(error.message || error).slice(0, 500) }));
  process.exitCode = 1;
});
