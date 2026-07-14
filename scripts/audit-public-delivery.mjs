/**
 * Read-only delivery audit for the administrative or standalone public build.
 *
 * Usage:
 *   node scripts/audit-public-delivery.mjs
 *   node scripts/audit-public-delivery.mjs dist-store
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const requestedTarget = process.argv[2] || 'dist';
const distRoot = path.resolve(projectRoot, requestedTarget);
const publicTarget = path.basename(distRoot).toLowerCase() === 'dist-store';

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

const normalizePath = (absolutePath) => path.relative(distRoot, absolutePath).replaceAll('\\', '/');
const sumBytes = (items) => items.reduce((total, item) => total + item.bytes, 0);
const extractAttribute = (tag, attribute) => (
  tag.match(new RegExp(`${attribute}=["']([^"']+)["']`, 'i'))?.[1] || null
);
const extractLinks = (html, relation) => Array.from(html.matchAll(/<link\b[^>]*>/gi), ([tag]) => tag)
  .filter((tag) => extractAttribute(tag, 'rel')?.toLowerCase() === relation)
  .map((tag) => extractAttribute(tag, 'href'))
  .filter(Boolean);

const absoluteFiles = await walk(distRoot);
const files = await Promise.all(absoluteFiles.map(async (absolutePath) => ({
  absolutePath,
  path: normalizePath(absolutePath),
  bytes: (await stat(absolutePath)).size,
  extension: path.extname(absolutePath).toLowerCase()
})));

const indexPath = path.join(distRoot, 'index.html');
const indexHtml = await readFile(indexPath, 'utf8');
const moduleTags = Array.from(indexHtml.matchAll(/<script\b[^>]*type=["']module["'][^>]*>/gi), ([tag]) => tag);
const moduleEntry = moduleTags.map((tag) => extractAttribute(tag, 'src')).find(Boolean)?.replace(/^\//, '') || null;
const modulePreloads = extractLinks(indexHtml, 'modulepreload').map((value) => value.replace(/^\//, ''));
const stylesheets = extractLinks(indexHtml, 'stylesheet').map((value) => value.replace(/^\//, ''));
const manifestLinks = extractLinks(indexHtml, 'manifest');
const fileByPath = new Map(files.map((file) => [file.path, file]));
const javascriptFiles = files.filter((file) => file.extension === '.js');
const cssFiles = files.filter((file) => file.extension === '.css');
const entryFile = moduleEntry ? fileByPath.get(moduleEntry) || null : null;

const textExtensions = new Set(['.css', '.html', '.js', '.json', '.svg', '.webmanifest']);
const searchableFiles = files.filter((file) => textExtensions.has(file.extension));
const searchableSources = await Promise.all(searchableFiles.map(async (file) => ({
  file,
  source: await readFile(file.absolutePath, 'utf8')
})));

const normalizeLocalAssetReference = (value) => {
  if (!value || /^(?:data:|blob:|https?:|#|mailto:|tel:)/i.test(value)) return null;
  try {
    const parsed = new URL(value, 'http://127.0.0.1');
    return decodeURIComponent(parsed.pathname).replace(/^\//, '');
  } catch {
    return null;
  }
};
const htmlAssetReferences = [
  ...Array.from(indexHtml.matchAll(/<(?:script|img|source)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi), (match) => match[1]),
  ...Array.from(indexHtml.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi), (match) => match[1])
];
const cssAssetReferences = searchableSources
  .filter(({ file }) => file.extension === '.css')
  .flatMap(({ source }) => Array.from(source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi), (match) => match[1]));
const localAssetReferences = [...new Set([...htmlAssetReferences, ...cssAssetReferences]
  .map(normalizeLocalAssetReference)
  .filter(Boolean))];
const missingLocalAssets = localAssetReferences.filter((reference) => !fileByPath.has(reference));

const findContent = (pattern) => searchableSources
  .filter(({ source }) => pattern.test(source))
  .map(({ file }) => file.path);

const namedChecks = Object.freeze({
  app: /(^|\/)App-[^/]*\.js$/i,
  pos: /PosPage/i,
  caja: /Caja/i,
  dashboard: /Dashboard/i,
  settings: /Settings/i,
  assistantBot: /AssistantBot/i,
  scannerModal: /ScannerModal/i,
  charts: /vendor_charts/i,
  workers: /(?:^|\/)(?:backup|bot|stats)\.worker|worker.*(?:pos|cash|inventory)/i
});
const namedAdministrativeChunks = Object.fromEntries(
  Object.entries(namedChecks).map(([name, pattern]) => [
    name,
    javascriptFiles.filter((file) => pattern.test(file.path)).map((file) => file.path)
  ])
);

const contractChecks = Object.freeze({
  createFreeTrialLicense: /create_free_trial_license/,
  deviceSecurityToken: /device_security_token/,
  staffSessionToken: /staff_session_token/,
  releaseDeviceAnon: /release_device_anon/,
  lanzoDb: /LanzoDB/,
  assistantBot: /AssistantBot/,
  processSale: /processSale/,
  cashSync: /cashSync/,
  posSync: /posSync/,
  googleDrive: /googleDrive/
});
const administrativeContent = Object.fromEntries(
  Object.entries(contractChecks).map(([name, pattern]) => [name, findContent(pattern)])
);

const serviceWorkerFiles = files
  .filter((file) => /(^|\/)(?:sw|service-worker)\.js$/i.test(file.path))
  .map((file) => file.path);
const workboxFiles = files.filter((file) => /(^|\/)workbox-[^/]*\.js$/i.test(file.path)).map((file) => file.path);
const registerSwFiles = files.filter((file) => /(^|\/)registerSW(?:-[^/]*)?\.js$/i.test(file.path)).map((file) => file.path);
const manifestFiles = files.filter((file) => /(^|\/)manifest\.webmanifest$/i.test(file.path)).map((file) => file.path);
const virtualPwaRegisterContent = findContent(/virtual:pwa-register/);
const directServiceWorkerRegistrationContent = findContent(/serviceWorker\.register|registerSW\.js/);

let precacheUrls = [];
const serviceWorkerSource = serviceWorkerFiles.length > 0
  ? await readFile(path.join(distRoot, serviceWorkerFiles[0]), 'utf8')
  : '';
if (serviceWorkerSource) {
  precacheUrls = Array.from(
    serviceWorkerSource.matchAll(/[,{](?:url|"url"):"([^"]+)"/g),
    (match) => match[1],
  );
}
const uniquePrecacheUrls = [...new Set(precacheUrls)];
const precachedFiles = uniquePrecacheUrls.map((url) => fileByPath.get(url)).filter(Boolean);

const primaryPublicDependencies = {
  reactRouter: javascriptFiles.filter((file) => /vendor_react_public/i.test(file.path)).map((file) => file.path),
  supabase: javascriptFiles.filter((file) => /vendor_supabase_public/i.test(file.path)).map((file) => file.path),
  dexieAndBig: javascriptFiles.filter((file) => /vendor_store_public/i.test(file.path)).map((file) => file.path),
  icons: javascriptFiles.filter((file) => /vendor_icons_public/i.test(file.path)).map((file) => file.path)
};

const violations = [];
if (publicTarget) {
  if (manifestLinks.length > 0 || manifestFiles.length > 0) violations.push('manifest');
  if (serviceWorkerFiles.length > 0) violations.push('service-worker');
  if (workboxFiles.length > 0) violations.push('workbox');
  if (registerSwFiles.length > 0) violations.push('register-sw');
  if (virtualPwaRegisterContent.length > 0) violations.push('virtual-pwa-register');
  for (const [name, matches] of Object.entries(namedAdministrativeChunks)) {
    if (matches.length > 0) violations.push(`administrative-chunk:${name}`);
  }
  for (const [name, matches] of Object.entries(administrativeContent)) {
    if (matches.length > 0) violations.push(`administrative-contract:${name}`);
  }
  for (const reference of missingLocalAssets) violations.push(`missing-local-asset:${reference}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  target: {
    requested: requestedTarget,
    directory: distRoot,
    standalonePublicBuild: publicTarget
  },
  dist: {
    files: files.length,
    bytes: sumBytes(files),
    javascriptFiles: javascriptFiles.length,
    javascriptBytes: sumBytes(javascriptFiles),
    cssFiles: cssFiles.length,
    cssBytes: sumBytes(cssFiles),
    largestFiles: [...files]
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, 15)
      .map(({ path: filePath, bytes, extension }) => ({ path: filePath, bytes, extension }))
  },
  htmlEntry: {
    moduleEntry,
    moduleEntryBytes: entryFile?.bytes || null,
    modulePreloads,
    stylesheets,
    manifestLinks,
    directServiceWorkerRegistrationContent
  },
  pwa: {
    manifestFiles,
    serviceWorkerFiles,
    workboxFiles,
    registerSwFiles,
    virtualPwaRegisterContent
  },
  administrativeAudit: {
    namedChunks: namedAdministrativeChunks,
    contentContracts: administrativeContent
  },
  primaryPublicDependencies,
  assetAudit: {
    localReferences: localAssetReferences,
    missingLocalAssets
  },
  precache: {
    declaredEntries: precacheUrls.length,
    uniqueUrls: uniquePrecacheUrls.length,
    matchedLocalFiles: precachedFiles.length,
    matchedLocalBytes: sumBytes(precachedFiles),
    javascriptFiles: precachedFiles.filter((file) => file.extension === '.js').length,
    javascriptBytes: sumBytes(precachedFiles.filter((file) => file.extension === '.js')),
    cssFiles: precachedFiles.filter((file) => file.extension === '.css').length,
    cssBytes: sumBytes(precachedFiles.filter((file) => file.extension === '.css'))
  },
  compliance: {
    passed: violations.length === 0,
    violations
  }
};

console.log(JSON.stringify(report, null, 2));
if (publicTarget && violations.length > 0) process.exitCode = 1;
