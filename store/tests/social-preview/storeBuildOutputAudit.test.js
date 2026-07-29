import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  auditPrebuiltOutput,
  classifyCredentialAssignment,
  verifyTemporaryStoreRoot,
} from '../../../scripts/audit-vercel-build-output.mjs';

const PROJECT_ID = 'fixture-store-project';
const ORG_ID = 'fixture-store-org';
const PRIVILEGED_JWT = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role: 'service_role', fixture: true })).toString('base64url'),
  Buffer.from('fictitious-signature').toString('base64url'),
].join('.');
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
  const outputRoot = path.join(workspaceRoot, '.vercel', 'output');
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
  await writeJson(path.join(workspaceRoot, '.vercel', 'project.json'), {
    projectId: PROJECT_ID,
    orgId: ORG_ID,
  });
  await writeJson(path.join(outputRoot, 'config.json'), { version: 3, routes: validRoutes() });
  await createFunction(
    functionsRoot,
    'api/store-page',
    `const STORE_HTML_TEMPLATE=${JSON.stringify(INDEX_HTML)};
function rejectsPrivileged(value,payload){
  const envName='SUPABASE_SERVICE_ROLE';
  const forbidden=/service_role/;
  return value.includes('service_role')
    || value.includes('supabase_service_role')
    || payload.role === 'service_role'
    || forbidden.test(value)
    || envName.length === 0;
}
export default [STORE_HTML_TEMPLATE,rejectsPrivileged];`,
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
  return auditPrebuiltOutput('store', fixture.workspaceRoot, {
    sourceConfigPath: fixture.sourceConfigPath,
    sourceStaticPath: fixture.sourceStatic,
    effectiveStoreRoot: fixture.storeRoot,
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

  it('acepta el contrato de workspace temporal con store efectivo explícito', () => {
    expect(verifyTemporaryStoreRoot({
      workspaceRoot: fixture.workspaceRoot,
      effectiveStoreRoot: fixture.storeRoot,
    })).toBe(true);
  });

  it('normaliza solamente los bundles de entrada esperados con evidencia', async () => {
    await rename(
      path.join(fixture.functionsRoot, 'api', 'store-page.func'),
      path.join(fixture.functionsRoot, 'api', 'store-page.js.func'),
    );
    await rename(
      path.join(fixture.functionsRoot, 'api', 'og', 'store.func'),
      path.join(fixture.functionsRoot, 'api', 'og', 'store.jsx.func'),
    );
    const result = await audit(fixture);
    expect(result.status, JSON.stringify(result.failedChecks)).toBe('PASS');
    expect(result.functionAudit.bundles.map((bundle) => [bundle.rawRoute, bundle.route, bundle.normalized]))
      .toEqual(expect.arrayContaining([
        ['/api/store-page.js', '/api/store-page', true],
        ['/api/og/store.jsx', '/api/og/store', true],
      ]));
  });

  it('rechaza una extensión arbitraria aunque tenga handler y runtime', async () => {
    await rename(
      path.join(fixture.functionsRoot, 'api', 'store-page.func'),
      path.join(fixture.functionsRoot, 'api', 'store-page.ts.func'),
    );
    const result = await audit(fixture);
    expect(result.checks.exactlyExpectedFunctions).toBe(false);
  });

  it('clasifica mapas internos seguros y bloquea mapas públicos o con secretos', async () => {
    await writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'index.mjs.map'),
      JSON.stringify({ version: 3, sources: ['node_modules/react/index.js'], mappings: '' }),
    );
    let result = await audit(fixture);
    expect(result.status, JSON.stringify(result.failedChecks)).toBe('PASS');
    expect(result.functionAudit.bundles.find((bundle) => bundle.route === '/api/store-page')
      .internalFunctionSourceMaps[0]).toMatchObject({ generatedBy: '@vercel/node (inferred)', closureSafe: true });
    await writeFile(path.join(fixture.staticRoot, 'assets', 'index-ZyXw9876.js.map'), '{}');
    result = await audit(fixture);
    expect(result.checks.noPublicSourceMaps).toBe(false);
  });

  it.each([
    ['workspace fuera de TEMP', path.join(process.cwd(), 'store'), path.join(process.cwd(), 'store', 'store')],
    ['store/store duplicado', fixture.workspaceRoot, path.join(fixture.workspaceRoot, 'store', 'store')],
  ])('rechaza el contrato temporal: %s', (_label, workspaceRoot, effectiveStoreRoot) => {
    expect(verifyTemporaryStoreRoot({ workspaceRoot, effectiveStoreRoot })).toBe(false);
  });

  it('acepta vocabulario defensivo sin valores credenciales', async () => {
    const result = await audit(fixture);
    expect(result.status, JSON.stringify(result.failedChecks)).toBe('PASS');
    expect(result.functionAudit.safety.secretViolations).toEqual([]);
    expect(result.functionAudit.safety.credentialVocabulary.defensive).toEqual(
      expect.arrayContaining([
        expect.stringContaining('service_role'),
        expect.stringContaining('SUPABASE_SERVICE_ROLE'),
      ]),
    );
  });

  it('acepta Dexie y copy público de caja en el storefront', async () => {
    const publicCopy = 'const storeDb = Dexie; const copy = "Pago en caja"; const label = "Caja";';
    await Promise.all([
      writeFile(path.join(fixture.staticRoot, 'assets', 'public-copy-AbCd1234.js'), publicCopy),
      writeFile(path.join(fixture.sourceStatic, 'assets', 'public-copy-AbCd1234.js'), publicCopy),
    ]);
    const result = await audit(fixture);
    expect(result.checks.noAdministrativeCode).toBe(true);
    expect(result.staticAudit.safety.administrativeViolations).toEqual([]);
  });

  it('conserva los marcadores administrativos de alta precisión', async () => {
    const administrativeCode = 'const db = LanzoDB; const page = CajaPage; processSale(order);';
    await Promise.all([
      writeFile(path.join(fixture.staticRoot, 'assets', 'administrative-AbCd1234.js'), administrativeCode),
      writeFile(path.join(fixture.sourceStatic, 'assets', 'administrative-AbCd1234.js'), administrativeCode),
    ]);
    const result = await audit(fixture);
    expect(result.checks.noAdministrativeCode).toBe(false);
    expect(result.staticAudit.safety.administrativeViolations).toEqual(expect.arrayContaining([
      'CajaPage:assets/administrative-AbCd1234.js',
      'LanzoDB:assets/administrative-AbCd1234.js',
      'processSale:assets/administrative-AbCd1234.js',
    ]));
  });

  it('clasifica vocabulario OAuth y placeholders sin ocultar valores reales', async () => {
    const defensive = [
      '{ access_token: "access_token" }',
      '{ refresh_token: "refresh_token" }',
      '{ grant_type: "refresh_token" }',
      'const field = "access_token";',
      'const placeholder = "your_access_token";',
    ].join('\n');
    await Promise.all([
      writeFile(path.join(fixture.staticRoot, 'assets', 'oauth-AbCd1234.js'), defensive),
      writeFile(path.join(fixture.sourceStatic, 'assets', 'oauth-AbCd1234.js'), defensive),
    ]);
    const result = await audit(fixture);
    expect(result.checks.noSecrets).toBe(true);
    expect(result.staticAudit.safety.credentialVocabulary.access_token)
      .toContain('assets/oauth-AbCd1234.js');
    expect(result.staticAudit.safety.credentialAssignments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'access_token', value: '<redacted>', valueLength: 12, classification: 'oauth-vocabulary',
      }),
      expect.objectContaining({ key: 'refresh_token', classification: 'oauth-vocabulary' }),
    ]));
  });

  it('bloquea asignaciones OAuth con apariencia de credencial y no expone su valor', async () => {
    const syntheticToken = 'AbC9_xY7-KlM2_qRs8-TuV4_WxZ6';
    const syntheticRefresh = 'rt_8fK3mN9qT6vX2pL7sC4dH1jA';
    const values = `{ access_token: "${syntheticToken}" }\n{ refresh_token: "${syntheticRefresh}" }`;
    await Promise.all([
      writeFile(path.join(fixture.staticRoot, 'assets', 'credential-AbCd1234.js'), values),
      writeFile(path.join(fixture.sourceStatic, 'assets', 'credential-AbCd1234.js'), values),
    ]);
    const result = await audit(fixture);
    expect(result.checks.noSecrets).toBe(false);
    expect(result.staticAudit.safety.secretViolations).toEqual(expect.arrayContaining([
      `credentialValue:access_token:length=${syntheticToken.length}:assets/credential-AbCd1234.js`,
      `credentialValue:refresh_token:length=${syntheticRefresh.length}:assets/credential-AbCd1234.js`,
    ]));
    expect(JSON.stringify(result.staticAudit.safety)).not.toContain(syntheticToken);
    expect(JSON.stringify(result.staticAudit.safety)).not.toContain(syntheticRefresh);
  });

  it.each([
    ['access_token', 'access_token', 'oauth-vocabulary'],
    ['refresh_token', 'refresh_token', 'oauth-vocabulary'],
    ['access_token', 'your_access_token', 'placeholder'],
    ['access_token', 'AbC9_xY7-KlM2_qRs8-TuV4_WxZ6', 'credential-like'],
  ])('clasifica %s sin depender del nombre de archivo', (key, value, classification) => {
    expect(classifyCredentialAssignment(key, value)).toBe(classification);
  });

  it('requiere static materializado para auditar el Build Output completo', async () => {
    await rm(fixture.staticRoot, { recursive: true });
    await expect(audit(fixture)).rejects.toThrow('Missing prebuilt input: static');
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
    ['asignación service role', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      "const role='service_role';",
    ), 'noSecrets'],
    ['clave Supabase secreta', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      "const serviceRoleKey='sb_secret_real_example_123456';",
    ), 'noSecrets'],
    ['token Vercel sintético', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      "const token='vcp_1234567890abcdefghijklmnopqrst';",
    ), 'noSecrets'],
    ['clave privada sintética', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----',
    ), 'noSecrets'],
    ['variable Supabase service role', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      "const SUPABASE_SERVICE_ROLE='secret-value-example';",
    ), 'noSecrets'],
    ['archivo env con service role', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      'SUPABASE_SERVICE_ROLE=secret-value-example',
    ), 'noSecrets'],
    ['JWT service role', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      `headers.authorization='Bearer ${PRIVILEGED_JWT}';`,
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
    ['source map público', async () => writeFile(
      path.join(fixture.staticRoot, 'assets', 'index.mjs.map'),
      '{}',
    ), 'noPublicSourceMaps'],
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
