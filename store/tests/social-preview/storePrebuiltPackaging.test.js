import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSanitizedStoreWorkspace,
  prepareStoreDeployment,
  shouldCopyStoreWorkspacePath,
} from '../../../scripts/prepare-store-deployment.mjs';

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('workspace prebuilt saneado', () => {
  it.each([
    ['package.json', true],
    ['package-lock.json', true],
    ['vite.store.config.js', true],
    ['store/api/store-page.js', true],
    ['src/main-store.jsx', true],
    ['.git/config', false],
    ['.env', false],
    ['store/.env.local', false],
    ['.vercel/project.json', false],
    ['node_modules/react/index.js', false],
    ['store/dist/index.html', false],
    ['store/tests/social-preview/a.test.js', false],
    ['supabase/migrations/a.sql', false],
    ['docs/report.md', false],
  ])('clasifica %s sin ampliar la copia: %s', (relativePath, expected) => {
    expect(shouldCopyStoreWorkspacePath(relativePath)).toBe(expected);
  });

  it('copia package/lock, funciones y fuente pública sin estado local', async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-package-source-'));
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-package-target-'));
    await Promise.all([
      mkdir(path.join(sourceRoot, 'store', 'api'), { recursive: true }),
      mkdir(path.join(sourceRoot, 'src'), { recursive: true }),
      mkdir(path.join(sourceRoot, '.git'), { recursive: true }),
      mkdir(path.join(sourceRoot, 'node_modules'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture"}'),
      writeFile(path.join(sourceRoot, 'package-lock.json'), '{"lockfileVersion":3}'),
      writeFile(path.join(sourceRoot, 'vite.store.config.js'), 'export default {}'),
      writeFile(path.join(sourceRoot, 'store', 'api', 'store-page.js'), 'export default {}'),
      writeFile(path.join(sourceRoot, 'src', 'main-store.jsx'), 'export {}'),
      writeFile(path.join(sourceRoot, '.env'), 'SECRET=value'),
      writeFile(path.join(sourceRoot, '.git', 'config'), 'private'),
      writeFile(path.join(sourceRoot, 'node_modules', 'fixture.js'), 'private'),
    ]);
    await createSanitizedStoreWorkspace({ sourceRoot, temporaryRoot: targetRoot });
    expect(await readFile(path.join(targetRoot, 'package.json'), 'utf8')).toContain('fixture');
    expect(await exists(path.join(targetRoot, 'store', 'api', 'store-page.js'))).toBe(true);
    expect(await exists(path.join(targetRoot, '.env'))).toBe(false);
    expect(await exists(path.join(targetRoot, '.git'))).toBe(false);
    expect(await exists(path.join(targetRoot, 'node_modules'))).toBe(false);
  });

  it('limpia workspace y no crea manifiesto si el build falla', async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-package-failure-source-'));
    await mkdir(path.join(sourceRoot, 'store'), { recursive: true });
    await Promise.all([
      writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture"}'),
      writeFile(path.join(sourceRoot, 'package-lock.json'), '{"lockfileVersion":3}'),
      writeFile(path.join(sourceRoot, 'vercel.json'), '{}'),
      writeFile(path.join(sourceRoot, 'store', 'vercel.json'), '{"trailingSlash":false}'),
    ]);
    let workspaceRoot;
    await expect(prepareStoreDeployment({
      repositoryRoot: sourceRoot,
      commandRunner(command, args, options) {
        workspaceRoot ||= command === 'npm' ? options.cwd : path.dirname(options.cwd);
        if (command !== 'npm') throw new Error('controlled Vercel failure');
        expect(args).toContain('ci');
      },
      vercelCommand: 'vercel-fixture',
    })).rejects.toThrow('controlled Vercel failure');
    expect(await exists(workspaceRoot)).toBe(false);
    expect(await exists(`${workspaceRoot}-output-sha256.json`)).toBe(false);
  });

  it('no contiene comandos de deploy', async () => {
    const source = await readFile(
      new URL('../../../scripts/prepare-store-deployment.mjs', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/vercel\s+(?:deploy|promote|alias)/u);
    expect(source).toContain("['build', '--prod', '--yes'");
  });
});
