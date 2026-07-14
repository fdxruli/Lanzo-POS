// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
let preparation;
let temporaryRoot = '';

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
    else if (entry.isFile()) files.push(path.relative(root, absolutePath).replaceAll('\\', '/'));
  }
  return files;
}

beforeAll(() => {
  const result = spawnSync(process.execPath, ['scripts/prepare-admin-deployment.mjs'], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  preparation = JSON.parse(result.stdout);
  temporaryRoot = preparation.packageDirectory;
});

afterAll(async () => {
  if (!temporaryRoot) return;
  const resolvedTemp = path.resolve(os.tmpdir());
  const resolvedTarget = path.resolve(temporaryRoot);
  if (
    path.dirname(resolvedTarget) !== resolvedTemp
    || !path.basename(resolvedTarget).startsWith('lanzo-pos-cutover-1-1-')
  ) {
    throw new Error(`Refusing to remove unexpected path: ${resolvedTarget}`);
  }
  await rm(resolvedTarget, { recursive: true, force: true });
  await rm(preparation.auditManifestPath, { force: true });
});

describe('isolated administrative deployment package', () => {
  it('prepares without deploying', () => {
    expect(preparation.status).toBe('prepared');
    expect(preparation.deployCommandExecuted).toBe(false);
  });

  it('contains every required administrative artifact', () => {
    expect(preparation.requiredArtifacts).toEqual({
      indexHtml: true,
      manifest: true,
      serviceWorker: true,
      workbox: true,
      assets: true
    });
  });

  it('preserves the administrative SPA rewrite without redirects', () => {
    expect(preparation.administrativeConfiguration.framework).toBeNull();
    expect(preparation.administrativeConfiguration.redirects).toEqual([]);
    expect(preparation.administrativeConfiguration.rewrites)
      .toContainEqual({ source: '/(.*)', destination: '/index.html' });
  });

  it('contains no forbidden path or secret', () => {
    expect(preparation.deploymentPackage.forbiddenPaths).toEqual([]);
    expect(preparation.deploymentPackage.secretViolations).toEqual([]);
  });

  it('publishes only dist plus administrative Vercel configuration', async () => {
    const files = await walk(preparation.packageDirectory);
    expect(files).toContain('index.html');
    expect(files).toContain('manifest.webmanifest');
    expect(files).toContain('sw.js');
    expect(files).toContain('vercel.json');
    expect(files.some((file) => /(^|\/)(?:src|tests|docs|supabase|node_modules)(\/|$)/.test(file)))
      .toBe(false);
    expect(files).not.toContain('package.json');
    expect(files).not.toContain('package-lock.json');
  });

  it('does not create root Vercel or Git metadata', async () => {
    expect(preparation.protectedRoot.rootVercelDirectoryPresentBefore).toBe(false);
    expect(preparation.protectedRoot.rootVercelDirectoryPresentAfter).toBe(false);
    expect(await pathExists(path.join(projectRoot, '.vercel'))).toBe(false);
    expect(await pathExists(path.join(projectRoot, '.git'))).toBe(false);
  });
});
