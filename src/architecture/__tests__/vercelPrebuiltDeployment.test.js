import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');

const files = await Promise.all([
  readProjectFile('scripts/prepare-store-deployment.mjs'),
  readProjectFile('scripts/prepare-admin-deployment.mjs'),
  readProjectFile('scripts/audit-vercel-build-output.mjs'),
  readProjectFile('store/vercel.json'),
  readProjectFile('vercel.json'),
  readProjectFile('package.json')
]);
const [storePrepare, adminPrepare, outputAudit, storeConfigSource, adminConfigSource, packageSource] = files;
const storeConfig = JSON.parse(storeConfigSource);
const adminConfig = JSON.parse(adminConfigSource);
const packageJson = JSON.parse(packageSource);

describe('CUTOVER.1.1 prebuilt deployment architecture', () => {
  it('places the store vercel.json directly in the real package root', () => {
    expect(storePrepare).toContain("const packageDirectory = temporaryRoot");
    expect(storePrepare).toContain("path.join(packageDirectory, 'vercel.json')");
  });

  it('defines the expected cwd as the exact temporary store root', () => {
    expect(storePrepare).toContain("path.dirname(resolved) !== temporaryDirectory");
    expect(storePrepare).toContain("lanzo-store-cutover-1-1-");
  });

  it('requires the temporary store link to use the authorized project', () => {
    expect(storePrepare).toContain('prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4');
    expect(storePrepare).toContain('projectLink.projectId !== storeProjectId');
  });

  it('verifies the consumed store config by SHA-256', () => {
    expect(storePrepare).toContain('fileSha256(packageConfigPath) !== await fileSha256(storeConfigPath)');
    expect(outputAudit).toContain('sourceConfigMatches');
  });

  it('requires a real Vercel production build with explicit local config', () => {
    expect(storePrepare).toContain('vercel build --prod --yes --local-config ./vercel.json');
    expect(adminPrepare).toContain('vercel build --prod --yes --local-config ./vercel.json');
  });

  it('fails the output audit when transformed routes are absent', () => {
    expect(outputAudit).toContain('routesPresent: routes.length > 1');
    expect(outputAudit).toContain("outputConfig.routes");
  });

  it('requires transformed X-Robots-Tag coverage', () => {
    expect(outputAudit).toContain("globalNoindex");
    expect(outputAudit).toContain("X-Robots-Tag");
    expect(outputAudit).toContain('noindex, nofollow, noarchive');
  });

  it('requires immutable cache for hashed public assets', () => {
    expect(outputAudit).toContain('public, max-age=31536000, immutable');
    expect(outputAudit).toContain('immutableAssets');
  });

  it('keeps sensitive paths outside the public SPA fallback', () => {
    expect(outputAudit).toContain('sensitivePaths404');
    expect(outputAudit).toContain("'/.env'");
    expect(outputAudit).toContain("'/package.json'");
    expect(outputAudit).toContain('filesystemBeforeSpa');
  });

  it('preserves trailingSlash false and noindex on its 308 route', () => {
    expect(storeConfig.trailingSlash).toBe(false);
    expect(storePrepare).toContain("canonicalRoute.headers['X-Robots-Tag'] = noindexHeader");
    expect(outputAudit).toContain('trailingSlashFalse');
  });

  it('rejects Functions and Middleware in prebuilt output', () => {
    expect(outputAudit).toContain('noFunctions: !outputConfig.functions');
    expect(outputAudit).toContain('noMiddleware: !outputConfig.middleware');
  });

  it('rejects redirects from the public deployment to the POS', () => {
    expect(outputAudit).toContain("noPosRedirect");
    expect(outputAudit).toContain("lanzo-pos.vercel.app");
  });

  it('compares every output/static application file to dist-store', () => {
    expect(outputAudit).toContain('artifactMatches');
    expect(outputAudit).toContain("sourceDist: path.join(projectRoot, 'dist-store')");
    expect(outputAudit).toContain("...(targetName === 'store' ? ['robots.txt'] : [])");
  });

  it('allows deployment only through a prebuilt production command', () => {
    expect(storePrepare).toContain('vercel deploy --prebuilt --prod --yes');
    expect(adminPrepare).toContain('vercel deploy --prebuilt --prod --yes');
    expect(packageJson.scripts['audit:vercel-output']).toBe('node scripts/audit-vercel-build-output.mjs');
  });

  it('does not allow finalization from an incorrect parent directory', () => {
    expect(storePrepare).toContain('assertTemporaryPackageRoot');
    expect(storePrepare).toContain('path.dirname(resolved) !== temporaryDirectory');
    expect(storePrepare).not.toContain("path.join(temporaryRoot, 'public')");
  });

  it('uses an independent root for the administrative package', () => {
    expect(adminPrepare).toContain("lanzo-pos-cutover-1-1-");
    expect(adminPrepare).toContain('const packageDirectory = temporaryRoot');
    expect(adminPrepare).toContain('framework: null');
    expect(outputAudit).toContain('authorizedFrameworkOverride');
    expect(adminPrepare).not.toContain('lanzo-store-cutover-1-1-');
  });

  it('requires the transformed administrative SPA rewrite', () => {
    expect(adminConfig.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' });
    expect(outputAudit).toContain('adminSpaFallback');
  });

  it('requires the administrative PWA in output/static', () => {
    expect(outputAudit).toContain('adminPwaPresent');
    expect(outputAudit).toContain("paths.includes('manifest.webmanifest')");
    expect(outputAudit).toContain("paths.includes('sw.js')");
  });

  it('keeps the temporary project IDs from crossing', () => {
    expect(storePrepare).toContain('prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4');
    expect(storePrepare).not.toContain('prj_tE5uWn6kLBYdS1eDFWVxRm449RUr');
    expect(adminPrepare).toContain('prj_tE5uWn6kLBYdS1eDFWVxRm449RUr');
    expect(adminPrepare).not.toContain('prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4');
  });

  it('guards against creating a Vercel link in the repository root', () => {
    expect(storePrepare).toContain("const rootVercelDirectory = path.join(projectRoot, '.vercel')");
    expect(adminPrepare).toContain("const rootVercelDirectory = path.join(projectRoot, '.vercel')");
    expect(outputAudit).toContain('rootVercelUntouched');
  });
});
