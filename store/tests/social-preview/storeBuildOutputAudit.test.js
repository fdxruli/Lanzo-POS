import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditPrebuiltOutput } from '../../../scripts/audit-vercel-build-output.mjs';

const PROJECT_ID = 'fixture-store-project';
const ORG_ID = 'fixture-store-org';
const INDEX_HTML = `<!doctype html><html><head>
<!-- LANZO_SOCIAL_HEAD_START --><title>Tienda</title><!-- LANZO_SOCIAL_HEAD_END -->
<link rel="stylesheet" href="/assets/index-AbCd1234.css"></head>
<body><div id="root"></div><script type="module" src="/assets/index-ZyXw9876.js"></script></body></html>`;

function validRoutes() {
  return [
    {
      src: '^/(.*)/$',
      status: 308,
      headers: { Location: '/$1', 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
    },
    { src: '^/(.*)$', headers: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' }, continue: true },
    {
      src: '^/assets/(.*)$',
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
      continue: true,
    },
    {
      src: '^/(?:index\\.html)?$',
      headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' },
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

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createFunction(functionsRoot, relativeRoute, source) {
  const root = path.join(functionsRoot, `${relativeRoute}.func`);
  await mkdir(root, { recursive: true });
  await writeJson(path.join(root, '.vc-config.json'), {
    runtime: 'nodejs22.x',
    handler: 'index.mjs',
  });
  await writeFile(path.join(root, 'index.mjs'), source);
}

async function createFixture() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-store-social-preview-1-6-'));
  const storeRoot = path.join(workspaceRoot, 'store');
  const sourceStatic = path.join(workspaceRoot, 'source-static');
  const outputRoot = path.join(storeRoot, '.vercel', 'output');
  const staticRoot = path.join(outputRoot, 'static');
  const functionsRoot = path.join(outputRoot, 'functions');
  await Promise.all([
    mkdir(path.join(staticRoot, 'assets'), { recursive: true }),
    mkdir(path.join(sourceStatic, 'assets'), { recursive: true }),
  ]);
  const staticFiles = {
    'index.html': INDEX_HTML,
    'robots.txt': 'User-agent: *\nDisallow: /\n',
    'assets/index-AbCd1234.css': 'body{color:#123456}',
    'assets/index-ZyXw9876.js': 'export const publicStore=true;',
  };
  for (const [relativePath, source] of Object.entries(staticFiles)) {
    await writeFile(path.join(staticRoot, relativePath), source);
    await writeFile(path.join(sourceStatic, relativePath), source);
  }
  const sourceConfigPath = path.join(workspaceRoot, 'store-vercel.json');
  await writeJson(sourceConfigPath, { trailingSlash: false });
  await writeJson(path.join(storeRoot, '.vercel', 'project.json'), {
    projectId: PROJECT_ID,
    orgId: ORG_ID,
  });
  await writeJson(path.join(outputRoot, 'config.json'), { version: 3, routes: validRoutes() });
  await createFunction(
    functionsRoot,
    'api/store-page',
    `const STORE_HTML_TEMPLATE=${JSON.stringify(INDEX_HTML)};export default STORE_HTML_TEMPLATE;`,
  );
  await createFunction(
    functionsRoot,
    'api/og/store',
    "import {ImageResponse} from '@vercel/og';import React from 'react';export default [ImageResponse,React];",
  );
  return {
    workspaceRoot,
    storeRoot,
    sourceStatic,
    sourceConfigPath,
    outputRoot,
    staticRoot,
    functionsRoot,
  };
}

async function audit(fixture) {
  return auditPrebuiltOutput('store', fixture.storeRoot, {
    sourceConfigPath: fixture.sourceConfigPath,
    sourceStaticPath: fixture.sourceStatic,
    expectedProjectId: PROJECT_ID,
    expectedOrganizationId: ORG_ID,
  });
}

describe('auditoría de .vercel/output', () => {
  let fixture;
  beforeEach(async () => {
    fixture = await createFixture();
  });

  it('acepta un output mínimo válido', async () => {
    const result = await audit(fixture);
    expect(result.status, JSON.stringify(result.failedChecks)).toBe('PASS');
    expect(result.output.functions).toEqual(['/api/og/store', '/api/store-page']);
    expect(result.routing.cases.map((item) => item.slugValues)).toEqual([
      ['mi-tienda'],
      ['mi-tienda'],
      ['mi-tienda'],
      ['mi-tienda'],
    ]);
  });

  it.each([
    ['función HTML ausente', async () => rm(
      path.join(fixture.functionsRoot, 'api', 'store-page.func'),
      { recursive: true },
    ), 'exactlyExpectedFunctions'],
    ['función OG ausente', async () => rm(
      path.join(fixture.functionsRoot, 'api', 'og', 'store.func'),
      { recursive: true },
    ), 'exactlyExpectedFunctions'],
    ['tercera función', async () => createFunction(
      fixture.functionsRoot,
      'api/extra',
      'export default {}',
    ), 'exactlyExpectedFunctions'],
    ['helper publicado', async () => createFunction(
      fixture.functionsRoot,
      'api/_publicPortal',
      'export default {}',
    ), 'exactlyExpectedFunctions'],
    ['asset administrativo', async () => writeFile(
      path.join(fixture.staticRoot, 'assets', 'Dashboard-AbCd1234.js'),
      'const Dashboard=true;',
    ), 'noAdministrativeCode'],
    ['secreto', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      "const GITHUB_TOKEN='ghp_12345678901234567890';",
    ), 'noSecrets'],
    ['service role', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      "const role='service_role';",
    ), 'noSecrets'],
    ['template ausente', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'index.mjs'),
      'export default {}',
    ), 'htmlResolvesTemplate'],
    ['tracking incorrecto', async () => {
      const configPath = path.join(fixture.outputRoot, 'config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      config.routes[5].dest = '/api/store-page?slug=$1&tracking=$2';
      await writeJson(configPath, config);
    }, 'trackingStatic'],
    ['HTML immutable', async () => {
      const configPath = path.join(fixture.outputRoot, 'config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      config.routes[3].headers['Cache-Control'] = 'public, max-age=31536000, immutable';
      await writeJson(configPath, config);
    }, 'htmlNeverImmutable'],
    ['asset sin caché', async () => {
      const configPath = path.join(fixture.outputRoot, 'config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      config.routes.splice(2, 1);
      await writeJson(configPath, config);
    }, 'immutableAssets'],
    ['loop', async () => {
      const configPath = path.join(fixture.outputRoot, 'config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      config.routes.splice(-1, 0, { src: '/loop', dest: '/loop' });
      await writeJson(configPath, config);
    }, 'noRouteLoop'],
    ['source map', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'index.mjs.map'),
      '{}',
    ), 'noSourceMaps'],
    ['fuente', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'og', 'store.func', 'custom.woff2'),
      'font',
    ), 'noFonts'],
  ])('rechaza %s', async (_label, mutate, failedCheck) => {
    await mutate();
    const result = await audit(fixture);
    expect(result.status).toBe('FAIL');
    expect(result.checks[failedCheck]).toBe(false);
  });
});
