// @vitest-environment node
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertEffectiveVercelProjectRoot,
  assertPrebuiltVercelConfigParity,
  buildSanitizedGitEnvironment,
  createPrebuiltVercelConfig,
  createSanitizedStoreWorkspace,
  inspectGeneratedFunctionInventory,
  materializePrebuiltStaticOutput,
  prepareStoreDeployment,
  shouldCopyStoreWorkspacePath,
  writeProjectLink,
} from '../../../scripts/prepare-store-deployment.mjs';
import {
  inspectCompiledStoreRoutes,
  inspectPrebuiltBuildTarget,
  verifyTemporaryStoreRoot,
} from '../../../scripts/audit-vercel-build-output.mjs';
import { validatePreviewDeploymentPlan } from '../../../scripts/audit-remote-store-deployment.mjs';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const STORE_PROJECT_ID = 'prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4';
const ADMIN_PROJECT_ID = 'prj_tE5uWn6kLBYdS1eDFWVxRm449RUr';
const STORE_ORG_ID = 'team_buvft2mAJErTNR8gDhXcZGfS';
const WORKSPACE_PREFIX = 'lanzo-store-social-preview-1-6-';
const NOINDEX = 'noindex, nofollow, noarchive';
const STATIC_CACHE = 'public, max-age=0, must-revalidate';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const temporaryRoots = [];
const fixtureIdentity = Object.freeze({
  HEAD: 'a'.repeat(40),
  treeOid: 'b'.repeat(40),
  objectFormat: 'sha1',
});

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function temporaryDirectory(prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createRepositoryFixture() {
  const root = await temporaryDirectory('lanzo-prebuilt-source-');
  await mkdir(path.join(root, 'store', 'api', 'og'), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, 'package.json'), '{"name":"fixture"}\n'),
    writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n'),
    writeFile(path.join(root, 'vercel.json'), '{"project":"admin"}\n'),
    writeJson(path.join(root, 'store', 'vercel.json'), {
      installCommand: 'cd .. && npm ci',
      buildCommand: 'cd .. && npm run build:store:vercel',
      trailingSlash: false,
    }),
    writeFile(path.join(root, 'store', 'api', 'store-page.js'), 'export default {};\n'),
    writeFile(path.join(root, 'store', 'api', 'og', 'store.js'), 'export default {};\n'),
    writeFile(path.join(root, 'keep.js'), 'export const kept = true;\n'),
  ]);
  for (const directory of ['.git', '.vercel', 'node_modules', 'supabase', 'docs', 'tests']) {
    await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, directory, 'private.txt'), directory);
  }
  await Promise.all([
    writeFile(path.join(root, '.env'), 'SECRET=root\n'),
    writeFile(path.join(root, 'store', '.env.production.local'), 'SECRET=store\n'),
  ]);
  return root;
}

async function createInjectedGitSnapshot({ repositoryRoot, temporaryRoot = os.tmpdir() }) {
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

async function createEffectiveWorkspace() {
  const workspaceRoot = await temporaryDirectory(WORKSPACE_PREFIX);
  const storeRoot = path.join(workspaceRoot, 'store');
  await mkdir(path.join(storeRoot, 'api', 'og'), { recursive: true });
  await Promise.all([
    writeFile(path.join(storeRoot, 'api', 'store-page.js'), 'export default {};\n'),
    writeFile(path.join(storeRoot, 'api', 'og', 'store.js'), 'export default {};\n'),
    writeFile(path.join(storeRoot, 'vercel.prebuilt.json'), '{"trailingSlash":false}\n'),
  ]);
  return { workspaceRoot, storeRoot };
}

async function writeFunction(functionsRoot, relativeRoute, {
  handler = 'index.mjs',
  runtime = 'nodejs24.x',
  writeHandler = true,
} = {}) {
  const bundleRoot = path.join(functionsRoot, `${relativeRoute}.func`);
  await mkdir(bundleRoot, { recursive: true });
  await writeJson(path.join(bundleRoot, '.vc-config.json'), { handler, runtime });
  if (writeHandler) await writeFile(path.join(bundleRoot, handler), 'export default {};\n');
}

function validCompiledRoutes() {
  return [
    {
      src: '^/(.*)/$',
      status: 308,
      headers: { Location: '/$1', 'X-Robots-Tag': NOINDEX },
    },
    { src: '^/(.*)$', headers: { 'X-Robots-Tag': NOINDEX }, continue: true },
    { src: '^/assets/(.*)$', headers: { 'Cache-Control': IMMUTABLE_CACHE }, continue: true },
    {
      src: '^/(?:index\\.html)?$',
      headers: { 'Cache-Control': STATIC_CACHE },
      continue: true,
    },
    { handle: 'filesystem' },
    { src: '^/tienda/([^/]+)/pedido/([^/]+)$', dest: '/index.html' },
    { src: '^/tienda/([^/]+)$', dest: '/api/store-page?slug=$1' },
    { src: '^/tienda/[^/]+/.+$', dest: '/index.html' },
    { src: '^/(?:|tienda|conoce-lanzo)$', dest: '/index.html' },
    { handle: 'error' },
  ];
}

async function createStaticFixture() {
  const root = await temporaryDirectory('lanzo-prebuilt-static-');
  const sourceStaticRoot = path.join(root, 'source');
  const outputStaticRoot = path.join(root, 'output', 'static');
  await mkdir(path.join(sourceStaticRoot, 'assets'), { recursive: true });
  await Promise.all([
    writeFile(path.join(sourceStaticRoot, 'index.html'), [
      '<!doctype html><html><head>',
      '<!-- LANZO_SOCIAL_HEAD_START --><title>Tienda</title><!-- LANZO_SOCIAL_HEAD_END -->',
      '<link rel="stylesheet" href="/assets/index-AbCd1234.css"></head>',
      '<body><div id="root"></div><script type="module" src="/assets/index-ZyXw9876.js"></script></body></html>',
    ].join('')),
    writeFile(path.join(sourceStaticRoot, 'robots.txt'), 'User-agent: *\nDisallow: /\n'),
    writeFile(path.join(sourceStaticRoot, 'assets', 'index-AbCd1234.css'), 'body{color:#123456}'),
    writeFile(path.join(sourceStaticRoot, 'assets', 'index-ZyXw9876.js'), [
      "export const supabaseUrl = 'https://fixture-project.supabase.co';",
      "export const publishableKey = 'sb_publishable_fixture_1234567890';",
      "export const publicStorageKey = 'lanzo-public-store-auth';",
      'export const store = true;',
    ].join('\n')),
  ]);
  return { root, sourceStaticRoot, outputStaticRoot };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

describe('ECOM.PUBLIC.SOCIAL.PREVIEW prebuilt deployment architecture', () => {
  it('copies a sanitized repository without local state, dependencies, Supabase, docs, tests, or env files', async () => {
    const sourceRoot = await createRepositoryFixture();
    const workspaceRoot = await temporaryDirectory(`${WORKSPACE_PREFIX}copy-`);
    await createSanitizedStoreWorkspace({ sourceRoot, temporaryRoot: workspaceRoot });

    expect(await readFile(path.join(workspaceRoot, 'keep.js'), 'utf8')).toContain('kept');
    for (const relativePath of [
      '.git',
      '.vercel',
      '.env',
      'node_modules',
      'supabase',
      'docs',
      'tests',
      'store/.env.production.local',
    ]) {
      expect(await exists(path.join(workspaceRoot, relativePath)), relativePath).toBe(false);
      expect(shouldCopyStoreWorkspacePath(relativePath), relativePath).toBe(false);
    }
    expect(await readFile(path.join(sourceRoot, '.env'), 'utf8')).toBe('SECRET=root\n');
  });

  it('rejects symbolic links instead of following them into the sanitized workspace', async () => {
    const sourceRoot = await createRepositoryFixture();
    await symlink(path.join(sourceRoot, 'keep.js'), path.join(sourceRoot, 'linked.js'));
    const workspaceRoot = await temporaryDirectory(`${WORKSPACE_PREFIX}symlink-`);
    await expect(createSanitizedStoreWorkspace({ sourceRoot, temporaryRoot: workspaceRoot }))
      .rejects.toThrow('Symbolic link forbidden');
  });

  it('accepts only the controlled system temporary workspace and its direct store child', async () => {
    const fixture = await createEffectiveWorkspace();
    expect(verifyTemporaryStoreRoot({
      workspaceRoot: fixture.workspaceRoot,
      effectiveStoreRoot: fixture.storeRoot,
    })).toBe(true);
    expect(verifyTemporaryStoreRoot({
      workspaceRoot: fixture.workspaceRoot,
      effectiveStoreRoot: path.join(fixture.storeRoot, 'store'),
    })).toBe(false);
    expect(verifyTemporaryStoreRoot({
      workspaceRoot: projectRoot,
      effectiveStoreRoot: path.join(projectRoot, 'store'),
    })).toBe(false);
  });

  it('resolves Root Directory store and rejects store/store or workspace escapes', async () => {
    const fixture = await createEffectiveWorkspace();
    const result = await assertEffectiveVercelProjectRoot({
      workspaceRoot: fixture.workspaceRoot,
      configuredRootDirectory: 'store',
      prebuiltConfigPath: path.join(fixture.storeRoot, 'vercel.prebuilt.json'),
    });
    expect(result.effectiveSourceRoot).toBe(fixture.storeRoot);
    await expect(assertEffectiveVercelProjectRoot({
      workspaceRoot: fixture.workspaceRoot,
      configuredRootDirectory: 'store/store',
      prebuiltConfigPath: path.join(fixture.storeRoot, 'vercel.prebuilt.json'),
    })).rejects.toThrow(/store\/store|missing/iu);
    await expect(assertEffectiveVercelProjectRoot({
      workspaceRoot: fixture.workspaceRoot,
      configuredRootDirectory: '../outside',
    })).rejects.toThrow('escapes the temporary workspace');
  });

  it('writes the authorized store project link only inside the temporary workspace', async () => {
    const fixture = await createEffectiveWorkspace();
    const repositoryLink = path.join(projectRoot, '.vercel', 'project.json');
    const repositoryLinkBefore = await exists(repositoryLink)
      ? await readFile(repositoryLink, 'utf8')
      : null;
    await writeProjectLink(fixture.workspaceRoot);
    expect(JSON.parse(await readFile(
      path.join(fixture.workspaceRoot, '.vercel', 'project.json'),
      'utf8',
    ))).toEqual({ projectId: STORE_PROJECT_ID, orgId: STORE_ORG_ID });
    expect(await exists(repositoryLink)).toBe(repositoryLinkBefore !== null);
    if (repositoryLinkBefore !== null) {
      expect(await readFile(repositoryLink, 'utf8')).toBe(repositoryLinkBefore);
    }
  });

  it('keeps store and administrative project IDs isolated', async () => {
    const [storePrepare, adminPrepare] = await Promise.all([
      readFile(path.join(projectRoot, 'scripts', 'prepare-store-deployment.mjs'), 'utf8'),
      readFile(path.join(projectRoot, 'scripts', 'prepare-admin-deployment.mjs'), 'utf8'),
    ]);
    expect(storePrepare).toContain(STORE_PROJECT_ID);
    expect(storePrepare).not.toContain(ADMIN_PROJECT_ID);
    expect(adminPrepare).toContain(ADMIN_PROJECT_ID);
    expect(adminPrepare).not.toContain(STORE_PROJECT_ID);
  });

  it('derives the temporary config without changing the public routing contract', () => {
    const source = {
      installCommand: 'cd .. && npm ci',
      buildCommand: 'cd .. && npm run build:store:vercel',
      trailingSlash: false,
      rewrites: [{ source: '/tienda/:slug', destination: '/api/store-page' }],
    };
    const generated = createPrebuiltVercelConfig(source);
    expect(generated).toEqual({
      trailingSlash: false,
      rewrites: [{ source: '/tienda/:slug', destination: '/api/store-page' }],
    });
    expect(source).toHaveProperty('installCommand');
    expect(() => assertPrebuiltVercelConfigParity(source, generated)).not.toThrow();
  });

  it('allows only the two exact public build entries as a controlled fallback', () => {
    const source = { installCommand: 'npm ci', buildCommand: 'npm run build', trailingSlash: false };
    const generated = {
      trailingSlash: false,
      builds: [
        { src: 'api/store-page.js', use: '@vercel/node' },
        { src: 'api/og/store.js', use: '@vercel/node' },
      ],
    };
    expect(() => assertPrebuiltVercelConfigParity(source, generated)).not.toThrow();
    expect(() => assertPrebuiltVercelConfigParity(source, {
      ...generated,
      builds: [...generated.builds, { src: 'api/_helper.js', use: '@vercel/node' }],
    })).toThrow('two exact public function entries');
  });

  it('runs pull and preview build without invoking deployment commands', async () => {
    const repositoryRoot = await createRepositoryFixture();
    const calls = [];
    await expect(prepareStoreDeployment({
      repositoryRoot,
      repositoryStatusReader: async () => ({ clean: true }),
      repositoryIdentityResolver: async () => fixtureIdentity,
      repositoryStabilityChecker: async () => ({
        identity: fixtureIdentity,
        checkoutCleanAfter: true,
        headStable: true,
        treeStable: true,
      }),
      gitSnapshotCreator: createInjectedGitSnapshot,
      npmInvocation: {
        command: 'node-fixture',
        args: ['npm-cli-fixture.js', 'ci', '--no-audit', '--no-fund'],
        options: { shell: false },
      },
      vercelCommand: 'vercel-fixture',
      projectInspection: {
        projectId: STORE_PROJECT_ID,
        projectName: 'lanzo-store',
        configuredRootDirectory: 'store',
      },
      commandRunner(command, args, options) {
        calls.push({ command, args, cwd: options.cwd });
        if (
          command === 'vercel-fixture'
          && args.join(' ') === 'pull --yes --environment=preview'
        ) {
          const environmentDirectory = path.join(options.cwd, '.vercel');
          mkdirSync(environmentDirectory, { recursive: true });
          writeFileSync(path.join(environmentDirectory, '.env.preview.local'), [
            'VITE_SUPABASE_URL=https://fixture-project.supabase.co',
            'VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_fixture_1234567890',
            '',
          ].join('\n'));
        }
      },
    })).rejects.toThrow('Vercel did not produce .vercel/output');

    const logical = calls.map(({ command, args }) => [command, ...args].join(' '));
    expect(logical).toEqual(expect.arrayContaining([
      'vercel-fixture pull --yes --environment=preview',
      'vercel-fixture build --debug --local-config ./store/vercel.prebuilt.json',
    ]));
    expect(logical.join('\n')).not.toContain('--prod');
    expect(logical.join('\n')).not.toMatch(/\b(?:deploy|promote|alias)\b|--prebuilt/iu);
    expect(new Set(calls.map(({ cwd }) => cwd)).size).toBe(1);
    expect(path.basename(calls[0].cwd)).toMatch(/^lanzo-store-social-preview-1-6-/u);
    expect(await exists(calls[0].cwd)).toBe(false);
  });

  it('models the prebuilt environment mismatch deterministically', () => {
    const production = inspectPrebuiltBuildTarget({
      target: 'production',
      argv: ['build', '--prod'],
    });
    expect(production).toMatchObject({
      targetEnvironment: 'production',
      production: true,
      checks: {
        targetEnvironmentPresent: true,
        targetEnvironmentPreview: false,
        noProductionBuildFlags: false,
      },
    });

    const preview = inspectPrebuiltBuildTarget({
      target: 'preview',
      argv: ['build', '--debug', '--local-config', './store/vercel.prebuilt.json'],
    });
    expect(preview).toMatchObject({
      targetEnvironment: 'preview',
      deploymentType: 'preview',
      production: false,
      checks: {
        targetEnvironmentPresent: true,
        targetEnvironmentPreview: true,
        noProductionBuildFlags: true,
      },
    });
    expect(inspectPrebuiltBuildTarget({ argv: ['build'] }).checks)
      .toMatchObject({ targetEnvironmentPresent: false, targetEnvironmentPreview: false });
  });

  it('reports preparation as non-deploying by contract', async () => {
    const source = await readFile(
      path.join(projectRoot, 'scripts', 'prepare-store-deployment.mjs'),
      'utf8',
    );
    expect(source).toContain('deploymentExecuted: false');
    expect(source).not.toMatch(/['"]deploy['"]|['"]promote['"]|['"]alias['"]/u);
  });

  it('isolates every Git provenance operation from inherited Git routing', async () => {
    const [source, vitestConfig, pageTest] = await Promise.all([
      readFile(path.join(projectRoot, 'scripts', 'prepare-store-deployment.mjs'), 'utf8'),
      readFile(path.join(projectRoot, 'vite.config.js'), 'utf8'),
      readFile(
        path.join(projectRoot, 'src', 'pages', '__tests__', 'PublicStorePage.siteVersion.test.jsx'),
        'utf8',
      ),
    ]);
    const parentEnvironment = {
      PATH: '/controlled/bin',
      GIT_DIR: '/redirected/.git',
      git_work_tree: '/redirected',
      GIT_INDEX_FILE: '/redirected/index',
    };
    const childEnvironment = buildSanitizedGitEnvironment({ environment: parentEnvironment });
    expect(childEnvironment).toEqual({
      PATH: '/controlled/bin',
      GIT_TERMINAL_PROMPT: '0',
    });
    expect(parentEnvironment).toHaveProperty('GIT_DIR', '/redirected/.git');
    expect(source).toContain("name.toUpperCase().startsWith('GIT_')");
    expect(source).toContain("['rev-parse', '--is-inside-work-tree']");
    expect(source).toContain("['rev-parse', '--show-toplevel']");
    expect(source).toContain('buildSanitizedGitEnvironment({ environment })');
    expect(source).toContain('temporaryIndexPath,');
    expect(source).toContain("['read-tree', HEAD]");
    expect(source).toContain("['checkout-index', '--all', '--force'");
    expect(source).not.toMatch(
      /shell:\s*true|cmd\.exe|powershell|bash|git\s+(?:reset|clean|stash|restore)/iu,
    );
    expect(vitestConfig).toContain('testTimeout: 15_000');
    expect(vitestConfig).not.toMatch(/testTimeout:\s*(?:1[6-9]|[2-9]\d)_?\d{3}/u);
    expect(pageTest).not.toMatch(/\.(?:skip|todo)\s*\(|test\.fails\s*\(/u);
  });

  it('accepts exactly the two generated Functions with valid handlers and runtimes', async () => {
    const root = await temporaryDirectory('lanzo-functions-');
    await writeFunction(root, 'api/store-page');
    await writeFunction(root, 'api/og/store.js');
    const inventory = await inspectGeneratedFunctionInventory(root);
    expect(inventory.complete).toBe(true);
    expect(inventory.canonicalRoutes).toEqual(['/api/og/store', '/api/store-page']);
    expect(inventory.handlers.every(({ present }) => present)).toBe(true);
    expect(inventory.runtimes.every(({ valid }) => valid)).toBe(true);
  });

  it.each([
    ['zero Functions', []],
    ['one Function', ['api/store-page']],
    ['a third Function', ['api/store-page', 'api/og/store.js', 'api/_helper']],
  ])('rejects %s', async (_label, routes) => {
    const root = await temporaryDirectory('lanzo-functions-count-');
    for (const route of routes) await writeFunction(root, route);
    expect((await inspectGeneratedFunctionInventory(root)).complete).toBe(false);
  });

  it('rejects missing handlers, invalid runtimes, and duplicate canonical bundles', async () => {
    const missingHandlerRoot = await temporaryDirectory('lanzo-functions-handler-');
    await writeFunction(missingHandlerRoot, 'api/store-page', { writeHandler: false });
    await writeFunction(missingHandlerRoot, 'api/og/store.js');
    expect((await inspectGeneratedFunctionInventory(missingHandlerRoot)).complete).toBe(false);

    const invalidRuntimeRoot = await temporaryDirectory('lanzo-functions-runtime-');
    await writeFunction(invalidRuntimeRoot, 'api/store-page', { runtime: 'edge' });
    await writeFunction(invalidRuntimeRoot, 'api/og/store.js');
    expect((await inspectGeneratedFunctionInventory(invalidRuntimeRoot)).complete).toBe(false);

    const duplicateRoot = await temporaryDirectory('lanzo-functions-duplicate-');
    await writeFunction(duplicateRoot, 'api/store-page');
    await writeFunction(duplicateRoot, 'api/store-page.js');
    await writeFunction(duplicateRoot, 'api/og/store.js');
    const duplicate = await inspectGeneratedFunctionInventory(duplicateRoot);
    expect(duplicate.complete).toBe(false);
    expect(duplicate.duplicateRoutes).toContain('/api/store-page');
  });

  it('materializes index, robots, JS and CSS with byte parity', async () => {
    const fixture = await createStaticFixture();
    const result = await materializePrebuiltStaticOutput(fixture);
    expect(result).toMatchObject({
      parity: true,
      sourceFiles: 4,
      outputFiles: 4,
    });
    expect((await readdir(path.join(fixture.outputStaticRoot, 'assets'))).sort())
      .toEqual(['index-AbCd1234.css', 'index-ZyXw9876.js']);
  });

  it('rejects environment files and public source maps during static materialization', async () => {
    const envFixture = await createStaticFixture();
    await writeFile(path.join(envFixture.sourceStaticRoot, '.env.production'), 'SECRET=value\n');
    await expect(materializePrebuiltStaticOutput(envFixture))
      .rejects.toThrow('Public static build audit failed');

    const mapFixture = await createStaticFixture();
    await writeFile(path.join(mapFixture.sourceStaticRoot, 'assets', 'index-ZyXw9876.js.map'), '{}');
    await expect(materializePrebuiltStaticOutput(mapFixture))
      .rejects.toThrow('Public static build audit failed');
  });

  it('validates compiled dynamic HTML, tracking, nested fallback, assets and API isolation', () => {
    const routing = inspectCompiledStoreRoutes(
      { version: 3, routes: validCompiledRoutes() },
      { staticPaths: ['index.html', 'assets/index-ZyXw9876.js'] },
    );
    expect(routing.checks).toMatchObject({
      configVersion3: true,
      dynamicStoreRoute: true,
      dynamicAfterFilesystem: true,
      dynamicDestination: true,
      pathSlugExactlyOnce: true,
      trackingStatic: true,
      nestedStoreStatic: true,
      assetsNotIntercepted: true,
      apiNotIntercepted: true,
    });
    expect(routing.cases.every(({ slugValues }) => (
      slugValues.length === 1 && slugValues[0] === 'mi-tienda'
    ))).toBe(true);
  });

  it('validates noindex, 308, static revalidation, immutable assets and non-immutable HTML', () => {
    const routing = inspectCompiledStoreRoutes(
      { version: 3, routes: validCompiledRoutes() },
      { staticPaths: ['index.html', 'assets/index-ZyXw9876.js'] },
    );
    expect(routing.checks).toMatchObject({
      trailingSlashCanonical: true,
      trailingSlashNoindex: true,
      globalNoindex: true,
      immutableAssets: true,
      staticHtmlRevalidated: true,
      htmlNeverImmutable: true,
      noExternalDestination: true,
      noRouteLoop: true,
    });
  });

  it('allows the first preview only through deploy --prebuilt --yes', () => {
    expect(validatePreviewDeploymentPlan({
      deploymentPolicy: 'single-preview',
      projectName: 'lanzo-store',
      deploymentType: 'preview',
      production: false,
      previousPreviewDeployments: 0,
      head: fixtureIdentity.HEAD,
      correctivePreviewAuthorized: false,
      correctivePreviewNumber: 0,
      correctivePreviewExecuted: false,
      previousCorrectivePreviewDeployments: 0,
      commandArgs: ['deploy', '--prebuilt', '--yes'],
    })).toMatchObject({
      projectName: 'lanzo-store',
      deploymentType: 'preview',
      previousPreviewCount: 0,
      production: false,
    });
  });

  it.each([
    ['production deploy', ['deploy', '--prebuilt', '--prod', '--yes']],
    ['promote', ['promote']],
    ['alias', ['alias']],
  ])('rejects %s', (_label, commandArgs) => {
    expect(() => validatePreviewDeploymentPlan({
      deploymentPolicy: 'single-preview',
      projectName: 'lanzo-store',
      deploymentType: commandArgs.includes('--prod') ? 'production' : 'preview',
      production: commandArgs.includes('--prod'),
      previousPreviewDeployments: 0,
      head: fixtureIdentity.HEAD,
      correctivePreviewAuthorized: false,
      correctivePreviewNumber: 0,
      correctivePreviewExecuted: false,
      previousCorrectivePreviewDeployments: 0,
      commandArgs,
    })).toThrow();
  });

  it('keeps the administrative SPA and PWA contract independent from the store target', async () => {
    const [adminConfigSource, outputAudit] = await Promise.all([
      readFile(path.join(projectRoot, 'vercel.json'), 'utf8'),
      readFile(path.join(projectRoot, 'scripts', 'audit-vercel-build-output.mjs'), 'utf8'),
    ]);
    const adminConfig = JSON.parse(adminConfigSource);
    expect(adminConfig.rewrites).not.toContainEqual({ source: '/(.*)', destination: '/index.html' });
    expect(adminConfig.rewrites).toContainEqual({
      source: '/((?!assets/|sw\\.js$|workbox-[^/]+\\.js$|manifest\\.webmanifest$|registerSW\\.js$|pwa-192x192\\.png$|pwa-512x512\\.png$|logIcon\\.svg$).*)',
      destination: '/index.html',
    });
    expect(outputAudit).toContain('adminPwaPresent');
    expect(outputAudit).toContain("paths.includes('manifest.webmanifest')");
    expect(outputAudit).toContain("paths.includes('sw.js')");
  });

  it('does not create or modify the real repository Vercel link while fixtures run', async () => {
    const repositoryLink = path.join(projectRoot, '.vercel', 'project.json');
    const before = await exists(repositoryLink) ? await readFile(repositoryLink, 'utf8') : null;
    const fixture = await createEffectiveWorkspace();
    await writeProjectLink(fixture.workspaceRoot);
    const after = await exists(repositoryLink) ? await readFile(repositoryLink, 'utf8') : null;
    expect(after).toBe(before);
  });
});
