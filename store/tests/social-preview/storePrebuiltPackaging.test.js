import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSanitizedStoreWorkspace,
  prepareStoreDeployment,
  resolveCliCommands,
  run,
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

async function createRepositoryFixture({ withAdministrativeLink = false } = {}) {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-package-protected-source-'));
  await mkdir(path.join(sourceRoot, 'store'), { recursive: true });
  await Promise.all([
    writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture"}'),
    writeFile(path.join(sourceRoot, 'package-lock.json'), '{"lockfileVersion":3}'),
    writeFile(path.join(sourceRoot, 'vercel.json'), '{"project":"administrative"}'),
    writeFile(path.join(sourceRoot, 'store', 'vercel.json'), '{"trailingSlash":false}'),
  ]);
  if (withAdministrativeLink) {
    await mkdir(path.join(sourceRoot, '.vercel'), { recursive: true });
    await writeFile(
      path.join(sourceRoot, '.vercel', 'project.json'),
      '{"projectId":"prj_admin_fixture","orgId":"team_admin_fixture"}\n',
    );
  }
  return sourceRoot;
}

async function expectControlledStopPreservesRepository(sourceRoot) {
  let workspaceRoot;
  await expect(prepareStoreDeployment({
    repositoryRoot: sourceRoot,
    commandRunner(_command, _args, options) {
      workspaceRoot ||= options.cwd;
      throw new Error('controlled local stop');
    },
    vercelCommand: 'vercel-fixture',
  })).rejects.toThrow('controlled local stop');
  expect(await exists(workspaceRoot)).toBe(false);
}

describe('workspace prebuilt saneado', () => {
  it('selecciona npm.cmd para Windows', () => {
    expect(resolveCliCommands({ platform: 'win32' }).npmCommand).toBe('npm.cmd');
  });

  it('selecciona vercel.cmd para Windows', () => {
    expect(resolveCliCommands({ platform: 'win32' }).vercelCommand).toBe('vercel.cmd');
  });

  it.each(['linux', 'darwin'])('selecciona npm para %s', (platform) => {
    expect(resolveCliCommands({ platform }).npmCommand).toBe('npm');
  });

  it.each(['linux', 'darwin'])('selecciona vercel para %s', (platform) => {
    expect(resolveCliCommands({ platform }).vercelCommand).toBe('vercel');
  });

  it('NPM_CLI_PATH sobrescribe el ejecutable npm', () => {
    expect(resolveCliCommands({
      platform: 'win32',
      environment: { NPM_CLI_PATH: 'C:\\tools\\npm-custom.cmd' },
    }).npmCommand).toBe('C:\\tools\\npm-custom.cmd');
  });

  it('VERCEL_CLI_PATH sobrescribe el ejecutable Vercel', () => {
    expect(resolveCliCommands({
      platform: 'linux',
      environment: { VERCEL_CLI_PATH: '/opt/vercel-custom' },
    }).vercelCommand).toBe('/opt/vercel-custom');
  });

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
      commandRunner(_command, args, options) {
        workspaceRoot ||= args[0] === 'ci' ? options.cwd : path.dirname(options.cwd);
        if (args[0] !== 'ci') throw new Error('controlled Vercel failure');
        expect(args).toContain('ci');
      },
      vercelCommand: 'vercel-fixture',
    })).rejects.toThrow('controlled Vercel failure');
    expect(await exists(workspaceRoot)).toBe(false);
    expect(await exists(`${workspaceRoot}-output-sha256.json`)).toBe(false);
  });

  it('inyecta ambos ejecutables y conserva los argumentos como arrays', async () => {
    const sourceRoot = await createRepositoryFixture();
    const calls = [];
    await expect(prepareStoreDeployment({
      repositoryRoot: sourceRoot,
      npmCommand: 'npm-fixture',
      vercelCommand: 'vercel-fixture',
      commandRunner(command, args) {
        calls.push({ command, args });
        if (command === 'vercel-fixture') throw new Error('controlled Vercel stop');
      },
    })).rejects.toThrow('controlled Vercel stop');
    expect(calls).toEqual([
      {
        command: 'npm-fixture',
        args: ['ci', '--no-audit', '--no-fund'],
      },
      {
        command: 'vercel-fixture',
        args: ['build', '--prod', '--yes', '--local-config', './vercel.json'],
      },
    ]);
    expect(calls.every(({ args }) => Array.isArray(args))).toBe(true);
  });

  it('reporta ENOENT sin rutas, limpia el workspace y preserva el repositorio', async () => {
    const sourceRoot = await createRepositoryFixture({ withAdministrativeLink: true });
    const administrativeConfig = path.join(sourceRoot, 'vercel.json');
    const storeConfig = path.join(sourceRoot, 'store', 'vercel.json');
    const projectLink = path.join(sourceRoot, '.vercel', 'project.json');
    const before = await Promise.all([
      readFile(administrativeConfig, 'utf8'),
      readFile(storeConfig, 'utf8'),
      readFile(projectLink, 'utf8'),
    ]);
    const missingExecutable = path.join(sourceRoot, 'private-tools', 'npm.cmd');
    let workspaceRoot;
    let failure;
    try {
      await prepareStoreDeployment({
        repositoryRoot: sourceRoot,
        npmCommand: missingExecutable,
        vercelCommand: 'vercel-fixture',
        commandRunner(command, args, options) {
          workspaceRoot ||= options.cwd;
          return run(command, args, options);
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('Required executable not found: npm.cmd');
    expect(failure.message).toContain('status: null');
    expect(failure.message).not.toContain(sourceRoot);
    expect(await exists(workspaceRoot)).toBe(false);
    expect(await Promise.all([
      readFile(administrativeConfig, 'utf8'),
      readFile(storeConfig, 'utf8'),
      readFile(projectLink, 'utf8'),
    ])).toEqual(before);
  });

  it('preserva un enlace administrativo .vercel preexistente', async () => {
    const sourceRoot = await createRepositoryFixture({ withAdministrativeLink: true });
    const projectLink = path.join(sourceRoot, '.vercel', 'project.json');
    const before = await readFile(projectLink, 'utf8');
    await expectControlledStopPreservesRepository(sourceRoot);
    expect(await readFile(projectLink, 'utf8')).toBe(before);
  });

  it('no crea .vercel administrativo cuando no existía', async () => {
    const sourceRoot = await createRepositoryFixture();
    await expectControlledStopPreservesRepository(sourceRoot);
    expect(await exists(path.join(sourceRoot, '.vercel'))).toBe(false);
  });

  it.each([
    ['modificación de projectId', true, (root) => writeFileSync(
      path.join(root, '.vercel', 'project.json'),
      '{"projectId":"prj_mutated","orgId":"team_admin_fixture"}\n',
    )],
    ['modificación de orgId', true, (root) => writeFileSync(
      path.join(root, '.vercel', 'project.json'),
      '{"projectId":"prj_admin_fixture","orgId":"team_mutated"}\n',
    )],
    ['creación de .vercel', false, (root) => {
      mkdirSync(path.join(root, '.vercel'), { recursive: true });
      writeFileSync(
        path.join(root, '.vercel', 'project.json'),
        '{"projectId":"prj_created","orgId":"team_created"}\n',
      );
    }],
    ['creación de .env.local', true, (root) => writeFileSync(
      path.join(root, '.env.local'),
      'FIXTURE_ONLY=value\n',
    )],
    ['modificación de vercel.json', true, (root) => writeFileSync(
      path.join(root, 'vercel.json'),
      '{"project":"mutated"}',
    )],
    ['modificación de store/vercel.json', true, (root) => writeFileSync(
      path.join(root, 'store', 'vercel.json'),
      '{"trailingSlash":true}',
    )],
    ['eliminación del enlace administrativo', true, (root) => rmSync(
      path.join(root, '.vercel', 'project.json'),
    )],
    ['creación de .vercel/.env.production.local', true, (root) => writeFileSync(
      path.join(root, '.vercel', '.env.production.local'),
      'FIXTURE_ONLY=value\n',
    )],
  ])('rechaza %s y limpia el workspace', async (_label, withLink, mutate) => {
    const sourceRoot = await createRepositoryFixture({
      withAdministrativeLink: withLink,
    });
    let workspaceRoot;
    await expect(prepareStoreDeployment({
      repositoryRoot: sourceRoot,
      commandRunner(_command, _args, options) {
        workspaceRoot ||= options.cwd;
        mutate(sourceRoot);
        throw new Error('controlled command failure');
      },
      vercelCommand: 'vercel-fixture',
    })).rejects.toThrow('Repository protected state changed');
    expect(await exists(workspaceRoot)).toBe(false);
  });

  it('no contiene comandos de deploy', async () => {
    const source = await readFile(
      new URL('../../../scripts/prepare-store-deployment.mjs', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/vercel\s+(?:deploy|promote|alias)/u);
    expect(source).toContain("['build', '--prod', '--yes'");
    expect(source).not.toContain('shell: true');
    expect(source).not.toMatch(/cmd\.exe|\/c(?:\s|['"])/iu);
  });
});
