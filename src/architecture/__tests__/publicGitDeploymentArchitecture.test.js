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

  it('preserves noindex, immutable assets, public rewrites, and no trailing slash', () => {
    expect(config.trailingSlash).toBe(false);
    expect(config.headers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        headers: expect.arrayContaining([
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }
        ])
      }),
      expect.objectContaining({
        source: '/assets/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]
      })
    ]));
    expect(config.rewrites).toEqual([
      { source: '/', destination: '/index.html' },
      { source: '/tienda', destination: '/index.html' },
      { source: '/tienda/:path*', destination: '/index.html' },
      { source: '/conoce-lanzo', destination: '/index.html' }
    ]);
  });

  it('does not copy the administrative COOP, PWA, or broad SPA fallback', () => {
    const serialized = JSON.stringify(config);
    expect(serialized).not.toMatch(/Cross-Origin-Opener-Policy|same-origin-allow-popups/i);
    expect(serialized).not.toMatch(/manifest|serviceWorker|workbox|registerSW/i);
    expect(config.rewrites).not.toContainEqual({ source: '/(.*)', destination: '/index.html' });
  });

  it('keeps the administrative project build and PWA configuration independent', async () => {
    const [adminConfig, viteConfig] = await Promise.all([
      readProjectFile('vercel.json'),
      readProjectFile('vite.config.js')
    ]);
    expect(JSON.parse(adminConfig).rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' });
    expect(packageJson.scripts.build).toBe('vite build');
    expect(viteConfig).toMatch(/VitePWA|vite-plugin-pwa/);
    expect(viteConfig).not.toMatch(/dist-store|store[\\/]dist/);
  });

  it('has no third Vercel project config or mixed store config', async () => {
    const rootNames = await readdir(projectRoot);
    expect(rootNames.filter((name) => /^vercel\..*\.json$/i.test(name))).toEqual([]);
    expect(config).not.toHaveProperty('projectId');
    expect(config).not.toHaveProperty('name');
    expect(config).not.toHaveProperty('github');
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
    for (const entry of ['dist/', 'dist-store/', 'store/dist/', '.vercel/', 'node_modules/']) {
      expect(gitignore).toContain(entry);
    }
  });
});
