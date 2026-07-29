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
  buildNpmExecutionEnvironment,
  buildVercelExecutionEnvironment,
  buildWindowsCmdPayload,
  buildWindowsCommandLine,
  createSanitizedStoreWorkspace,
  getEnvironmentValueCaseInsensitive,
  prependPathEntry,
  prepareStoreDeployment,
  resolveCliCommands,
  resolveNpmCliPath,
  resolveNpmInvocation,
  resolveSpawnInvocation,
  resolveWindowsPathCommand,
  run,
  shouldCopyStoreWorkspacePath,
  setEnvironmentValueCaseInsensitive,
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
  it('aísla únicamente el caché de npm sin mutar el entorno padre', () => {
    const parent = Object.freeze({
      APPDATA: 'C:\\Users\\fixture\\AppData\\Roaming',
      XDG_CONFIG_HOME: 'C:\\Users\\fixture\\config',
      XDG_DATA_HOME: 'C:\\Users\\fixture\\data',
    });
    const result = buildNpmExecutionEnvironment({
      environment: parent,
      temporaryDirectory: 'C:\\Temp\\with spaces',
    });
    expect(result.NPM_CONFIG_CACHE).toBe('C:\\Temp\\with spaces\\lanzo-store-social-preview-npm-cache');
    expect(result.XDG_CACHE_HOME).toBe('C:\\Temp\\with spaces\\lanzo-store-npm-cache');
    expect(result.XDG_CONFIG_HOME).toBe(parent.XDG_CONFIG_HOME);
    expect(result.XDG_DATA_HOME).toBe(parent.XDG_DATA_HOME);
    expect(parent).not.toHaveProperty('NPM_CONFIG_CACHE');
  });

  it('preserva el perfil de Vercel y elimina solo VERCEL_TOKEN del hijo', () => {
    const parent = Object.freeze({
      APPDATA: 'C:\\Users\\fixture\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\fixture\\AppData\\Local',
      HOME: 'C:\\Users\\fixture',
      USERPROFILE: 'C:\\Users\\fixture',
      XDG_CONFIG_HOME: 'C:\\Users\\fixture\\config',
      XDG_DATA_HOME: 'C:\\Users\\fixture\\data',
      VERCEL_TOKEN: 'test-token-value',
    });
    const result = buildVercelExecutionEnvironment({ environment: parent });
    for (const name of ['APPDATA', 'LOCALAPPDATA', 'HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) {
      expect(result[name]).toBe(parent[name]);
    }
    expect(result).not.toHaveProperty('VERCEL_TOKEN');
    expect(parent.VERCEL_TOKEN).toBe('test-token-value');
    expect(JSON.stringify(result)).not.toContain('test-token-value');
  });

  it('normaliza PATH y el procesador de comandos de Windows sin mutar el padre', () => {
    const parent = { Path: 'C:\\tools;C:\\WINDOWS\\System32', PATH: 'C:\\duplicate', SystemRoot: 'C:\\Windows', VERCEL_TOKEN: 'secret' };
    const result = buildVercelExecutionEnvironment({ environment: parent });
    expect(Object.keys(result).filter((key) => key.toLowerCase() === 'path')).toEqual(['PATH']);
    expect(result.PATH).toMatch(/Windows\\System32/iu);
    expect(result.ComSpec).toMatch(/Windows\\System32\\cmd\.exe$/iu);
    expect(result.SystemRoot).toBe('C:\\Windows');
    expect(result.WINDIR).toBe('C:\\Windows');
    expect(result).not.toHaveProperty('VERCEL_TOKEN');
    expect(parent).toHaveProperty('Path');
    expect(getEnvironmentValueCaseInsensitive(result, 'path')).toBe(result.PATH);
    expect(prependPathEntry('C:\\Tools', 'C:\\Tools')).toBe('C:\\Tools');
    expect(setEnvironmentValueCaseInsensitive({ Path: 'x', PATH: 'y' }, 'PATH', 'z')).toEqual({ PATH: 'z' });
  });

  it.runIf(process.platform === 'win32')('ejecuta cmd.exe desde un directorio temporal con el entorno final', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lanzo-cmd-environment-'));
    try {
      const result = run('cmd.exe', ['/d', '/s', '/c', 'echo wrapper-ok'], {
        cwd: directory,
        environment: buildVercelExecutionEnvironment({ environment: process.env }),
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('wrapper-ok');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('invoca npm mediante el Node real y npm_execpath, sin wrapper', () => {
    const invocation = resolveNpmInvocation({
      platform: 'win32',
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
      environment: { npm_execpath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' },
    });
    expect(invocation).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: [
        'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
        'ci',
        '--no-audit',
        '--no-fund',
      ],
      options: { shell: false },
    });
    expect(invocation.args).toEqual(expect.any(Array));
    expect(invocation.command).not.toMatch(/npm(?:\.cmd)?$/iu);
  });

  it.each(['linux', 'darwin'])('usa la misma invocación directa de npm en %s', (platform) => {
    const invocation = resolveNpmInvocation({
      platform,
      nodeExecutable: '/usr/local/bin/node',
      environment: { npm_execpath: '/usr/local/lib/node_modules/npm/bin/npm-cli.js' },
    });
    expect(invocation.command).toBe('/usr/local/bin/node');
    expect(invocation.options).toEqual({ shell: false });
  });

  it.each([
    [{}, 'npm_execpath is not set'],
    [{ npm_execpath: '  ' }, 'npm_execpath is not set'],
  ])('falla de forma segura cuando falta npm_execpath', (environment, message) => {
    expect(() => resolveNpmInvocation({ environment, nodeExecutable: process.execPath }))
      .toThrow(message);
  });

  it('rechaza npm_execpath inexistente sin incluir PATH', async () => {
    const missingNpmCli = path.join(os.tmpdir(), 'lanzo-missing-npm-cli.js');
    const missingNode = path.join(os.tmpdir(), 'lanzo-missing-node', 'node.exe');
    let failure;
    try {
      await resolveNpmCliPath({
        environment: { npm_execpath: missingNpmCli, PATH: 'private-path-value' },
        nodeExecutable: missingNode,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('npm_execpath does not reference a readable file');
    expect(failure.message).not.toContain('private-path-value');
    expect(failure.message).not.toContain(missingNpmCli);
  });

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
    ['npm.cmd', ['ci', '--no-audit', '--no-fund']],
    ['vercel.cmd', ['build', '--prod', '--yes', '--local-config', './vercel.json']],
    ['fixture.bat', ['argumento-inocuo']],
  ])('envuelve %s con cmd.exe y conserva los argumentos', (command, args) => {
    const invocation = resolveSpawnInvocation({
      command,
      args,
      platform: 'win32',
      environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    });
    expect(invocation.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(invocation.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(invocation.args[3]).toBe(`"${[
      `"${command}"`,
      ...args.map((argument) => `"${argument}"`),
    ].join(' ')}"`);
    expect(invocation.options).toMatchObject({
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  });

  it('no activa argumentos verbatim para ejecutables Windows que no son .cmd/.bat', () => {
    expect(resolveSpawnInvocation({
      command: 'node.exe',
      args: ['--version'],
      platform: 'win32',
      environment: {},
    })).toEqual({
      command: 'node.exe',
      args: ['--version'],
      options: { shell: false },
    });
  });

  it('construye por separado la orden interna y el payload completo de npm', () => {
    const args = ['ci', '--no-audit', '--no-fund'];
    const commandLine = buildWindowsCommandLine('npm.cmd', args);
    const payload = buildWindowsCmdPayload('npm.cmd', args);
    expect(commandLine).toBe('"npm.cmd" "ci" "--no-audit" "--no-fund"');
    expect(payload).toBe('""npm.cmd" "ci" "--no-audit" "--no-fund""');
    expect(payload).not.toContain('\\"');
  });

  it('envuelve correctamente una ruta Windows con espacios', () => {
    const args = ['ci', '--no-audit', '--no-fund'];
    expect(buildWindowsCommandLine('C:\\Program Files\\nodejs\\npm.cmd', args))
      .toBe('"C:\\Program Files\\nodejs\\npm.cmd" "ci" "--no-audit" "--no-fund"');
    expect(buildWindowsCmdPayload('C:\\Program Files\\nodejs\\npm.cmd', args))
      .toBe('""C:\\Program Files\\nodejs\\npm.cmd" "ci" "--no-audit" "--no-fund""');
  });

  it('respeta ComSpec y acepta COMSPEC como fallback de entorno', () => {
    expect(resolveSpawnInvocation({
      command: 'npm.cmd',
      args: ['ci'],
      platform: 'win32',
      environment: { ComSpec: 'D:\\Windows\\cmd.exe' },
    }).command).toBe('D:\\Windows\\cmd.exe');
    expect(resolveSpawnInvocation({
      command: 'vercel.cmd',
      args: ['build'],
      platform: 'win32',
      environment: { COMSPEC: 'E:\\Windows\\cmd.exe' },
    }).command).toBe('E:\\Windows\\cmd.exe');
  });

  it('usa el fallback absoluto de cmd.exe cuando ComSpec falta', () => {
    expect(resolveSpawnInvocation({
      command: 'npm.cmd',
      args: ['ci'],
      platform: 'win32',
      environment: {},
    }).command).toBe('C:\\Windows\\System32\\cmd.exe');
  });

  it.each([
    ['npm.cmd\rmalicioso', ['ci']],
    ['npm.cmd\nmalicioso', ['ci']],
    ['npm.cmd', ['ci\rmalicioso']],
    ['npm.cmd', ['ci\nmalicioso']],
  ])('rechaza CR/LF en comando o argumentos Windows', (command, args) => {
    expect(() => buildWindowsCommandLine(command, args)).toThrow();
  });

  it.each(['&', '|', '<', '>', '^', '%', '!', '"'])(
    'rechaza el metacarácter %s en overrides Windows',
    (operator) => {
      expect(() => resolveSpawnInvocation({
        command: `npm.cmd ${operator} comando-malicioso`,
        args: ['ci'],
        platform: 'win32',
        environment: {},
      })).toThrow('Unsafe Windows CLI executable');
    },
  );

  it('escapa comillas en argumentos controlados', () => {
    expect(buildWindowsCommandLine('npm.cmd', ['valor"interno']))
      .toBe('"npm.cmd" "valor""interno"');
  });

  it('diagnostica el comando lógico cuando falla el wrapper', () => {
    expect(() => run('npm.cmd', ['ci', '--no-audit'], {
      platform: 'win32',
      environment: { ComSpec: process.execPath },
    })).toThrow(/^npm\.cmd ci --no-audit failed with exit code/u);
  });

  it.each([
    ['linux', 'npm', ['ci', '--no-audit', '--no-fund']],
    ['linux', 'vercel', ['build', '--prod', '--yes', '--local-config', './vercel.json']],
    ['darwin', 'npm', ['ci', '--no-audit', '--no-fund']],
    ['darwin', 'vercel', ['build', '--prod', '--yes', '--local-config', './vercel.json']],
  ])('ejecuta %s/%s directamente sin cmd.exe', (platform, command, args) => {
    const invocation = resolveSpawnInvocation({
      command,
      args,
      platform,
      environment: {},
    });
    expect(invocation).toEqual({
      command,
      args,
      options: { shell: false },
    });
    expect(invocation.command).not.toMatch(/cmd\.exe/iu);
    expect(invocation.options).not.toHaveProperty('windowsVerbatimArguments');
  });

  it.runIf(process.platform === 'win32')(
    'ejecuta realmente un fixture .cmd, devuelve status 0 y captura stdout',
    async () => {
      const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-cmd-fixture-'));
      const fixtureCommand = path.join(fixtureRoot, 'fixture command.cmd');
      await writeFile(fixtureCommand, '@echo off\r\necho wrapper-ok\r\n', 'utf8');
      try {
        const result = run(fixtureCommand, ['argumento-inocuo'], {
          cwd: fixtureRoot,
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('wrapper-ok');
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === 'win32')(
    'ejecuta realmente node.exe npm-cli.js --version con la entrada heredada',
    () => {
      const invocation = resolveNpmInvocation({
        environment: process.env,
        nodeExecutable: process.execPath,
      });
      const result = run(invocation.command, [invocation.args[0], '--version']);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).not.toBe('');
    },
  );

  it.runIf(process.platform === 'win32')(
    'ejecuta vercel.cmd --version de forma no destructiva cuando está disponible',
    async ({ skip }) => {
      try {
        run('where.exe', ['vercel.cmd']);
      } catch {
        skip();
        return;
      }
      const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-vercel-version-'));
      try {
        const command = await resolveWindowsPathCommand('vercel.cmd', process.env);
        const result = run(command, ['--version'], { cwd: fixtureRoot });
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).not.toBe('');
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === 'win32')(
    'ejecuta npm ci real en un fixture temporal sin node_modules del repositorio',
    async () => {
      const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-npm-ci-'));
      try {
        await Promise.all([
          writeFile(path.join(fixtureRoot, 'package.json'), JSON.stringify({
            name: 'lanzo-npm-ci-fixture', version: '1.0.0', private: true,
          })),
          writeFile(path.join(fixtureRoot, 'package-lock.json'), JSON.stringify({
            name: 'lanzo-npm-ci-fixture', version: '1.0.0', lockfileVersion: 3,
            requires: true, packages: { '': { name: 'lanzo-npm-ci-fixture', version: '1.0.0' } },
          })),
        ]);
        const npmCli = await resolveNpmCliPath({
          environment: process.env,
          nodeExecutable: process.execPath,
        });
        const invocation = resolveNpmInvocation({
          environment: { ...process.env, npm_execpath: npmCli },
          nodeExecutable: process.execPath,
        });
        const result = run(invocation.command, invocation.args, { cwd: fixtureRoot });
        expect(result.status).toBe(0);
        expect(await exists(path.join(fixtureRoot, 'node_modules', 'npm'))).toBe(false);
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ['package.json', true],
    ['package-lock.json', true],
    ['vite.store.config.js', true],
    ['store/api/store-page.js', true],
    ['src/main-store.jsx', true],
    ['.git/config', false],
    ['.env', false],
    ['auth.json', false],
    ['.config/com.vercel.cli/auth.json', false],
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
      npmInvocation: {
        command: 'node-fixture',
        args: ['npm-cli-fixture.js', 'ci', '--no-audit', '--no-fund'],
        options: { shell: false },
      },
      vercelCommand: 'vercel-fixture',
      commandRunner(command, args) {
        calls.push({ command, args });
        if (command === 'vercel-fixture') throw new Error('controlled Vercel stop');
      },
    })).rejects.toThrow('controlled Vercel stop');
    expect(calls).toEqual([
      {
        command: 'node-fixture',
        args: ['npm-cli-fixture.js', 'ci', '--no-audit', '--no-fund'],
      },
      {
        command: 'vercel-fixture',
        args: ['build', '--prod', '--yes', '--local-config', './vercel.json'],
      },
    ]);
    expect(calls.every(({ args }) => Array.isArray(args))).toBe(true);
  });

  it('separa los entornos de npm y Vercel sin propagar auth al workspace', async () => {
    const sourceRoot = await createRepositoryFixture();
    const calls = [];
    const parentEnvironment = {
      APPDATA: 'C:\\Users\\fixture\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\fixture\\AppData\\Local',
      HOME: 'C:\\Users\\fixture',
      USERPROFILE: 'C:\\Users\\fixture',
      XDG_CONFIG_HOME: 'C:\\Users\\fixture\\config',
      XDG_DATA_HOME: 'C:\\Users\\fixture\\data',
      VERCEL_TOKEN: 'test-token-value',
      npm_execpath: process.execPath,
    };
    await expect(prepareStoreDeployment({
      repositoryRoot: sourceRoot,
      environment: parentEnvironment,
      npmInvocation: {
        command: 'node-fixture',
        args: ['npm-cli-fixture.js', 'ci', '--no-audit', '--no-fund'],
        options: { shell: false },
      },
      vercelCommand: 'vercel-fixture',
      commandRunner(command, _args, options) {
        calls.push({ command, environment: options.environment });
        if (command === 'vercel-fixture') throw new Error('controlled Vercel stop');
      },
    })).rejects.toThrow('controlled Vercel stop');
    const [npmCall, vercelCall] = calls;
    expect(npmCall.environment.NPM_CONFIG_CACHE).toContain('lanzo-store-social-preview-npm-cache');
    expect(npmCall.environment.XDG_CACHE_HOME).toContain('lanzo-store-npm-cache');
    expect(vercelCall.environment.XDG_CONFIG_HOME).toBe(parentEnvironment.XDG_CONFIG_HOME);
    expect(vercelCall.environment.XDG_DATA_HOME).toBe(parentEnvironment.XDG_DATA_HOME);
    expect(vercelCall.environment.APPDATA).toBe(parentEnvironment.APPDATA);
    expect(vercelCall.environment).not.toHaveProperty('VERCEL_TOKEN');
    expect(parentEnvironment.VERCEL_TOKEN).toBe('test-token-value');
    expect(JSON.stringify(vercelCall.environment)).not.toContain('test-token-value');
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
        npmInvocation: {
          command: missingExecutable,
          args: ['npm-cli-fixture.js', 'ci', '--no-audit', '--no-fund'],
          options: { shell: false },
        },
        vercelCommand: 'vercel-fixture',
        commandRunner(command, args, options) {
          workspaceRoot ||= options.cwd;
          return run(command, args, { ...options, platform: 'linux' });
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
    expect(source).toContain("args: ['/d', '/s', '/c'");
    expect(source).toContain('shell: false');
    expect(source).toContain('windowsVerbatimArguments: true');
    expect(source).not.toMatch(/exec(?:Sync)?\(/u);
  });
});
