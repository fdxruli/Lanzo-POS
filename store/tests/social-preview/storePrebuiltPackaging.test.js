import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSanitizedGitEnvironment,
  buildNpmExecutionEnvironment,
  buildVercelExecutionEnvironment,
  cleanupPreparedStoreWorkspace,
  createSanitizedStoreWorkspace,
  materializePrebuiltStaticOutput,
  createPrebuiltVercelConfig,
  createGitHeadSnapshot,
  assertPrebuiltVercelConfigParity,
  finalizePassedStoreWorkspace,
  findWorkspaceEnvironmentFiles,
  prepareStoreDeployment as prepareStoreDeploymentProducer,
  resolveRepositoryHead,
  resolveRepositoryIdentity,
  readRepositoryStatus,
  removeGitHeadSnapshot,
  resolveNpmCliPath,
  resolveNpmInvocation,
  resolveNpmScriptInvocation,
  resolveSpawnInvocation,
  resolveVercelInvocation,
  run,
  assertEffectiveVercelProjectRoot,
  assertRepositoryIdentityStable,
  inspectGeneratedFunctionInventory,
  sanitizeVercelDebugLog,
  sanitizeVercelProjectInspection,
  shouldCopyStoreWorkspacePath,
  shouldPreservePassedWorkspace,
  writeProjectLink,
  writeExternalManifest,
  writePrebuiltVercelConfig,
} from '../../../scripts/prepare-store-deployment.mjs';

const fixtureHead = 'a'.repeat(40);
const fixtureTree = 'b'.repeat(40);
const fixtureIdentity = Object.freeze({
  HEAD: fixtureHead,
  treeOid: fixtureTree,
  objectFormat: 'sha1',
});

function identityCommandResult(args, {
  HEAD = fixtureHead,
  treeOid = fixtureTree,
  objectFormat = 'sha1',
  isInsideWorkTree = 'true',
  showToplevel = '/private/repository',
} = {}) {
  const valueByArgument = new Map([
    ['HEAD', HEAD],
    ['HEAD^{tree}', treeOid],
    ['--show-object-format', objectFormat],
    ['--is-inside-work-tree', isInsideWorkTree],
    ['--show-toplevel', showToplevel],
  ]);
  return { status: 0, stdout: `${valueByArgument.get(args[1]) ?? ''}\n` };
}

async function createInjectedSnapshot({ repositoryRoot, temporaryRoot = os.tmpdir() }) {
  const provenanceRoot = await mkdtemp(path.join(temporaryRoot, 'lanzo-store-git-snapshot-'));
  const snapshotRoot = path.join(provenanceRoot, 'snapshot');
  const temporaryIndexPath = path.join(provenanceRoot, 'git-index');
  await mkdir(snapshotRoot);
  await writeFile(temporaryIndexPath, 'fixture-index');
  await cp(repositoryRoot, snapshotRoot, { recursive: true });
  return {
    provenanceRoot,
    snapshotRoot,
    temporaryIndexPath,
    snapshotFromTemporaryIndex: true,
    trackedFilesOnly: true,
  };
}

const prepareStoreDeployment = (options = {}) => prepareStoreDeploymentProducer({
  repositoryStatusReader: async () => ({ clean: true }),
  repositoryIdentityResolver: async () => fixtureIdentity,
  gitSnapshotCreator: createInjectedSnapshot,
  repositoryStabilityChecker: async () => ({
    identity: fixtureIdentity,
    checkoutCleanAfter: true,
    headStable: true,
    treeStable: true,
  }),
  ...options,
});

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readAllFiles(directory) {
  const values = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) values.push(...await readAllFiles(absolutePath));
    else if (entry.isFile()) values.push(await readFile(absolutePath, 'utf8'));
  }
  return values;
}

async function writeGeneratedFunction(functionsRoot, relativeRoute) {
  const bundleRoot = path.join(functionsRoot, `${relativeRoute}.func`);
  const handler = relativeRoute.includes('og/') ? 'store/api/og/store.js' : 'store/api/store-page.js';
  await mkdir(path.join(bundleRoot, path.dirname(handler)), { recursive: true });
  await writeFile(path.join(bundleRoot, handler), 'export default {fetch(){}};');
  if (!relativeRoute.includes('og/')) {
    await mkdir(path.join(bundleRoot, 'store', 'generated'), { recursive: true });
    await writeFile(
      path.join(bundleRoot, 'store', 'generated', 'storeHtmlTemplate.js'),
      'export const STORE_HTML_TEMPLATE="<!doctype html><div id=\\"root\\"></div>";',
    );
  }
  await writeFile(path.join(bundleRoot, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs24.x', handler }));
}

function writeGeneratedFunctionSync(functionsRoot, relativeRoute) {
  const bundleRoot = path.join(functionsRoot, `${relativeRoute}.func`);
  const handler = relativeRoute.includes('og/') ? 'store/api/og/store.js' : 'store/api/store-page.js';
  mkdirSync(path.join(bundleRoot, path.dirname(handler)), { recursive: true });
  writeFileSync(path.join(bundleRoot, handler), 'export default {fetch(){}};');
  if (!relativeRoute.includes('og/')) {
    mkdirSync(path.join(bundleRoot, 'store', 'generated'), { recursive: true });
    writeFileSync(
      path.join(bundleRoot, 'store', 'generated', 'storeHtmlTemplate.js'),
      'export const STORE_HTML_TEMPLATE="<!doctype html><div id=\\"root\\"></div>";',
    );
  }
  writeFileSync(
    path.join(bundleRoot, '.vc-config.json'),
    JSON.stringify({ runtime: 'nodejs24.x', handler }),
  );
}

async function createStaticMaterializationFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lanzo-static-materialization-'));
  const sourceStaticRoot = path.join(root, 'dist');
  const outputStaticRoot = path.join(root, 'output', 'static');
  await mkdir(path.join(sourceStaticRoot, 'assets', 'nested'), { recursive: true });
  await Promise.all([
    writeFile(path.join(sourceStaticRoot, 'index.html'), [
      '<!doctype html><div id="root"></div>',
      '<!-- LANZO_SOCIAL_HEAD_START --><!-- LANZO_SOCIAL_HEAD_END -->',
      '<script src="/assets/index-AbCd1234.js"></script>',
      '<link href="/assets/index-ZyXw9876.css">',
    ].join('')),
    writeFile(path.join(sourceStaticRoot, 'robots.txt'), 'User-agent: *\nDisallow: /\n'),
    writeFile(path.join(sourceStaticRoot, 'assets', 'index-AbCd1234.js'), 'export const store = true;'),
    writeFile(path.join(sourceStaticRoot, 'assets', 'index-ZyXw9876.css'), 'body{color:#123456}'),
    writeFile(path.join(sourceStaticRoot, 'assets', 'nested', 'chunk-QwEr1234.js'), 'export default 1;'),
  ]);
  return { root, sourceStaticRoot, outputStaticRoot };
}

describe('materialización estática prebuilt', () => {
  it('crea output/static con el contenido de dist y conserva la paridad', async () => {
    const fixture = await createStaticMaterializationFixture();
    try {
      const result = await materializePrebuiltStaticOutput(fixture);
      expect(result).toMatchObject({ strategy: 'copied', parity: true, sourceFiles: 5, outputFiles: 5 });
      expect(await readFile(path.join(fixture.outputStaticRoot, 'assets', 'nested', 'chunk-QwEr1234.js'), 'utf8'))
        .toBe('export default 1;');
      expect(await exists(path.join(fixture.outputStaticRoot, 'dist', 'index.html'))).toBe(false);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it('acepta output/static idéntico y llena uno vacío sin sobrescribir diferencias', async () => {
    const identical = await createStaticMaterializationFixture();
    const empty = await createStaticMaterializationFixture();
    const different = await createStaticMaterializationFixture();
    try {
      await materializePrebuiltStaticOutput(identical);
      expect((await materializePrebuiltStaticOutput(identical)).strategy).toBe('verified-existing-output');
      await mkdir(empty.outputStaticRoot, { recursive: true });
      expect((await materializePrebuiltStaticOutput(empty)).strategy).toBe('filled-empty-output');
      await mkdir(different.outputStaticRoot, { recursive: true });
      const differentFile = path.join(different.outputStaticRoot, 'index.html');
      await writeFile(differentFile, 'different bytes');
      await expect(materializePrebuiltStaticOutput(different))
        .rejects.toThrow('Vercel output static differs');
      expect(await readFile(differentFile, 'utf8')).toBe('different bytes');
    } finally {
      for (const fixture of [identical, empty, different]) rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rechaza fuente inexistente o no auditada', async () => {
    const fixture = await createStaticMaterializationFixture();
    try {
      await expect(materializePrebuiltStaticOutput({
        sourceStaticRoot: path.join(fixture.root, 'missing'), outputStaticRoot: fixture.outputStaticRoot,
      })).rejects.toThrow('Public static build input is missing');
      await writeFile(path.join(fixture.sourceStaticRoot, '.env.production'), 'SECRET=value');
      await expect(materializePrebuiltStaticOutput(fixture)).rejects.toThrow('Public static build audit failed');
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it('incluye diagnósticos estructurados y redactados cuando falla la auditoría', async () => {
    const fixture = await createStaticMaterializationFixture();
    const token = 'AbC9_xY7-KlM2_qRs8-TuV4_WxZ6';
    try {
      await writeFile(
        path.join(fixture.sourceStaticRoot, 'assets', 'unsafe-AbCd1234.js'),
        `{ access_token: "${token}" }; const page = CajaPage;`,
      );
      await expect(materializePrebuiltStaticOutput(fixture)).rejects.toThrow(
        `noSecrets[credentialValue:access_token:length=${token.length}:assets/unsafe-AbCd1234.js]`,
      );
      await expect(materializePrebuiltStaticOutput(fixture)).rejects.not.toThrow(token);
      await expect(materializePrebuiltStaticOutput(fixture)).rejects.toThrow(
        'noAdministrativeCode[CajaPage:assets/unsafe-AbCd1234.js]',
      );
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });
});

async function createRepositoryFixture({ withAdministrativeLink = false } = {}) {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-package-protected-source-'));
  await mkdir(path.join(sourceRoot, 'store', 'api', 'og'), { recursive: true });
  await Promise.all([
    writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture"}'),
    writeFile(path.join(sourceRoot, 'package-lock.json'), '{"lockfileVersion":3}'),
    writeFile(path.join(sourceRoot, 'vercel.json'), '{"project":"administrative"}'),
    writeFile(path.join(sourceRoot, 'store', 'vercel.json'), '{"trailingSlash":false}'),
    writeFile(path.join(sourceRoot, 'store', 'api', 'store-page.js'), 'export default { fetch() {} };'),
    writeFile(path.join(sourceRoot, 'store', 'api', 'og', 'store.js'), 'export default { fetch() {} };'),
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
  it('sanea todas las variables Git heredadas sin mutar el entorno padre', () => {
    const parentEnvironment = {
      PATH: '/controlled/bin',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      TMPDIR: '/tmp/controlled',
      GIT_DIR: '/external/.git',
      git_dir: '/external/lowercase.git',
      GIT_WORK_TREE: '/external',
      GIT_COMMON_DIR: '/external/common',
      GIT_OBJECT_DIRECTORY: '/external/objects',
      GIT_ALTERNATE_OBJECT_DIRECTORIES: '/external/alternate',
      GIT_INDEX_FILE: '/external/index',
      GIT_INDEX_VERSION: '4',
      GIT_NAMESPACE: 'external',
      GIT_SHALLOW_FILE: '/external/shallow',
      GIT_GRAFT_FILE: '/external/grafts',
      GIT_REPLACE_REF_BASE: 'refs/external',
      GIT_CONFIG: '/external/config',
      GIT_CONFIG_GLOBAL: '/external/global-config',
      GIT_CONFIG_SYSTEM: '/external/system-config',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.worktree',
      GIT_CONFIG_VALUE_0: '/external',
    };
    const before = structuredClone(parentEnvironment);
    const normal = buildSanitizedGitEnvironment({ environment: parentEnvironment });
    const indexed = buildSanitizedGitEnvironment({
      environment: parentEnvironment,
      temporaryIndexPath: '/controlled/git-index',
    });

    expect(parentEnvironment).toEqual(before);
    expect(normal).toMatchObject({
      PATH: '/controlled/bin',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      TMPDIR: '/tmp/controlled',
      GIT_TERMINAL_PROMPT: '0',
    });
    expect(Object.keys(normal).filter((name) => name.toUpperCase().startsWith('GIT_')))
      .toEqual(['GIT_TERMINAL_PROMPT']);
    expect(Object.keys(indexed).filter((name) => name.toUpperCase().startsWith('GIT_')).sort())
      .toEqual(['GIT_INDEX_FILE', 'GIT_TERMINAL_PROMPT']);
    expect(indexed.GIT_INDEX_FILE).toBe('/controlled/git-index');
  });

  it('resuelve HEAD desde repositoryRoot mediante Git directo y valida el SHA', async () => {
    const calls = [];
    await expect(resolveRepositoryHead({
      repositoryRoot: '/private/repository',
      commandRunner(command, args, options) {
        calls.push({ command, args, options });
        return identityCommandResult(args);
      },
    })).resolves.toBe(fixtureHead);
    expect(calls).toEqual([
      expect.objectContaining({
        command: 'git',
        args: ['rev-parse', 'HEAD'],
        options: expect.objectContaining({ cwd: '/private/repository', shell: false }),
      }),
      expect.objectContaining({ args: ['rev-parse', 'HEAD^{tree}'] }),
      expect.objectContaining({ args: ['rev-parse', '--show-object-format'] }),
      expect.objectContaining({ args: ['rev-parse', '--is-inside-work-tree'] }),
      expect.objectContaining({ args: ['rev-parse', '--show-toplevel'] }),
    ]);
    expect(calls.every(({ options }) => (
      options.environment.GIT_TERMINAL_PROMPT === '0'
      && options.environment.GIT_INDEX_FILE === undefined
    ))).toBe(true);
  });

  it.each([
    ['HEAD ausente', ''],
    ['HEAD corto', 'abc'],
    ['HEAD con mayúsculas', 'A'.repeat(40)],
    ['HEAD con salida adicional', `${fixtureHead}\nsecond-line`],
  ])('rechaza %s', async (_label, stdout) => {
    await expect(resolveRepositoryHead({
      repositoryRoot: '/private/repository',
      commandRunner(_command, args) {
        return identityCommandResult(args, { HEAD: stdout });
      },
    })).rejects.toThrow('invalid repository HEAD');
  });

  it('sanea errores de Git y no expone repositoryRoot', async () => {
    const repositoryRoot = '/private/repository/without-git';
    let error;
    try {
      await resolveRepositoryHead({
        repositoryRoot,
        commandRunner: () => {
          throw new Error(`fatal: not a git repository: ${repositoryRoot}`);
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).toBe('Unable to resolve repository identity with Git.');
    expect(error?.message).not.toContain(repositoryRoot);
  });

  it('bloquea un repositoryRoot real que no contiene .git', async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-not-a-git-checkout-'));
    try {
      await expect(resolveRepositoryHead({ repositoryRoot }))
        .rejects.toThrow('Unable to resolve repository identity with Git.');
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('bloquea el preparador si el resolver inyectado no entrega HEAD', async () => {
    const repositoryRoot = await createRepositoryFixture();
    try {
      await expect(prepareStoreDeploymentProducer({
        repositoryRoot,
        repositoryStatusReader: async () => ({ clean: true }),
        repositoryIdentityResolver: async () => ({ ...fixtureIdentity, HEAD: undefined }),
      })).rejects.toThrow('invalid repository HEAD');
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['cambio staged', 'M\0'],
    ['cambio unstaged', ' M\0'],
    ['archivo no rastreado', '??\0'],
  ])('bloquea el checkout antes de preparar por %s sin revelar rutas', async (_label, stdout) => {
    let error;
    try {
      await readRepositoryStatus({
        repositoryRoot: '/private/repository',
        commandRunner: () => ({ status: 0, stdout }),
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).toBe('Repository checkout must be clean before preparing the artifact.');
    expect(error?.message).not.toContain(stdout);
  });

  it('exige exit code cero al inspeccionar el checkout', async () => {
    let childEnvironment;
    await expect(readRepositoryStatus({
      repositoryRoot: '/private/repository',
      environment: { PATH: '/controlled/bin', GIT_INDEX_FILE: '/redirected/index' },
      commandRunner(_command, _args, options) {
        childEnvironment = options.environment;
        return { status: 1, stdout: '' };
      },
    })).rejects.toThrow('Unable to inspect repository checkout with Git.');
    expect(childEnvironment).toEqual({
      PATH: '/controlled/bin',
      GIT_TERMINAL_PROMPT: '0',
    });
  });

  it('bloquea un work tree falso o un show-toplevel distinto sin exponer rutas', async () => {
    const requestedRoot = '/private/repository';
    const externalRoot = '/private/external-repository';
    await expect(resolveRepositoryIdentity({
      repositoryRoot: requestedRoot,
      commandRunner(_command, args) {
        return identityCommandResult(args, { isInsideWorkTree: 'false' });
      },
    })).rejects.toThrow('not inside a Git work tree');

    let mismatchError;
    try {
      await resolveRepositoryIdentity({
        repositoryRoot: requestedRoot,
        commandRunner(_command, args) {
          return identityCommandResult(args, { showToplevel: externalRoot });
        },
      });
    } catch (error) {
      mismatchError = error;
    }
    expect(mismatchError?.message)
      .toBe('Git repository root does not match the requested repositoryRoot.');
    expect(mismatchError?.message).not.toContain(requestedRoot);
    expect(mismatchError?.message).not.toContain(externalRoot);
  });

  it('el flujo principal bloquea un checkout dirty antes de crear snapshot o workspace', async () => {
    let snapshotCreated = false;
    await expect(prepareStoreDeploymentProducer({
      repositoryRoot: '/private/repository',
      repositoryStatusReader: async () => {
        throw new Error('Repository checkout must be clean before preparing the artifact.');
      },
      gitSnapshotCreator: async () => {
        snapshotCreated = true;
      },
    })).rejects.toThrow('Repository checkout must be clean');
    expect(snapshotCreated).toBe(false);
  });

  it.each([
    ['tree OID inválido', { HEAD: fixtureHead, tree: 'c'.repeat(64), format: 'sha1' }, 'tree OID'],
    ['object format desconocido', { HEAD: fixtureHead, tree: fixtureTree, format: 'md5' }, 'object format'],
  ])('rechaza identidad Git inválida: %s', async (_label, fixture, message) => {
    await expect(resolveRepositoryIdentity({
      repositoryRoot: '/private/repository',
      commandRunner(_command, args) {
        return identityCommandResult(args, {
          HEAD: fixture.HEAD,
          treeOid: fixture.tree,
          objectFormat: fixture.format,
        });
      },
    })).rejects.toThrow(message);
  });

  it('aísla un repositorio externo y materializa bytes exactos del HEAD con índice temporal', async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo git fixture with spaces-'));
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo external git fixture-'));
    let snapshot;
    const identityCalls = [];
    const snapshotCalls = [];
    try {
      const fixtureGitEnvironment = buildSanitizedGitEnvironment();
      run('git', ['init'], { cwd: repositoryRoot, environment: fixtureGitEnvironment });
      run('git', ['init'], { cwd: externalRoot, environment: fixtureGitEnvironment });
      await Promise.all([
        writeFile(path.join(repositoryRoot, 'tracked.txt'), 'version-committed'),
        writeFile(path.join(repositoryRoot, '.gitignore'), 'ignored.txt\n'),
        writeFile(path.join(externalRoot, 'external-only.txt'), 'version-external'),
      ]);
      run('git', ['add', '.gitignore', 'tracked.txt'], {
        cwd: repositoryRoot,
        environment: fixtureGitEnvironment,
      });
      run('git', ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture',
        'commit', '-m', 'fixture A'], { cwd: repositoryRoot, environment: fixtureGitEnvironment });
      run('git', ['add', 'external-only.txt'], {
        cwd: externalRoot,
        environment: fixtureGitEnvironment,
      });
      run('git', ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture',
        'commit', '-m', 'fixture B'], { cwd: externalRoot, environment: fixtureGitEnvironment });
      const repositoryHead = run('git', ['rev-parse', 'HEAD'], {
        cwd: repositoryRoot,
        environment: fixtureGitEnvironment,
      }).stdout.trim();
      const externalHead = run('git', ['rev-parse', 'HEAD'], {
        cwd: externalRoot,
        environment: fixtureGitEnvironment,
      }).stdout.trim();
      const contaminatedEnvironment = {
        ...process.env,
        GIT_DIR: path.join(externalRoot, '.git'),
        GIT_WORK_TREE: externalRoot,
        GIT_INDEX_FILE: path.join(externalRoot, 'redirected-index'),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.worktree',
        GIT_CONFIG_VALUE_0: externalRoot,
      };
      const identity = await resolveRepositoryIdentity({
        repositoryRoot,
        environment: contaminatedEnvironment,
        commandRunner(command, args, options) {
          identityCalls.push({ command, args: [...args], options });
          return run(command, args, options);
        },
      });
      expect(identity.HEAD).toBe(repositoryHead);
      expect(identity.HEAD).not.toBe(externalHead);
      await Promise.all([
        writeFile(path.join(repositoryRoot, 'tracked.txt'), 'version-working-tree'),
        writeFile(path.join(repositoryRoot, 'untracked.txt'), 'untracked'),
        writeFile(path.join(repositoryRoot, 'ignored.txt'), 'ignored'),
      ]);
      snapshot = await createGitHeadSnapshot({
        repositoryRoot,
        identity,
        environment: contaminatedEnvironment,
        commandRunner(command, args, options) {
          snapshotCalls.push({ command, args: [...args], options });
          return run(command, args, options);
        },
      });
      expect(await readFile(path.join(snapshot.snapshotRoot, 'tracked.txt'), 'utf8'))
        .toBe('version-committed');
      expect(await exists(path.join(snapshot.snapshotRoot, 'untracked.txt'))).toBe(false);
      expect(await exists(path.join(snapshot.snapshotRoot, 'ignored.txt'))).toBe(false);
      expect(await exists(path.join(snapshot.snapshotRoot, 'external-only.txt'))).toBe(false);
      expect(snapshotCalls.map(({ args }) => args)).toEqual([
        ['read-tree', identity.HEAD],
        ['checkout-index', '--all', '--force', expect.stringMatching(/^--prefix=.+\/$/u)],
      ]);
      expect(identityCalls).toHaveLength(5);
      expect(identityCalls.every(({ options }) => (
        options.environment.GIT_TERMINAL_PROMPT === '0'
        && options.environment.GIT_INDEX_FILE === undefined
        && options.environment.GIT_DIR === undefined
        && options.environment.GIT_WORK_TREE === undefined
        && options.environment.GIT_CONFIG_COUNT === undefined
      ))).toBe(true);
      expect(snapshotCalls.every(({ options }) => (
        options.shell === false
        && options.cwd === repositoryRoot
        && options.environment.GIT_INDEX_FILE === snapshot.temporaryIndexPath
        && options.environment.GIT_TERMINAL_PROMPT === '0'
        && options.environment.GIT_DIR === undefined
        && options.environment.GIT_WORK_TREE === undefined
        && options.environment.GIT_CONFIG_COUNT === undefined
      ))).toBe(true);
      expect(process.env.GIT_INDEX_FILE).not.toBe(snapshot.temporaryIndexPath);
      expect(snapshotCalls.every(({ options }) => options.cwd.includes('lanzo git fixture'))).toBe(true);
      expect(snapshot.prefix).not.toContain('\\');
      expect(snapshot.prefix.endsWith('/')).toBe(true);
      const cleanup = await removeGitHeadSnapshot({ ...snapshot, repositoryRoot });
      snapshot = null;
      expect(cleanup).toEqual({ snapshotRemoved: true, temporaryIndexRemoved: true });
    } finally {
      if (snapshot) {
        await removeGitHeadSnapshot({ ...snapshot, repositoryRoot });
      }
      rmSync(repositoryRoot, { recursive: true, force: true });
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it('limpia snapshot e índice cuando read-tree o checkout-index fallan', async () => {
    for (const failingCommand of ['read-tree', 'checkout-index']) {
      let provenanceRoot;
      await expect(createGitHeadSnapshot({
        repositoryRoot: '/private/repository',
        identity: fixtureIdentity,
        makeTemporaryDirectory: async (prefix) => {
          provenanceRoot = await mkdtemp(prefix);
          return provenanceRoot;
        },
        commandRunner(_command, args) {
          if (args[0] === failingCommand) throw new Error('private failure');
          return { status: 0, stdout: '' };
        },
      })).rejects.toThrow(failingCommand === 'read-tree'
        ? 'temporary Git index'
        : 'temporary Git index');
      expect(await exists(provenanceRoot)).toBe(false);
    }
  });

  it('rechaza un snapshot fuera de temp y elimina symlinks inseguros', async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-snapshot-path-guard-'));
    try {
      await expect(createGitHeadSnapshot({
        repositoryRoot,
        identity: fixtureIdentity,
        makeTemporaryDirectory: async () => repositoryRoot,
      })).rejects.toThrow('temporary resources could not be removed');

      if (process.platform !== 'win32') {
        let provenanceRoot;
        await expect(createGitHeadSnapshot({
          repositoryRoot,
          identity: fixtureIdentity,
          makeTemporaryDirectory: async (prefix) => {
            provenanceRoot = await mkdtemp(prefix);
            return provenanceRoot;
          },
          async commandRunner(_command, args) {
            if (args[0] === 'checkout-index') {
              const prefix = args.find((arg) => arg.startsWith('--prefix=')).slice('--prefix='.length);
              await symlink(repositoryRoot, path.join(prefix, 'unsafe-link'));
            }
            return { status: 0, stdout: '' };
          },
        })).rejects.toThrow('Symbolic link forbidden');
        expect(await exists(provenanceRoot)).toBe(false);
      }
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('bloquea limpieza incompleta del snapshot y cambios finales de HEAD, tree o checkout', async () => {
    const provenanceRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-store-git-snapshot-'));
    const snapshotRoot = path.join(provenanceRoot, 'snapshot');
    const temporaryIndexPath = path.join(provenanceRoot, 'git-index');
    await mkdir(snapshotRoot);
    await writeFile(temporaryIndexPath, 'index');
    try {
      await expect(removeGitHeadSnapshot({
        provenanceRoot,
        snapshotRoot,
        temporaryIndexPath,
        repositoryRoot: '/private/repository',
        removePath: async () => {},
      })).rejects.toThrow('could not be removed completely');
    } finally {
      rmSync(provenanceRoot, { recursive: true, force: true });
    }

    await expect(assertRepositoryIdentityStable({
      initialIdentity: fixtureIdentity,
      identityResolver: async () => ({ ...fixtureIdentity, HEAD: 'c'.repeat(40) }),
      statusReader: async () => ({ clean: true }),
    })).rejects.toThrow('HEAD changed');
    await expect(assertRepositoryIdentityStable({
      initialIdentity: fixtureIdentity,
      identityResolver: async () => ({ ...fixtureIdentity, treeOid: 'c'.repeat(40) }),
      statusReader: async () => ({ clean: true }),
    })).rejects.toThrow('tree changed');
    await expect(assertRepositoryIdentityStable({
      initialIdentity: fixtureIdentity,
      identityResolver: async () => fixtureIdentity,
      statusReader: async () => {
        throw new Error('Repository checkout must be clean before preparing the artifact.');
      },
    })).rejects.toThrow('checkout changed');
  });

  it('limpia snapshot, índice y workspace cuando falla la copia saneada', async () => {
    const repositoryRoot = await createRepositoryFixture();
    let snapshot;
    let workspaceRoot;
    try {
      await expect(prepareStoreDeployment({
        repositoryRoot,
        gitSnapshotCreator: async (options) => {
          snapshot = await createInjectedSnapshot(options);
          return snapshot;
        },
        sanitizedWorkspaceCreator: async ({ temporaryRoot }) => {
          workspaceRoot = temporaryRoot;
          throw new Error('controlled sanitized copy failure');
        },
      })).rejects.toThrow('controlled sanitized copy failure');
      expect(await exists(snapshot.provenanceRoot)).toBe(false);
      expect(await exists(snapshot.snapshotRoot)).toBe(false);
      expect(await exists(snapshot.temporaryIndexPath)).toBe(false);
      expect(await exists(workspaceRoot)).toBe(false);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('mantiene el preparador libre de shells y comandos Git mutantes', async () => {
    const source = await readFile(
      new URL('../../../scripts/prepare-store-deployment.mjs', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(
      /shell\s*:\s*true|cmd\.exe|npm\.cmd|powershell|(?:^|[^\w])bash(?:[^\w]|$)|git reset|git clean|git checkout \.|git restore|git stash/iu,
    );
    expect(source).toContain("['checkout-index', '--all', '--force'");
  });

  it('inspecciona el inventario generado y solo acepta exactamente las dos funciones públicas', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lanzo-function-inventory-'));
    const functionsRoot = path.join(root, 'functions');
    try {
      await mkdir(functionsRoot, { recursive: true });
      expect((await inspectGeneratedFunctionInventory(functionsRoot)).complete).toBe(false);
      await writeGeneratedFunction(functionsRoot, 'api/store-page');
      let inventory = await inspectGeneratedFunctionInventory(functionsRoot);
      expect(inventory).toMatchObject({
        complete: false,
        canonicalRoutes: ['/api/store-page'],
        missingExpectedRoutes: ['/api/og/store'],
      });
      await writeGeneratedFunction(functionsRoot, 'api/og/store.js');
      inventory = await inspectGeneratedFunctionInventory(functionsRoot);
      expect(inventory).toMatchObject({
        complete: true,
        canonicalRoutes: ['/api/og/store', '/api/store-page'],
      });
      await writeGeneratedFunction(functionsRoot, 'api/unexpected');
      expect((await inspectGeneratedFunctionInventory(functionsRoot)).complete).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([
    ['dos funciones zero-config', ['api/store-page', 'api/og/store.js'], false],
    ['solo store-page zero-config', ['api/store-page'], true],
    ['solo OG zero-config', ['api/og/store.js'], true],
    ['directorio functions vacío', [], true],
    ['función adicional zero-config', ['api/store-page', 'api/og/store.js', 'api/unexpected'], true],
  ])('activa fallback según la integridad del inventario: %s', async (_label, initialBundles, expectsFallback) => {
    const sourceRoot = await createRepositoryFixture();
    const builds = [];
    let fallbackConfig;
    try {
      await expect(prepareStoreDeployment({
        repositoryRoot: sourceRoot,
        npmInvocation: { command: 'node-fixture', args: ['npm-cli-fixture.js', 'ci', '--no-audit', '--no-fund'] },
        vercelCommand: 'vercel-fixture',
        commandRunner(_command, args, options) {
          if (args.includes('pull')) {
            mkdirSync(path.join(options.cwd, '.vercel'), { recursive: true });
            writeFileSync(path.join(options.cwd, '.vercel', '.env.preview.local'), 'REMOTE_VALUE=kept\n');
            return;
          }
          if (!args.includes('build')) return;
          builds.push(args);
          if (builds.length === 2) {
            fallbackConfig = JSON.parse(readFileSync(path.join(options.cwd, 'store', 'vercel.prebuilt.json'), 'utf8'));
          }
          const outputRoot = path.join(options.cwd, '.vercel', 'output');
          const functionsRoot = path.join(outputRoot, 'functions');
          mkdirSync(functionsRoot, { recursive: true });
          writeFileSync(path.join(outputRoot, 'config.json'), JSON.stringify({ version: 3, routes: [] }));
          const bundles = builds.length === 1 ? initialBundles : ['api/store-page', 'api/og/store.js'];
          for (const bundle of bundles) {
            writeGeneratedFunctionSync(functionsRoot, bundle);
          }
        },
      })).rejects.toThrow('Vercel did not compile the expected trailing-slash canonical route');
      expect(builds).toHaveLength(expectsFallback ? 2 : 1);
      expect(builds.every((args) => (
        args[0] === 'build'
        && !args.includes('--prod')
        && !args.includes('--target=production')
      ))).toBe(true);
      if (expectsFallback) {
        expect(fallbackConfig.builds).toEqual([
          { src: 'api/store-page.js', use: '@vercel/node' },
          { src: 'api/og/store.js', use: '@vercel/node' },
        ]);
      }
    } finally { rmSync(sourceRoot, { recursive: true, force: true }); }
  });

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

  it('solo habilita preservación explícita después de PASS', () => {
    expect(shouldPreservePassedWorkspace({})).toBe(false);
    expect(shouldPreservePassedWorkspace({ PRESERVE_STORE_PREBUILT_EVIDENCE: '0' })).toBe(false);
    expect(shouldPreservePassedWorkspace({ PRESERVE_STORE_PREBUILT_EVIDENCE: '1' })).toBe(true);
    expect(() => shouldPreservePassedWorkspace({
      PRESERVE_STORE_PREBUILT_EVIDENCE: 'yes',
    })).toThrow('must be 1, 0, or unset');
  });

  it('limpia únicamente un workspace de evidencia controlado', async () => {
    const workspaceRoot = await mkdtemp(path.join(
      os.tmpdir(),
      'lanzo-store-social-preview-1-6-',
    ));
    const manifestPath = `${workspaceRoot}-output-sha256.json`;
    await writeFile(manifestPath, '{"fixture":true}\n');
    await writeFile(path.join(workspaceRoot, 'fixture.txt'), 'fixture');
    await expect(cleanupPreparedStoreWorkspace({ workspaceRoot, manifestPath }))
      .resolves.toEqual({ workspaceRemoved: true, manifestRemoved: true });
    await expect(cleanupPreparedStoreWorkspace({
      workspaceRoot: path.join(os.tmpdir(), 'uncontrolled-store-workspace'),
    })).rejects.toThrow('outside the controlled store workspace');
  });

  it('preserva un PASS sin ningún .env ni valor descargado', async () => {
    const workspaceRoot = await mkdtemp(path.join(
      os.tmpdir(),
      'lanzo-store-social-preview-1-6-',
    ));
    const storeRoot = path.join(workspaceRoot, 'store');
    const outputRoot = path.join(workspaceRoot, '.vercel', 'output');
    const repositoryRoot = await createRepositoryFixture();
    const secretFixture = 'FIXTURE_DOWNLOADED_VALUE_1_7_1';
    await Promise.all([
      mkdir(outputRoot, { recursive: true }),
      mkdir(path.join(storeRoot, '.vercel'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(workspaceRoot, '.vercel', 'project.json'), '{"projectId":"fixture"}'),
      writeFile(path.join(outputRoot, 'config.json'), '{"version":3}'),
      writeFile(path.join(workspaceRoot, '.vercel', '.env.production.local'), secretFixture),
      writeFile(path.join(workspaceRoot, '.vercel', '.env.preview.local'), secretFixture),
      writeFile(path.join(workspaceRoot, '.env.local'), secretFixture),
      writeFile(path.join(storeRoot, '.env.production.local'), secretFixture),
      writeFile(path.join(storeRoot, '.vercel', '.env.development.local'), secretFixture),
      writeFile(path.join(storeRoot, 'vercel.prebuilt.json'), '{"temporary":true}'),
    ]);
    const repositoryBefore = await readFile(path.join(repositoryRoot, 'vercel.json'), 'utf8');
    const finalized = await finalizePassedStoreWorkspace({
      workspaceRoot,
      storeRoot,
      auditOptions: { fixture: true },
      prebuiltAuditor: async (_target, auditedRoot, options) => {
        expect(auditedRoot).toBe(workspaceRoot);
        expect(options).toEqual({ fixture: true });
        expect(await findWorkspaceEnvironmentFiles(workspaceRoot)).toEqual([]);
        return { status: 'PASS', failedChecks: [], target: 'store' };
      },
    });
    const manifest = await writeExternalManifest(workspaceRoot, outputRoot);
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      targetEnvironment: 'preview',
      deploymentType: 'preview',
      production: false,
      deploymentExecuted: false,
    });
    expect(await exists(workspaceRoot)).toBe(true);
    expect(await exists(path.join(workspaceRoot, '.vercel', 'project.json'))).toBe(true);
    expect(await exists(outputRoot)).toBe(true);
    expect(await findWorkspaceEnvironmentFiles(workspaceRoot)).toEqual([]);
    expect(await exists(path.join(storeRoot, 'vercel.prebuilt.json'))).toBe(false);
    expect((await readAllFiles(workspaceRoot)).join('\n')).not.toContain(secretFixture);
    expect(await readFile(manifest.manifestPath, 'utf8')).not.toContain(secretFixture);
    expect(JSON.stringify(finalized)).not.toContain(secretFixture);
    expect(await readFile(path.join(repositoryRoot, 'vercel.json'), 'utf8')).toBe(repositoryBefore);
    await cleanupPreparedStoreWorkspace({
      workspaceRoot,
      manifestPath: manifest.manifestPath,
    });
    rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it('prepara un PASS preservado y reaudita después de limpiar todos los .env', async () => {
    const repositoryRoot = await createRepositoryFixture();
    const downloadedValue = 'DOWNLOADED_ENV_FIXTURE_1_7_1';
    const auditCalls = [];
    const result = await prepareStoreDeployment({
      repositoryRoot,
      preservePassedWorkspace: true,
      npmInvocation: {
        command: 'node-fixture',
        args: ['npm-cli-fixture.js', 'ci', '--no-audit', '--no-fund'],
        options: { shell: false },
      },
      vercelCommand: 'vercel-fixture',
      commandRunner(_command, args, options) {
        const workspaceRoot = options.cwd;
        if (args.includes('build:store:vercel')) {
          const staticRoot = path.join(workspaceRoot, 'store', 'dist');
          mkdirSync(path.join(staticRoot, 'assets'), { recursive: true });
          writeFileSync(path.join(staticRoot, 'index.html'), [
            '<!doctype html><html><head>',
            '<!-- LANZO_SOCIAL_HEAD_START --><title>Tienda</title><!-- LANZO_SOCIAL_HEAD_END -->',
            '<link rel="stylesheet" href="/assets/index-AbCd1234.css"></head>',
            '<body><div id="root"></div>',
            '<script type="module" src="/assets/index-ZyXw9876.js"></script></body></html>',
          ].join(''));
          writeFileSync(path.join(staticRoot, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
          writeFileSync(path.join(staticRoot, 'assets', 'index-AbCd1234.css'), 'body{color:#123456}');
          writeFileSync(path.join(staticRoot, 'assets', 'index-ZyXw9876.js'), 'export const store=true;');
          return;
        }
        if (args.includes('pull')) {
          mkdirSync(path.join(workspaceRoot, 'store', '.vercel'), { recursive: true });
          for (const relativePath of [
            '.vercel/.env.production.local',
            '.vercel/.env.preview.local',
            '.env.local',
            'store/.env.production.local',
            'store/.vercel/.env.development.local',
          ]) {
            writeFileSync(path.join(workspaceRoot, relativePath), downloadedValue);
          }
          return;
        }
        if (args.includes('build')) {
          const outputRoot = path.join(workspaceRoot, '.vercel', 'output');
          const functionsRoot = path.join(outputRoot, 'functions');
          mkdirSync(functionsRoot, { recursive: true });
          writeFileSync(path.join(outputRoot, 'config.json'), JSON.stringify({
            version: 3,
            routes: [{ src: '^/(.*)/$', status: 308, headers: { Location: '/$1' } }],
          }));
          for (const relativeRoute of ['api/store-page', 'api/og/store.js']) {
            writeGeneratedFunctionSync(functionsRoot, relativeRoute);
          }
        }
      },
      prebuiltAuditor: async (target, workspaceRoot) => {
        auditCalls.push(target);
        expect(await findWorkspaceEnvironmentFiles(workspaceRoot)).toEqual([]);
        return {
          status: 'PASS',
          target: 'store',
          failedChecks: [],
          output: { functions: ['/api/og/store', '/api/store-page'], routes: 1 },
        };
      },
    });
    expect(result).toMatchObject({
      status: 'PASS',
      HEAD: fixtureHead,
      targetEnvironment: 'preview',
      deploymentType: 'preview',
      production: false,
      deploymentExecuted: false,
      commands: {
        pull: 'vercel pull --yes --environment=preview',
        build: 'vercel build --debug --local-config ./store/vercel.prebuilt.json',
        deploy: 'vercel deploy --prebuilt --yes',
      },
      workspacePreserved: true,
      cleanupRequired: true,
      environmentFilesFound: [],
      sourceProvenance: {
        mode: 'git-head-temporary-index',
        HEAD: fixtureHead,
        treeOid: fixtureTree,
        objectFormat: 'sha1',
        checkoutCleanBefore: true,
        checkoutCleanAfter: true,
        headStable: true,
        treeStable: true,
        snapshotFromTemporaryIndex: true,
        trackedFilesOnly: true,
        workingTreeCopied: false,
        snapshotRemoved: true,
        temporaryIndexRemoved: true,
      },
    });
    expect(auditCalls).toEqual(['store', 'store']);
    expect(await exists(path.join(result.workspaceRoot, '.vercel', 'project.json'))).toBe(true);
    expect(await exists(result.outputRoot)).toBe(true);
    expect(await findWorkspaceEnvironmentFiles(result.workspaceRoot)).toEqual([]);
    expect((await readAllFiles(result.workspaceRoot)).join('\n')).not.toContain(downloadedValue);
    expect(await readFile(result.manifestPath, 'utf8')).not.toContain(downloadedValue);
    expect(JSON.stringify(result)).not.toContain(downloadedValue);
    expect(await exists(path.join(repositoryRoot, '.vercel'))).toBe(false);
    await cleanupPreparedStoreWorkspace({
      workspaceRoot: result.workspaceRoot,
      manifestPath: result.manifestPath,
    });
    rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it('bloquea y elimina el workspace si no puede retirar un .env', async () => {
    const workspaceRoot = await mkdtemp(path.join(
      os.tmpdir(),
      'lanzo-store-social-preview-1-6-',
    ));
    await writeFile(path.join(workspaceRoot, '.env.preview.local'), 'FIXTURE_ONLY=value');
    await expect(finalizePassedStoreWorkspace({
      workspaceRoot,
      prebuiltAuditor: async () => ({ status: 'PASS', failedChecks: [] }),
      removeFile: async () => {
        throw new Error('controlled environment cleanup failure');
      },
    })).rejects.toThrow('controlled environment cleanup failure');
    expect(await exists(workspaceRoot)).toBe(false);
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

  it('conserva el entorno de Vercel y elimina el token sin mutar el padre', () => {
    const parent = { Path: 'C:\\tools;C:\\WINDOWS\\System32', PATH: 'C:\\duplicate', SystemRoot: 'C:\\Windows', VERCEL_TOKEN: 'secret' };
    const result = buildVercelExecutionEnvironment({ environment: parent });
    expect(result.Path).toBe(parent.Path);
    expect(result.PATH).toBe(parent.PATH);
    expect(result.SystemRoot).toBe('C:\\Windows');
    expect(result).not.toHaveProperty('VERCEL_TOKEN');
    expect(parent).toHaveProperty('Path');
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

  it('ejecuta el build público mediante node y npm-cli.js, sin shell', () => {
    const invocation = resolveNpmScriptInvocation({
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
      npmCliPath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
      script: 'build:store:vercel',
    });
    expect(invocation).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'run', 'build:store:vercel'],
      options: { shell: false },
    });
  });

  it.runIf(process.platform === 'win32')(
    'resuelve el CLI autenticado de Vercel como JavaScript directo, sin vercel.cmd',
    async () => {
      const invocation = await resolveVercelInvocation();
      expect(invocation.command).toBe(process.execPath);
      expect(invocation.argsPrefix).toHaveLength(1);
      expect(invocation.argsPrefix[0]).toMatch(/vercel[\\/]dist[\\/]vc\.js$/iu);
      expect(invocation.argsPrefix[0]).not.toMatch(/\.cmd$/iu);
      expect(invocation.options).toEqual({ shell: false });
    },
  );

  it('deriva la configuración temporal sin mutar la original y conserva su paridad funcional', () => {
    const source = {
      $schema: 'https://openapi.vercel.sh/vercel.json', framework: null,
      installCommand: 'cd .. && npm ci', buildCommand: 'cd .. && npm run build:store:vercel',
      outputDirectory: 'dist', headers: [{ source: '/(.*)', headers: [{ key: 'X-Test', value: 'yes' }] }],
      rewrites: [{ source: '/tienda/:slug', destination: '/api/store-page' }], trailingSlash: false,
      futureOption: { preserved: true },
    };
    const generated = createPrebuiltVercelConfig(source);
    expect(source.installCommand).toBe('cd .. && npm ci');
    expect(source.buildCommand).toBe('cd .. && npm run build:store:vercel');
    expect(generated).not.toHaveProperty('installCommand');
    expect(generated).not.toHaveProperty('buildCommand');
    expect(generated.headers).toEqual(source.headers);
    expect(generated.rewrites).toEqual(source.rewrites);
    expect(generated.futureOption).toEqual({ preserved: true });
    expect(() => assertPrebuiltVercelConfigParity(source, { ...generated, trailingSlash: true }))
      .toThrow('differs from store/vercel.json');
  });

  it('escribe la configuración temporal solo donde se le pide', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lanzo-prebuilt-config-'));
    const sourcePath = path.join(root, 'vercel.json');
    const targetPath = path.join(root, 'vercel.prebuilt.json');
    await writeFile(sourcePath, JSON.stringify({ installCommand: 'cd .. && npm ci', buildCommand: 'cd .. && npm run build', rewrites: [] }));
    try {
      await writePrebuiltVercelConfig({ sourceConfigPath: sourcePath, targetConfigPath: targetPath });
      expect(await readFile(sourcePath, 'utf8')).toContain('installCommand');
      expect(JSON.parse(await readFile(targetPath, 'utf8'))).toEqual({ rewrites: [] });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('sanitiza la inspección remota del proyecto y los logs debug', () => {
    const inspection = sanitizeVercelProjectInspection([
      '    ID                prj_fixture',
      '    Name              lanzo-store',
      '    Root Directory    store',
      '    Framework Preset  Other',
      '    Build Command     `npm run build`',
      '    Install Command   `npm install`',
      '    Output Directory  `public`',
      '    Node.js Version   24.x',
    ].join('\n'), 'C:\\private\\workspace');
    expect(inspection).toEqual({
      projectId: 'prj_fixture', projectName: 'lanzo-store', configuredRootDirectory: 'store',
      framework: 'Other', buildCommand: 'npm run build', installCommand: 'npm install',
      outputDirectory: 'public', nodeVersion: '24.x',
    });
    const debug = sanitizeVercelDebugLog(
      'C:\\private\\workspace\\.vercel\\output token vcp_example_secret_123456',
      'C:\\private\\workspace',
    );
    expect(debug).not.toContain('private\\workspace');
    expect(debug).not.toContain('vcp_example_secret_123456');
  });

  it('valida la raíz Vercel efectiva con ambos endpoints y la configuración temporal', async () => {
    const root = await createRepositoryFixture();
    const prebuiltConfigPath = path.join(root, 'store', 'vercel.prebuilt.json');
    await writeFile(prebuiltConfigPath, '{}');
    try {
      await expect(assertEffectiveVercelProjectRoot({
        workspaceRoot: root, configuredRootDirectory: 'store', prebuiltConfigPath,
      })).resolves.toMatchObject({
        effectiveSourceRoot: path.join(root, 'store'),
        apiDirectory: path.join(root, 'store', 'api'),
        apiDirectoryExists: true,
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('rechaza una raíz efectiva sin api y la duplicación store/store', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lanzo-effective-root-'));
    await mkdir(path.join(root, 'store', 'store'), { recursive: true });
    try {
      await expect(assertEffectiveVercelProjectRoot({
        workspaceRoot: root, configuredRootDirectory: 'missing',
      })).rejects.toThrow('Effective Vercel project root is missing: api');
      await expect(assertEffectiveVercelProjectRoot({
        workspaceRoot: root, configuredRootDirectory: 'store/store',
      })).rejects.toThrow('duplicated store/store');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('escribe el enlace temporal en el workspace y no dentro de store', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lanzo-project-link-'));
    try {
      await writeProjectLink(root);
      expect(JSON.parse(await readFile(path.join(root, '.vercel', 'project.json'), 'utf8'))).toMatchObject({
        projectId: 'prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4',
      });
      expect(await exists(path.join(root, 'store', '.vercel', 'project.json'))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('solo permite el fallback explícito para los dos endpoints públicos exactos', () => {
    const source = { installCommand: 'npm ci', buildCommand: 'npm run build', rewrites: [] };
    const allowed = {
      rewrites: [],
      builds: [
        { src: 'api/store-page.js', use: '@vercel/node' },
        { src: 'api/og/store.js', use: '@vercel/node' },
      ],
    };
    expect(() => assertPrebuiltVercelConfigParity(source, allowed)).not.toThrow();
    for (const invalid of [
      [{ src: 'api/**/*.js', use: '@vercel/node' }, { src: 'api/og/store.js', use: '@vercel/node' }],
      [{ src: 'api/_publicPortal.js', use: '@vercel/node' }, { src: 'api/og/store.js', use: '@vercel/node' }],
      [{ src: 'api/store-page.js', use: '@vercel/node' }],
    ]) {
      expect(() => assertPrebuiltVercelConfigParity(source, { rewrites: [], builds: invalid }))
        .toThrow('only add the two exact public function entries');
    }
    expect(createPrebuiltVercelConfig(source)).not.toHaveProperty('builds');
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

  it('invoca directamente ejecutables y conserva los argumentos', () => {
    expect(resolveSpawnInvocation({
      command: 'node.exe',
      args: ['--version'],
    })).toEqual({
      command: 'node.exe',
      args: ['--version'],
      options: { shell: false },
    });
  });

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
        workspaceRoot ||= options.cwd;
        if (!args.includes('ci')) throw new Error('controlled Vercel failure');
        expect(args).toContain('ci');
      },
      vercelCommand: 'vercel-fixture',
    })).rejects.toThrow('controlled Vercel failure');
    expect(await exists(workspaceRoot)).toBe(false);
    expect(await exists(`${workspaceRoot}-output-sha256.json`)).toBe(false);
  });

  it('ordena npm ci, build público directo y Vercel sin comandos de shell', async () => {
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
        command: process.execPath,
        args: expect.arrayContaining(['run', 'build:store:vercel']),
      },
      {
        command: 'vercel-fixture',
        args: ['pull', '--yes', '--environment=preview'],
      },
    ]);
    expect(calls.every(({ args }) => Array.isArray(args))).toBe(true);
    expect(JSON.stringify(calls)).not.toMatch(/cmd\.exe|npm\.cmd|cd \.\. &&/iu);
  });

  it('genera, usa y limpia vercel.prebuilt.json en el orden completo', async () => {
    const sourceRoot = await createRepositoryFixture();
    const calls = [];
    let workspaceRoot;
    let capturedPrebuilt;
    await expect(prepareStoreDeployment({
      repositoryRoot: sourceRoot,
      npmInvocation: { command: 'node-fixture', args: ['npm-cli-fixture.js', 'ci', '--no-audit', '--no-fund'] },
      vercelCommand: 'vercel-fixture',
      commandRunner(command, args, options) {
        calls.push({ command, args, cwd: options.cwd });
        workspaceRoot ||= options.cwd;
        if (command !== 'vercel-fixture') return;
        if (args.includes('pull')) {
          mkdirSync(path.join(options.cwd, '.vercel'), { recursive: true });
          writeFileSync(path.join(options.cwd, '.vercel', '.env.preview.local'), 'REMOTE_VALUE=kept\n');
          return;
        }
        capturedPrebuilt = JSON.parse(readFileSync(path.join(options.cwd, 'store', 'vercel.prebuilt.json'), 'utf8'));
        throw new Error('controlled build stop');
      },
    })).rejects.toThrow('controlled build stop');
    expect(calls.map(({ args }) => args.at(-1))).toEqual([
      '--no-fund', 'build:store:vercel', '--environment=preview', './store/vercel.prebuilt.json',
    ]);
    expect(calls.at(-1).args).toEqual(['build', '--debug', '--local-config', './store/vercel.prebuilt.json']);
    expect(capturedPrebuilt).toEqual({ trailingSlash: false });
    expect(await exists(path.join(sourceRoot, 'store', 'vercel.prebuilt.json'))).toBe(false);
    expect(await exists(workspaceRoot)).toBe(false);
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
    const [npmCall, directBuildCall, vercelCall] = calls;
    expect(npmCall.environment.NPM_CONFIG_CACHE).toContain('lanzo-store-social-preview-npm-cache');
    expect(npmCall.environment.XDG_CACHE_HOME).toContain('lanzo-store-npm-cache');
    expect(directBuildCall.environment.VITE_SUPABASE_URL).toContain('invalid-for-local-build');
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
    const missingExecutable = path.join(sourceRoot, 'private-tools', 'missing-node.exe');
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
          return run(command, args, options);
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('Required executable not found: missing-node.exe');
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
    ['creación de .gitignore', true, (root) => writeFileSync(
      path.join(root, '.gitignore'),
      '.vercel\n',
    )],
    ['creación de .vercel/repo.json', true, (root) => writeFileSync(
      path.join(root, '.vercel', 'repo.json'),
      '{"repo":"mutated"}\n',
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

  it('prepara el artefacto sin deployment y con invocaciones directas', async () => {
    const sourceRoot = await createRepositoryFixture();
    const calls = [];
    const npmCliPath = 'C:\\tools\\npm\\bin\\npm-cli.js';
    const vercelCliPath = 'C:\\tools\\vercel\\dist\\vc.js';
    await expect(prepareStoreDeployment({
      repositoryRoot: sourceRoot,
      npmInvocation: {
        command: 'C:\\tools\\node.exe',
        args: [npmCliPath, 'ci', '--no-audit', '--no-fund'],
        options: { shell: false },
      },
      vercelInvocation: {
        command: 'C:\\tools\\node.exe',
        argsPrefix: [vercelCliPath],
        options: { shell: false },
      },
      commandRunner(command, args, options) {
        calls.push({ command, args, options });
        if (args.includes('pull')) {
          mkdirSync(path.join(options.cwd, '.vercel'), { recursive: true });
          writeFileSync(path.join(options.cwd, '.vercel', '.env.preview.local'), 'REMOTE_VALUE=kept\n');
        }
      },
    })).rejects.toThrow('Vercel did not produce .vercel/output');

    const logicalCalls = calls.map(({ args }) => args.join(' '));
    expect(logicalCalls.some((call) => call.includes(
      'build --debug --local-config ./store/vercel.prebuilt.json',
    ))).toBe(true);
    expect(logicalCalls.join(' ')).not.toMatch(/\b(?:deploy|promote|alias)\b|--prebuilt/u);
    expect(calls.every(({ options }) => options.shell === false)).toBe(true);
    expect(calls[0]).toMatchObject({
      command: 'C:\\tools\\node.exe',
      args: [npmCliPath, 'ci', '--no-audit', '--no-fund'],
    });
    expect(calls.filter(({ args }) => args.includes('pull') || args.includes('build')))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ command: 'C:\\tools\\node.exe', args: expect.arrayContaining([vercelCliPath]) }),
      ]));
  });
});
