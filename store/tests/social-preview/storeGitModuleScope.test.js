// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

const readJson = async (relativePath) => JSON.parse(await readFile(
  path.join(projectRoot, relativePath),
  'utf8',
));

const readSource = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');

describe('lanzo-store Git deployment module scope', () => {
  it('declares ESM at the effective Vercel project root', async () => {
    const [rootPackage, storePackage, vercelConfig] = await Promise.all([
      readJson('package.json'),
      readJson('store/package.json'),
      readJson('store/vercel.json'),
    ]);

    expect(rootPackage.type).toBe('module');
    expect(storePackage).toEqual({
      name: 'lanzo-store-runtime',
      private: true,
      type: 'module',
    });
    expect(vercelConfig.installCommand).toBe('cd .. && npm ci');
    expect(vercelConfig.buildCommand).toBe('cd .. && npm run build:store:vercel');
    expect(vercelConfig.outputDirectory).toBe('dist');
  });

  it.each([
    'store/api/store-page.js',
    'store/api/og/store.js',
  ])('keeps %s as an ESM source handler', async (relativePath) => {
    const source = await readSource(relativePath);

    expect(source).toMatch(/\bimport\s/u);
    expect(source).toMatch(/\bexport\s+default\b/u);
    expect(source).not.toMatch(/\bmodule\.exports\b|\bexports\s*\./u);
  });
});
