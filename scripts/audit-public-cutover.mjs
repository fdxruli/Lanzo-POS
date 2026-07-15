/**
 * Read-only audit for ECOM.PUBLIC.CUTOVER.1.
 *
 * Usage:
 *   node scripts/audit-public-cutover.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const normalizePath = (value) => value.replaceAll('\\', '/');

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
    if (entry.isDirectory()) files.push(...await walk(absolutePath, root));
    else if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath: normalizePath(path.relative(root, absolutePath))
      });
    }
  }
  return files;
}

const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');

async function readBuild(directoryName) {
  const root = path.join(projectRoot, directoryName);
  if (!await pathExists(root)) throw new Error(`${directoryName} no existe.`);
  const files = await walk(root);
  const textFiles = files.filter(({ relativePath }) => /\.(?:css|html|js|json|svg|txt|webmanifest)$/i.test(relativePath));
  const sources = await Promise.all(textFiles.map(async (file) => ({
    ...file,
    source: await readFile(file.absolutePath, 'utf8')
  })));
  return { files, sources };
}

const findFiles = (sources, pattern) => sources
  .filter(({ source }) => pattern.test(source))
  .map(({ relativePath }) => relativePath);

async function main() {
  if (process.argv.length !== 2) throw new Error('Este auditor no acepta opciones.');

  const [origins, portalSettings, confirmation, landing, main, mainStore, pwaPolicy] = await Promise.all([
    readProjectFile('src/config/publicOrigins.js'),
    readProjectFile('src/components/ecommerce/EcommercePortalSettings.jsx'),
    readProjectFile('src/components/ecommerce/public/PublicOrderConfirmation.jsx'),
    readProjectFile('src/pages/PublicLanzoLandingPage.jsx'),
    readProjectFile('src/main.jsx'),
    readProjectFile('src/main-store.jsx'),
    readProjectFile('src/pwa/publicNavigationPolicy.js')
  ]);
  const [adminConfig, storeConfig, adminBuild, publicBuild] = await Promise.all([
    readProjectFile('vercel.json').then(JSON.parse),
    readProjectFile('store/vercel.json').then(JSON.parse),
    readBuild('dist'),
    readBuild('dist-store')
  ]);

  const checks = {
    centralAdminDefault: origins.includes("'https://lanzo-pos.vercel.app'"),
    centralPublicDefault: origins.includes("'https://lanzo-store.vercel.app'"),
    adminOverride: origins.includes('VITE_ADMIN_APP_ORIGIN'),
    publicOverride: origins.includes('VITE_PUBLIC_STORE_ORIGIN'),
    secureUrlParser: origins.includes('new URL('),
    encodedSegments: origins.includes('encodeURIComponent'),
    adminStoreBuilder: portalSettings.includes('buildPublicStoreUrl(portal.slug)'),
    noWindowOriginStoreBuilder: !portalSettings.includes('window.location.origin}/tienda'),
    adminShareBuilder: portalSettings.includes('navigator.share'),
    adminQrBuilder: portalSettings.includes('<PublicStoreQrCode value={reservedLink}'),
    checkoutTrackingBuilder: confirmation.includes('buildPublicTrackingUrl(slug, trackingToken)'),
    checkoutWhatsappBuilder: confirmation.includes('appendPublicTrackingToWhatsappUrl'),
    administrativeWelcomeBuilder: landing.includes('buildAdminWelcomeUrl()'),
    noBrokenRelativeWelcome: !landing.includes('href="/?welcome=1"'),
    legacyRouterPreserved: main.includes('if (isPublicStorePath(window.location.pathname))'),
    standaloneRouterPreserved: mainStore.includes("from './router/publicStoreRoutes'"),
    pwaStoreDenylistPreserved: pwaPolicy.includes('/^\\/tienda'),
    pwaLandingDenylistPreserved: pwaPolicy.includes('/^\\/conoce-lanzo'),
    noAdministrativeRedirects: !Array.isArray(adminConfig.redirects) || adminConfig.redirects.length === 0,
    administrativeFallbackPreserved: adminConfig.rewrites?.some((rule) => (
      rule.source === '/(.*)' && rule.destination === '/index.html'
    )) === true,
    storeTrailingSlashFalse: storeConfig.trailingSlash === false,
    storeNoindexPreserved: storeConfig.headers?.some((rule) => rule.headers?.some((header) => (
      header.key === 'X-Robots-Tag' && header.value === 'noindex, nofollow, noarchive'
    ))) === true,
    adminBuildContainsPublicOrigin: findFiles(adminBuild.sources, /lanzo-store\.vercel\.app/).length > 0,
    publicBuildContainsPublicOrigin: findFiles(publicBuild.sources, /lanzo-store\.vercel\.app/).length > 0,
    publicBuildContainsAdminCtaOrigin: findFiles(publicBuild.sources, /lanzo-pos\.vercel\.app/).length > 0,
    adminManifestPresent: adminBuild.files.some(({ relativePath }) => relativePath === 'manifest.webmanifest'),
    adminServiceWorkerPresent: adminBuild.files.some(({ relativePath }) => relativePath === 'sw.js'),
    publicManifestAbsent: !publicBuild.files.some(({ relativePath }) => /manifest/i.test(relativePath)),
    publicServiceWorkerAbsent: !publicBuild.files.some(({ relativePath }) => /(^|\/)sw\.js$|service-worker/i.test(relativePath)),
    publicWorkboxAbsent: !publicBuild.files.some(({ relativePath }) => /workbox/i.test(relativePath)),
    publicSourceMapsAbsent: !publicBuild.files.some(({ relativePath }) => /\.map$/i.test(relativePath))
  };

  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const report = {
    phase: 'ECOM.PUBLIC.CUTOVER.1',
    status: failedChecks.length === 0 ? 'PASS' : 'FAIL',
    checks,
    failedChecks,
    builds: {
      adminFiles: adminBuild.files.length,
      publicFiles: publicBuild.files.length,
      adminPublicOriginFiles: findFiles(adminBuild.sources, /lanzo-store\.vercel\.app/),
      publicOriginFiles: findFiles(publicBuild.sources, /lanzo-store\.vercel\.app/),
      publicAdminCtaOriginFiles: findFiles(publicBuild.sources, /lanzo-pos\.vercel\.app/)
    }
  };
  console.log(JSON.stringify(report, null, 2));
  if (failedChecks.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    phase: 'ECOM.PUBLIC.CUTOVER.1',
    status: 'FAIL',
    error: String(error?.message || error).slice(0, 500)
  }));
  process.exitCode = 1;
});
