// @vitest-environment node
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditStoreArtifact,
  compareArtifactManifests
} from '../../../scripts/build-store-vercel.mjs';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('ECOM.PUBLIC.GIT.1 architecture', () => {
  let config;
  let packageJson;
  let builderSource;
  const temporaryRoots = [];

  beforeAll(async () => {
    config = JSON.parse(await readProjectFile('store/vercel.json'));
    packageJson = JSON.parse(await readProjectFile('package.json'));
    builderSource = await readProjectFile('scripts/build-store-vercel.mjs');
  });

  afterAll(async () => {
    await Promise.all(temporaryRoots.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function copyStagingFixture() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lanzo-store-git-test-'));
    temporaryRoots.push(directory);
    await cp(path.join(projectRoot, 'store', 'dist'), directory, { recursive: true });
    return directory;
  }

  it('uses store/vercel.json as the only public Vercel configuration', async () => {
    expect(await exists(path.join(projectRoot, 'store', 'vercel.json'))).toBe(true);
    expect(await exists(path.join(projectRoot, 'vercel.store.json'))).toBe(false);
    expect(config).not.toEqual(JSON.parse(await readProjectFile('vercel.json')));
  });

  it('declares the Git build from the store root with shared parent sources', () => {
    expect(config.framework).toBeNull();
    expect(config.installCommand).toBe('cd .. && npm ci');
    expect(config.buildCommand).toBe('cd .. && npm run build:store:vercel');
    expect(config.outputDirectory).toBe('dist');
    expect(packageJson.scripts['build:store:vercel']).toBe('node scripts/build-store-vercel.mjs');
  });

  it('preserves ordered public routes, noindex and cache policy', () => {
    expect(config).not.toHaveProperty('rewrites');
    expect(config).not.toHaveProperty('headers');
    expect(config).not.toHaveProperty('trailingSlash');
    expect(config.routes[0]).toMatchObject({
      src: '^/(.*)/$',
      status: 308,
      headers: {
        Location: '/$1',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
    expect(config.routes[1]).toEqual({
      src: '^/(.*)$',
      headers: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
      continue: true,
    });

    const filesystem = config.routes.findIndex((route) => route.handle === 'filesystem');
    const root = config.routes.findIndex((route) => route.src === '^/$' && route.dest === '/home.html');
    const tracking = config.routes.findIndex(
      (route) => route.src === '^/tienda/([^/]+)/pedido/([^/]+)$',
    );
    const dynamicStore = config.routes.findIndex((route) => route.src === '^/tienda/([^/]+)$');
    const fallback = config.routes.findIndex(
      (route) => route.dest === '/index.html' && route.src.includes('(?!(?:api|assets)'),
    );

    expect(root).toBeLessThan(filesystem);
    expect(tracking).toBeGreaterThan(filesystem);
    expect(dynamicStore).toBeGreaterThan(tracking);
    expect(fallback).toBeGreaterThan(dynamicStore);
    expect(config.routes[dynamicStore].dest).toBe('/api/store-page?slug=$1');
    expect(config.routes[tracking].dest).toBe('/index.html');
  });

  it('keeps the SPA fallback constrained behind filesystem and public special routes', () => {
    const serialized = JSON.stringify(config);
    expect(serialized).not.toMatch(/Cross-Origin-Opener-Policy|same-origin-allow-popups/i);
    expect(serialized).not.toMatch(/serviceWorker|manifest\.webmanifest/i);
    const filesystem = config.routes.findIndex((route) => route.handle === 'filesystem');
    const fallback = config.routes.findIndex(
      (route) => route.dest === '/index.html' && route.src.includes('(?!(?:api|assets)'),
    );
    expect(fallback).toBeGreaterThan(filesystem);
    expect(config.routes[fallback].src).toContain('(?:api|assets)');
    expect(config.routes[fallback].src).toContain('package');
    expect(config.routes.some(({ dest }) => /lanzo-pos/iu.test(dest || ''))).toBe(false);
    expect(config).not.toHaveProperty('redirects');
  });

  it('keeps the administrative project build and PWA configuration independent', async () => {
    const [adminConfig, viteConfig] = await Promise.all([
      readProjectFile('vercel.json'),
      readProjectFile('vite.config.js')
    ]);
    const fallback = JSON.parse(adminConfig).rewrites
      .find(({ destination }) => destination === '/index.html');
    expect(fallback?.source).toContain('(?!assets/');
    expect(fallback?.source).toContain('sw\\.js$');
    expect(fallback?.source).toContain('workbox-');
    expect(packageJson.scripts.build).toBe('vite build');
    expect(viteConfig).toMatch(/VitePWA|vite-plugin-pwa/);
    expect(viteConfig).not.toMatch(/dist-store|store[\\/]dist/);
  });

  it('has no third Vercel project config or mixed store config', async () => {
    const rootNames = await readdir(projectRoot);
    expect(rootNames.filter((name) => /^vercel\..*\.json$/i.test(name))).toEqual([]);
    expect(config).not.toHaveProperty('projectId');
    expect(config).not.toHaveProperty('orgId');
    expect(config).not.toHaveProperty('name');
    expect(config).not.toHaveProperty('github');
    expect(await exists(path.join(projectRoot, 'store', 'vercel.prebuilt.json'))).toBe(false);
  });

  it('stages an audited real artifact with robots.txt', async () => {
    const audit = await auditStoreArtifact(path.join(projectRoot, 'store', 'dist'), { requireRobots: true });
    expect(audit.passed).toBe(true);
    expect(audit.violations).toEqual([]);
    expect(await readProjectFile('store/dist/robots.txt')).toBe('User-agent: *\nDisallow: /\n');
  });

  it('fails when administrative code is injected into the real artifact', async () => {
    const fixture = await copyStagingFixture();
    await writeFile(path.join(fixture, 'assets', 'App-ABC123.js'), 'const page = "PosPage Dashboard CajaPage";');
    const audit = await auditStoreArtifact(fixture, { requireRobots: true });
    expect(audit.passed).toBe(false);
    expect(audit.violations.join('\n')).toMatch(/administrative|adminShell|App-ABC123/);
  });

  it('fails when robots.txt is missing', async () => {
    const fixture = await copyStagingFixture();
    await rm(path.join(fixture, 'robots.txt'));
    const audit = await auditStoreArtifact(fixture, { requireRobots: true });
    expect(audit.passed).toBe(false);
    expect(audit.violations).toContain('missing:robots.txt');
  });

  it('fails when a private secret is injected', async () => {
    const fixture = await copyStagingFixture();
    await writeFile(path.join(fixture, 'assets', 'secret-ABC123.js'), 'const SUPABASE_SERVICE_ROLE = "forbidden";');
    const audit = await auditStoreArtifact(fixture, { requireRobots: true });
    expect(audit.passed).toBe(false);
    expect(audit.violations.join('\n')).toMatch(/privateToken/);
  });

  it('never invokes deployment tooling', () => {
    expect(builderSource).not.toMatch(/vercel\s+(?:deploy|build)|--prebuilt|--prod|promote\s/i);
    expect(builderSource).not.toMatch(/GitHub Actions/i);
  });

  it('keeps dist-store and store/dist byte-identical except robots.txt', async () => {
    const source = await auditStoreArtifact(path.join(projectRoot, 'dist-store'));
    const staging = await auditStoreArtifact(path.join(projectRoot, 'store', 'dist'), { requireRobots: true });
    expect(() => compareArtifactManifests(source.manifest, staging.manifest)).not.toThrow();
    expect(staging.files).toBe(source.files + 1);
  });

  it('ignores all generated and Vercel-local artifacts', async () => {
    const gitignore = await readProjectFile('.gitignore');
    for (const entry of [
      'dist/',
      'dist-store/',
      'store/dist/',
      'store/generated/storeHtmlTemplate.js',
      '.vercel/',
      'node_modules/'
    ]) {
      expect(gitignore).toContain(entry);
    }
  });
});
